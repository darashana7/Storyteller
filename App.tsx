import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Upload, Play, Pause, Square, Menu, X, Sparkles, Loader2, Moon, Sun, Mic } from 'lucide-react';
import { PdfData, AppSettings, PlaybackState, TocItem } from './types';
import { parsePdf } from './services/pdfUtils';
import { fetchOpenAIAudio, getBrowserVoices, speakBrowser } from './services/ttsUtils';
import { detectEmotion, generateGeminiSpeech, decodeGeminiAudio, transcribeAudio, translateBatch } from './services/gemini';
import { Sidebar } from './components/Sidebar';
import { ReaderDisplay } from './components/ReaderDisplay';

// Interface for cached audio data
interface AudioCacheItem {
    buffer: AudioBuffer;
    emotion: string;
}

// Simple LRU Cache implementation for audio buffers to prevent memory leaks
class AudioLRUCache {
    private cache: Map<number, Promise<AudioCacheItem>>;
    private readonly capacity: number;

    constructor(capacity: number = 50) {
        this.capacity = capacity;
        this.cache = new Map();
    }

    get(key: number): Promise<AudioCacheItem> | undefined {
        if (!this.cache.has(key)) return undefined;
        const val = this.cache.get(key)!;
        // Refresh: delete and re-set to mark as recently used
        this.cache.delete(key);
        this.cache.set(key, val);
        return val;
    }

    set(key: number, value: Promise<AudioCacheItem>) {
        if (this.cache.has(key)) {
            this.cache.delete(key);
        } else if (this.cache.size >= this.capacity) {
            // Evict oldest (first item in Map)
            const firstKey = this.cache.keys().next().value;
            if (firstKey !== undefined) this.cache.delete(firstKey);
        }
        this.cache.set(key, value);
    }

    has(key: number) {
        return this.cache.has(key);
    }

    delete(key: number) {
        return this.cache.delete(key);
    }

    clear() {
        this.cache.clear();
    }
}

