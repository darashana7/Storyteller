import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Upload, Play, Pause, Square, Menu, X, Sparkles, Loader2 } from 'lucide-react';
import { PdfData, AppSettings, PlaybackState, TocItem } from './types';
import { parsePdf } from './services/pdfUtils';
import { fetchOpenAIAudio, getBrowserVoices, speakBrowser } from './services/ttsUtils';
import { detectEmotion, generateGeminiSpeech, decodeGeminiAudio } from './services/gemini';
import { Sidebar } from './components/Sidebar';
import { ReaderDisplay } from './components/ReaderDisplay';

// Interface for cached audio data
interface AudioCacheItem {
    buffer: AudioBuffer;
    emotion: string;
}

export default function App() {
    // --- State ---
    const [pdfData, setPdfData] = useState<PdfData>({ textSegments: [], pageMapping: [], toc: [] });
    const [isProcessing, setIsProcessing] = useState(false);
    
    const [playback, setPlayback] = useState<PlaybackState>({
        isPlaying: false,
        isLoading: false,
        currentIndex: -1
    });

    const [settings, setSettings] = useState<AppSettings>(() => {
        const savedKey = localStorage.getItem('openai_api_key') || '';
        return {
            engine: 'browser',
            browserVoice: null,
            openaiKey: savedKey,
            openaiVoice: 'alloy',
            googleVoice: 'Puck',
            rate: 1.0,
            pitch: 1.0
        };
    });

    const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
    const [activeTab, setActiveTab] = useState<'settings' | 'chapters'>('settings');
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

    // --- Refs ---
    const audioRef = useRef<HTMLAudioElement | null>(null); // For OpenAI (URL based)
    const audioContextRef = useRef<AudioContext | null>(null); // For Gemini (PCM based)
    const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null); // For Gemini
    const synthRef = useRef<SpeechSynthesis>(window.speechSynthesis);

    // Cache for pre-fetched Gemini audio
    // Maps index -> Promise that resolves to the audio buffer and emotion
    const audioCache = useRef<Map<number, Promise<AudioCacheItem>>>(new Map());

    // --- Initialization ---
    useEffect(() => {
        const loadVoices = () => {
            const available = getBrowserVoices();
            setVoices(available);
            if (!settings.browserVoice && available.length > 0) {
                const defaultVoice = available.find(v => v.lang.startsWith('en')) || available[0];
                setSettings(prev => ({ ...prev, browserVoice: defaultVoice }));
            }
        };
        
        loadVoices();
        if (window.speechSynthesis.onvoiceschanged !== undefined) {
            window.speechSynthesis.onvoiceschanged = loadVoices;
        }
    }, []);

    // Save API key
    useEffect(() => {
        localStorage.setItem('openai_api_key', settings.openaiKey);
    }, [settings.openaiKey]);

    // Ensure AudioContext is created
    const getAudioContext = () => {
        if (!audioContextRef.current) {
            audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
        }
        if (audioContextRef.current.state === 'suspended') {
            audioContextRef.current.resume();
        }
        return audioContextRef.current;
    };

    // --- Gemini Processing Logic (Buffering) ---

    // This function creates the promise for generating audio
    const processGeminiSentence = async (index: number): Promise<AudioCacheItem> => {
        const text = pdfData.textSegments[index];
        const previousText = index > 0 ? pdfData.textSegments[index - 1] : undefined;
        
        // Grab next 5 sentences for context
        const upcomingContext = pdfData.textSegments.slice(index + 1, index + 6);

        if (!text.trim()) {
            throw new Error("Empty text");
        }

        // 1. Detect Emotion with expanded context
        const emotion = await detectEmotion(text, previousText, upcomingContext);

        // 2. Generate Audio
        const audioData = await generateGeminiSpeech(text, settings.googleVoice, emotion);
        
        if (!audioData) throw new Error("No audio returned from Gemini");

        // 3. Decode
        const ctx = getAudioContext();
        const buffer = await decodeGeminiAudio(audioData, ctx);

        return { buffer, emotion };
    };

    // Helper to ensure a specific index is being fetched
    const prefetchGeminiSentence = (index: number) => {
        if (index >= pdfData.textSegments.length) return;
        if (audioCache.current.has(index)) return;

        // Start fetching and store the promise
        const promise = processGeminiSentence(index).catch(err => {
            console.error(`Error prefetching index ${index}:`, err);
            // If it fails, remove from cache so we can retry or handle gracefully later
            audioCache.current.delete(index);
            throw err;
        });
        audioCache.current.set(index, promise);
    };

    // --- Audio Control Logic ---

    const stopAudio = useCallback(() => {
        // Stop Browser TTS
        synthRef.current.cancel();
        
        // Stop OpenAI Audio
        if (audioRef.current) {
            audioRef.current.pause();
            audioRef.current = null;
        }

        // Stop Gemini Audio
        if (sourceNodeRef.current) {
            try {
                sourceNodeRef.current.stop();
            } catch(e) { /* ignore */ }
            sourceNodeRef.current = null;
        }

        setPlayback(prev => ({ ...prev, isPlaying: false, isLoading: false, detectedEmotion: undefined }));
    }, []);

    const playNext = useCallback(() => {
        setPlayback(prev => {
            const nextIndex = prev.currentIndex + 1;
            if (nextIndex < pdfData.textSegments.length) {
                return { ...prev, currentIndex: nextIndex }; 
            } else {
                return { ...prev, isPlaying: false, currentIndex: 0 };
            }
        });
    }, [pdfData.textSegments.length]);

    const playSentence = useCallback(async (index: number) => {
        if (index < 0 || index >= pdfData.textSegments.length) return;

        const text = pdfData.textSegments[index];
        if (!text.trim()) {
            playNext();
            return;
        }

        // Stop previous audio sources
        synthRef.current.cancel();
        if (audioRef.current) audioRef.current.pause();
        if (sourceNodeRef.current) {
            try { sourceNodeRef.current.stop(); } catch(e) {}
        }

        // --- GEMINI ENGINE (With Buffering) ---
        if (settings.engine === 'google') {
            // Check cache first
            let itemPromise = audioCache.current.get(index);

            // If not in cache, start it now
            if (!itemPromise) {
                setPlayback(prev => ({ ...prev, isLoading: true }));
                try {
                    itemPromise = processGeminiSentence(index);
                    audioCache.current.set(index, itemPromise);
                } catch (err) {
                     // Handled below
                }
            }

            // Prefetch next 2 sentences immediately (Fire and forget)
            prefetchGeminiSentence(index + 1);
            prefetchGeminiSentence(index + 2);

            try {
                // Wait for current item
                if (!itemPromise) throw new Error("Initialization failed");
                const { buffer, emotion } = await itemPromise;

                // Check if user stopped playback while we were waiting
                if (!playback.isPlaying) return;
                // Check if user skipped to another sentence while we were waiting
                // Accessing current state via the functional update in setPlayback is safest, 
                // or we rely on the fact this function is called by an effect dependent on currentIndex.
                // However, to be safe against rapid clicking:
                // We will assume the effect handles the "latest" call.

                setPlayback(prev => ({ ...prev, isLoading: false, detectedEmotion: emotion }));

                const ctx = getAudioContext();
                const source = ctx.createBufferSource();
                source.buffer = buffer;
                source.connect(ctx.destination);
                sourceNodeRef.current = source;

                source.onended = () => {
                    playNext();
                };

                source.start();

            } catch (error: any) {
                console.error("Gemini TTS Error", error);
                // If error, maybe fallback or just stop
                setPlayback(prev => ({ ...prev, isPlaying: false, isLoading: false }));
            }
        
        // --- OPENAI ENGINE ---
        } else if (settings.engine === 'openai') {
            if (!settings.openaiKey) {
                alert("Please add your OpenAI API Key in Settings.");
                setSettings(prev => ({...prev, engine: 'browser'}));
                return;
            }

            setPlayback(prev => ({ ...prev, isLoading: true, detectedEmotion: undefined }));
            
            try {
                const url = await fetchOpenAIAudio(text, settings.openaiKey, settings.openaiVoice, settings.rate);
                
                if (!playback.isPlaying) return;

                const audio = new Audio(url);
                audioRef.current = audio;
                
                audio.onended = () => {
                    playNext();
                };
                audio.onerror = (e) => {
                    console.error("Audio playback failed", e);
                    setPlayback(prev => ({ ...prev, isPlaying: false, isLoading: false }));
                };

                await audio.play();
                setPlayback(prev => ({ ...prev, isLoading: false }));

            } catch (error: any) {
                console.error(error);
                alert(`OpenAI Error: ${error.message}`);
                setPlayback(prev => ({ ...prev, isPlaying: false, isLoading: false }));
            }

        // --- BROWSER ENGINE ---
        } else {
            setPlayback(prev => ({ ...prev, detectedEmotion: undefined }));
            speakBrowser(text, settings, playNext, (err) => {
                console.error("TTS Error", err);
                setPlayback(prev => ({ ...prev, isPlaying: false }));
            });
        }
    }, [pdfData.textSegments, settings, playNext, playback.isPlaying]);

    // --- Effects ---

    // Watch for playback state changes to trigger audio
    // We use a ref to track the "active" play call to prevent race conditions if index changes rapidly
    const activeIndexRef = useRef<number>(-1);

    useEffect(() => {
        let timer: ReturnType<typeof setTimeout>;
        if (playback.isPlaying) {
            // Update active index
            activeIndexRef.current = playback.currentIndex;
            
            // If isLoading is true, it means we are waiting for data, don't re-trigger
            // But if we just switched index, isLoading might be false from previous state
            
            timer = setTimeout(() => {
                // Double check if we are still on the same index after delay
                if (activeIndexRef.current === playback.currentIndex) {
                    playSentence(playback.currentIndex);
                }
            }, 10);
        }
        return () => clearTimeout(timer);
    }, [playback.currentIndex, playback.isPlaying, playSentence]); 

    // --- Handlers ---

    const handleFileUpload = async (file: File) => {
        setIsProcessing(true);
        stopAudio();
        // Clear cache on new file
        audioCache.current.clear();
        setPlayback({ isPlaying: false, isLoading: false, currentIndex: -1 });
        
        try {
            const data = await parsePdf(file);
            setPdfData(data);
            setPlayback(prev => ({ ...prev, currentIndex: 0 }));
            if (data.toc.length > 0) {
                setActiveTab('chapters');
            }
        } catch (error) {
            console.error(error);
            alert("Failed to parse PDF.");
        } finally {
            setIsProcessing(false);
        }
    };

    const togglePlay = () => {
        if (pdfData.textSegments.length === 0) return;

        if (playback.isPlaying) {
            stopAudio();
        } else {
            setPlayback(prev => {
                const idx = prev.currentIndex === -1 ? 0 : prev.currentIndex;
                return { ...prev, isPlaying: true, currentIndex: idx };
            });
        }
    };

    const handleNavigate = (pageIndex: number) => {
        const sentenceIndex = pdfData.pageMapping[pageIndex];
        if (sentenceIndex !== undefined) {
            stopAudio();
            // Allow state to settle, then play
            setTimeout(() => {
                setPlayback({ isPlaying: true, isLoading: false, currentIndex: sentenceIndex });
            }, 50);
            if (window.innerWidth < 768) setIsMobileMenuOpen(false);
        }
    };

    const handleSentenceClick = (index: number) => {
        stopAudio();
        // Clear cache for upcoming items if jumping far away? 
        // Actually, keeping cache is fine, but we prioritize the clicked one.
        setTimeout(() => {
            setPlayback({ isPlaying: true, isLoading: false, currentIndex: index });
        }, 50);
    };

    return (
        <div className="flex flex-col h-screen bg-white">
            {/* Header */}
            <header className="h-16 bg-white border-b border-gray-200 px-4 md:px-6 flex items-center justify-between shrink-0 z-30 relative shadow-sm">
                <div className="flex items-center gap-4">
                    <button 
                        className="md:hidden text-gray-500"
                        onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                    >
                        {isMobileMenuOpen ? <X /> : <Menu />}
                    </button>
                    <div className="flex items-center gap-2">
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-white font-serif font-bold italic text-lg shadow-md ${settings.engine === 'openai' ? 'bg-gradient-to-br from-indigo-600 to-purple-600' : settings.engine === 'google' ? 'bg-gradient-to-br from-blue-500 to-cyan-400' : 'bg-gradient-to-br from-brand-600 to-brand-700'}`}>
                            S
                        </div>
                        <h1 className="text-lg md:text-xl font-bold text-gray-800 tracking-tight">
                            Storyteller <span className="text-xs font-normal text-gray-500 ml-1 border border-gray-200 rounded px-1.5 py-0.5 hidden sm:inline-block">Pro</span>
                        </h1>
                    </div>
                </div>

                <div className="flex items-center gap-4">
                     {/* Floating Play Controls (Desktop) */}
                    <div className="hidden md:flex items-center bg-gray-50 rounded-full p-1 border border-gray-200 mr-4">
                         {playback.detectedEmotion && settings.engine === 'google' && (
                             <div className="mr-3 px-3 py-1 bg-white rounded-full text-xs font-medium text-blue-600 shadow-sm flex items-center gap-1 animate-fade-in border border-blue-100">
                                 <Sparkles className="w-3 h-3" />
                                 {playback.detectedEmotion}
                             </div>
                         )}
                         <button 
                            onClick={stopAudio}
                            disabled={pdfData.textSegments.length === 0}
                            className="p-2 text-gray-500 hover:text-red-500 transition rounded-full hover:bg-white"
                        >
                            <Square className="w-4 h-4 fill-current" />
                        </button>
                        <div className="w-px h-4 bg-gray-300 mx-1"></div>
                        <button 
                            onClick={togglePlay}
                            disabled={pdfData.textSegments.length === 0}
                            className="flex items-center gap-2 px-4 py-1.5 rounded-full bg-white shadow-sm text-sm font-semibold text-gray-700 hover:text-brand-600 transition"
                        >
                            {playback.isLoading ? (
                                <Loader2 className="w-4 h-4 animate-spin text-brand-500" />
                            ) : playback.isPlaying ? (
                                <Pause className="w-4 h-4 fill-current" />
                            ) : (
                                <Play className="w-4 h-4 fill-current" />
                            )}
                            {playback.isPlaying ? "Pause" : "Play"}
                        </button>
                    </div>

                    <label className="flex items-center gap-2 cursor-pointer bg-brand-600 hover:bg-brand-700 text-white px-4 py-2 rounded-lg transition-colors font-medium text-sm shadow-sm hover:shadow">
                        <Upload className="w-4 h-4" />
                        <span className="hidden sm:inline">Upload PDF</span>
                        <input type="file" accept="application/pdf" onChange={(e) => e.target.files && handleFileUpload(e.target.files[0])} className="hidden" />
                    </label>
                </div>
            </header>

            <div className="flex flex-1 overflow-hidden relative">
                {/* Mobile Menu Backdrop */}
                {isMobileMenuOpen && (
                    <div className="absolute inset-0 bg-black/50 z-20 md:hidden" onClick={() => setIsMobileMenuOpen(false)} />
                )}

                {/* Sidebar Container */}
                <div className={`absolute inset-y-0 left-0 z-30 transform transition-transform duration-300 ease-in-out md:relative md:transform-none ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}`}>
                    <Sidebar 
                        toc={pdfData.toc} 
                        settings={settings} 
                        onSettingsChange={(newSettings) => setSettings(prev => ({ ...prev, ...newSettings }))}
                        onNavigate={handleNavigate}
                        activeTab={activeTab}
                        onTabChange={setActiveTab}
                        availableVoices={voices}
                    />
                </div>

                {/* Main Content */}
                <main className="flex-1 flex flex-col relative w-full">
                    <ReaderDisplay 
                        sentences={pdfData.textSegments}
                        currentIndex={playback.currentIndex}
                        isLoading={playback.isLoading}
                        isProcessingPdf={isProcessing}
                        onSentenceClick={handleSentenceClick}
                        onFileUpload={handleFileUpload}
                        engine={settings.engine}
                    />
                    
                    {/* Mobile Floating Action Button (FAB) for Play */}
                    <div className="md:hidden absolute bottom-6 right-6 z-10">
                        {playback.detectedEmotion && settings.engine === 'google' && (
                            <div className="absolute -top-12 right-0 bg-white px-3 py-1 rounded-full text-xs font-medium text-blue-600 shadow-md border border-blue-100 whitespace-nowrap flex items-center gap-1">
                                <Sparkles className="w-3 h-3" />
                                {playback.detectedEmotion}
                            </div>
                        )}
                         <button 
                            onClick={togglePlay}
                            disabled={pdfData.textSegments.length === 0}
                            className={`w-14 h-14 rounded-full shadow-xl flex items-center justify-center text-white transition-transform active:scale-95 ${playback.isPlaying ? 'bg-orange-500' : 'bg-brand-600'}`}
                        >
                            {playback.isLoading ? (
                                <Loader2 className="w-6 h-6 animate-spin" />
                            ) : playback.isPlaying ? (
                                <Pause className="w-6 h-6 fill-current" />
                            ) : (
                                <Play className="w-6 h-6 fill-current ml-1" />
                            )}
                        </button>
                    </div>
                </main>
            </div>
        </div>
    );
}