export default function App() {
    // --- State ---
    const [pdfData, setPdfData] = useState<PdfData>({ textSegments: [], pageMapping: [], toc: [] });
    const [currentFile, setCurrentFile] = useState<File | null>(null);
    const [isProcessing, setIsProcessing] = useState(false);
    const [isTranslating, setIsTranslating] = useState(false);
    
    const [playback, setPlayback] = useState<PlaybackState>({
        isPlaying: false,
        isLoading: false,
        currentIndex: -1
    });

    const [settings, setSettings] = useState<AppSettings>(() => {
        const savedKey = localStorage.getItem('openai_api_key') || '';
        // Check system preference for initial dark mode
        const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
        
        return {
            engine: 'browser',
            browserVoice: null,
            openaiKey: savedKey,
            openaiVoice: 'alloy',
            googleVoice: 'Puck',
            rate: 1.0,
            pitch: 1.0,
            darkMode: prefersDark,
            sourceLanguage: 'en',
            targetLanguage: 'es'
        };
    });

    const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
    const [activeTab, setActiveTab] = useState<'settings' | 'chapters'>('settings');
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
    
    // Recording State
    const [isRecording, setIsRecording] = useState(false);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const audioChunksRef = useRef<Blob[]>([]);

    // --- Refs ---
    const audioRef = useRef<HTMLAudioElement | null>(null); // For OpenAI (URL based)
    const audioContextRef = useRef<AudioContext | null>(null); // For Gemini (PCM based)
    const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null); // For Gemini
    const synthRef = useRef<SpeechSynthesis>(window.speechSynthesis);

    // Cache for pre-fetched Gemini audio
    const audioCache = useRef(new AudioLRUCache(50));

    // Track active index to prevent race conditions during async fetches
    const activeIndexRef = useRef<number>(-1);

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

    // Apply Dark Mode
    useEffect(() => {
        if (settings.darkMode) {
            document.documentElement.classList.add('dark');
        } else {
            document.documentElement.classList.remove('dark');
        }
    }, [settings.darkMode]);

    // Clear cache when critical settings change
    useEffect(() => {
        audioCache.current.clear();
    }, [settings.googleVoice, settings.engine]);

    // Re-parse document when Source Language changes (if file exists)
    useEffect(() => {
        if (currentFile && !isProcessing && !isTranslating) {
            handleFileUpload(currentFile, true); // true = silent/refresh
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [settings.sourceLanguage]);

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

                // Critical: Check if user skipped to another sentence while we were waiting
                if (activeIndexRef.current !== index) return;
                
                // If user paused while waiting
                if (!playback.isPlaying) return;

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
                // If the current request failed but we are still on this index, stop.
                if (activeIndexRef.current === index) {
                    setPlayback(prev => ({ ...prev, isPlaying: false, isLoading: false }));
                }
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
                
                // Verify index consistency
                if (activeIndexRef.current !== index) return;
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
                if (activeIndexRef.current === index) {
                    alert(`OpenAI Error: ${error.message}`);
                    setPlayback(prev => ({ ...prev, isPlaying: false, isLoading: false }));
                }
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
    useEffect(() => {
        let timer: ReturnType<typeof setTimeout>;
        if (playback.isPlaying) {
            // Update active index ref immediately for race-condition checks
            activeIndexRef.current = playback.currentIndex;
            
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

    const handleFileUpload = async (file: File, isSilent = false) => {
        setIsProcessing(true);
        if (!isSilent) {
            stopAudio();
            audioCache.current.clear();
            setPlayback({ isPlaying: false, isLoading: false, currentIndex: -1 });
            setCurrentFile(file);
        }
        
        try {
            // Use selected source language for segmentation
            const data = await parsePdf(file, settings.sourceLanguage);
            setPdfData(data);
            if (!isSilent) {
                setPlayback(prev => ({ ...prev, currentIndex: 0 }));
                if (data.toc.length > 0) {
                    setActiveTab('chapters');
                }
            }
        } catch (error) {
            console.error(error);
            alert("Failed to parse PDF.");
        } finally {
            setIsProcessing(false);
        }
    };

    const handleTranslate = async () => {
        if (pdfData.textSegments.length === 0) return;
        
        setIsTranslating(true);
        stopAudio();
        
        try {
            // Batch process the segments
            const BATCH_SIZE = 40;
            const newSegments = [...pdfData.textSegments];
            const chunks = [];
            
            for (let i = 0; i < newSegments.length; i += BATCH_SIZE) {
                const chunk = newSegments.slice(i, i + BATCH_SIZE);
                chunks.push({ start: i, texts: chunk });
            }

            // Process chunks sequentially to not hit rate limits (or use Promise.all for speed if limits allow)
            // Using sequence for safety with free tier limits if applicable
            for (const chunk of chunks) {
                const translated = await translateBatch(chunk.texts, settings.targetLanguage);
                // Update local array
                for (let j = 0; j < translated.length; j++) {
                    if (chunk.start + j < newSegments.length) {
                        newSegments[chunk.start + j] = translated[j];
                    }
                }
            }

            setPdfData(prev => ({
                ...prev,
                textSegments: newSegments
            }));
            
            // Reset playback to start to avoid confusion
            setPlayback(prev => ({ ...prev, currentIndex: 0 }));
            audioCache.current.clear();
            
        } catch (error) {
            console.error(error);
            alert("Translation failed. Please try again.");
        } finally {
            setIsTranslating(false);
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
        setTimeout(() => {
            setPlayback({ isPlaying: true, isLoading: false, currentIndex: index });
        }, 50);
    };

    // --- Audio Recording Handlers ---
    const startRecording = async () => {
        stopAudio();
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const mediaRecorder = new MediaRecorder(stream);
            mediaRecorderRef.current = mediaRecorder;
            audioChunksRef.current = [];

            mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    audioChunksRef.current.push(event.data);
                }
            };

            mediaRecorder.onstop = async () => {
                const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
                setIsProcessing(true);
                try {
                    const reader = new FileReader();
                    reader.readAsDataURL(audioBlob);
                    reader.onloadend = async () => {
                        const base64String = (reader.result as string).split(',')[1];
                        // Using audio/webm as it is the typical output of MediaRecorder in browsers
                        const transcribedText = await transcribeAudio(base64String, audioBlob.type);
                        
                        if (transcribedText) {
                            // Split transcribed text into sentences
                            // Reuse simpler logic here or Intl.Segmenter
                            const segmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl 
                                // @ts-ignore
                                ? new Intl.Segmenter(settings.sourceLanguage, { granularity: 'sentence' }) 
                                : null;
                            
                            let newSentences: string[] = [];
                            if (segmenter) {
                                const segments = segmenter.segment(transcribedText);
                                for (const { segment } of segments) {
                                    if (segment.trim().length > 0) newSentences.push(segment.trim());
                                }
                            } else {
                                const raw = transcribedText.match(/[^.!?]+[.!?]+["']?|[^.!?]+$/g);
                                if (raw) newSentences = raw.map(s => s.trim()).filter(s => s.length > 0);
                                else newSentences = [transcribedText.trim()];
                            }

                            if (newSentences.length > 0) {
                                setPdfData(prev => ({
                                    ...prev,
                                    textSegments: [...prev.textSegments, ...newSentences],
                                    pageMapping: prev.pageMapping.length === 0 ? [0] : prev.pageMapping
                                }));
                                
                                // If this is the first content, set index to 0
                                if (playback.currentIndex === -1) {
                                    setPlayback(prev => ({ ...prev, currentIndex: 0 }));
                                }
                            }
                        }
                        setIsProcessing(false);
                    };
                } catch (e) {
                    console.error("Transcription Failed", e);
                    alert("Failed to transcribe audio.");
                    setIsProcessing(false);
                }

                // Stop all tracks
                stream.getTracks().forEach(track => track.stop());
            };

            mediaRecorder.start();
            setIsRecording(true);
        } catch (err) {
            console.error("Error accessing microphone", err);
            alert("Could not access microphone. Please ensure permissions are granted.");
        }
    };

    const stopRecording = () => {
        if (mediaRecorderRef.current && isRecording) {
            mediaRecorderRef.current.stop();
            setIsRecording(false);
        }
    };

    return (
        <div className="flex flex-col h-screen bg-white dark:bg-gray-900 transition-colors duration-300">
            {/* Header */}
            <header className="h-16 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-4 md:px-6 flex items-center justify-between shrink-0 z-30 relative shadow-sm transition-colors duration-300">
                <div className="flex items-center gap-4">
                    <button 
                        className="md:hidden text-gray-500 dark:text-gray-400"
                        onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                    >
                        {isMobileMenuOpen ? <X /> : <Menu />}
                    </button>
                    <div className="flex items-center gap-2">
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-white font-serif font-bold italic text-lg shadow-md ${settings.engine === 'openai' ? 'bg-gradient-to-br from-indigo-600 to-purple-600' : settings.engine === 'google' ? 'bg-gradient-to-br from-blue-500 to-cyan-400' : 'bg-gradient-to-br from-brand-600 to-brand-700'}`}>
                            S
                        </div>
                        <h1 className="text-lg md:text-xl font-bold text-gray-800 dark:text-white tracking-tight">
                            Storyteller <span className="text-xs font-normal text-gray-500 dark:text-gray-400 ml-1 border border-gray-200 dark:border-gray-600 rounded px-1.5 py-0.5 hidden sm:inline-block">Pro</span>
                        </h1>
                    </div>
                </div>

                <div className="flex items-center gap-4">
                    {/* Dark Mode Toggle */}
                    <button 
                        onClick={() => setSettings(prev => ({ ...prev, darkMode: !prev.darkMode }))}
                        className="p-2 text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-yellow-300 transition-colors rounded-full hover:bg-gray-100 dark:hover:bg-gray-700"
                        title={settings.darkMode ? "Switch to Light Mode" : "Switch to Dark Mode"}
                    >
                        {settings.darkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
                    </button>

                     {/* Floating Play Controls (Desktop) */}
                    <div className="hidden md:flex items-center bg-gray-50 dark:bg-gray-700 rounded-full p-1 border border-gray-200 dark:border-gray-600 mr-2 transition-colors">
                         {playback.detectedEmotion && settings.engine === 'google' && (
                             <div className="mr-3 px-3 py-1 bg-white dark:bg-gray-800 rounded-full text-xs font-medium text-blue-600 dark:text-blue-400 shadow-sm flex items-center gap-1 animate-fade-in border border-blue-100 dark:border-blue-900/30">
                                 <Sparkles className="w-3 h-3" />
                                 {playback.detectedEmotion}
                             </div>
                         )}
                         <button 
                            onClick={stopAudio}
                            disabled={pdfData.textSegments.length === 0}
                            className="p-2 text-gray-500 dark:text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition rounded-full hover:bg-white dark:hover:bg-gray-600"
                        >
                            <Square className="w-4 h-4 fill-current" />
                        </button>
                        <div className="w-px h-4 bg-gray-300 dark:bg-gray-600 mx-1"></div>
                        <button 
                            onClick={togglePlay}
                            disabled={pdfData.textSegments.length === 0}
                            className="flex items-center gap-2 px-4 py-1.5 rounded-full bg-white dark:bg-gray-600 shadow-sm text-sm font-semibold text-gray-700 dark:text-gray-100 hover:text-brand-600 dark:hover:text-brand-300 transition"
                        >
                            {playback.isLoading ? (
                                <Loader2 className="w-4 h-4 animate-spin text-brand-500 dark:text-brand-400" />
                            ) : playback.isPlaying ? (
                                <Pause className="w-4 h-4 fill-current" />
                            ) : (
                                <Play className="w-4 h-4 fill-current" />
                            )}
                            {playback.isPlaying ? "Pause" : "Play"}
                        </button>
                    </div>

                    {/* Transcribe Button */}
                    <button
                        onClick={isRecording ? stopRecording : startRecording}
                        className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors font-medium text-sm shadow-sm hover:shadow border ${
                            isRecording 
                            ? 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border-red-200 dark:border-red-800 animate-pulse' 
                            : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700'
                        }`}
                        title="Transcribe Audio"
                    >
                        {isRecording ? <Square className="w-4 h-4 fill-current" /> : <Mic className="w-4 h-4" />}
                        <span className="hidden lg:inline">{isRecording ? "Stop Recording" : "Voice Input"}</span>
                    </button>

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
                        onTranslate={handleTranslate}
                        isTranslating={isTranslating}
                    />
                </div>

                {/* Main Content */}
                <main className="flex-1 flex flex-col relative w-full bg-white dark:bg-gray-900 transition-colors duration-300">
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
                            <div className="absolute -top-12 right-0 bg-white dark:bg-gray-800 px-3 py-1 rounded-full text-xs font-medium text-blue-600 dark:text-blue-400 shadow-md border border-blue-100 dark:border-blue-900/30 whitespace-nowrap flex items-center gap-1">
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