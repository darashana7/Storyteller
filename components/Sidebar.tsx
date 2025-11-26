import React from 'react';
import { AppSettings, TocItem, VoiceEngine } from '../types';
import { Settings, BookOpen, Key, Mic, Activity, Volume2, Sparkles, Languages, Globe } from 'lucide-react';
import { GEMINI_VOICES, LANGUAGES } from '../services/gemini';

interface SidebarProps {
    toc: TocItem[];
    settings: AppSettings;
    onSettingsChange: (newSettings: Partial<AppSettings>) => void;
    onNavigate: (pageIndex: number) => void;
    activeTab: 'settings' | 'chapters';
    onTabChange: (tab: 'settings' | 'chapters') => void;
    availableVoices: SpeechSynthesisVoice[];
    onTranslate: () => void;
    isTranslating: boolean;
}

export const Sidebar: React.FC<SidebarProps> = ({
    toc,
    settings,
    onSettingsChange,
    onNavigate,
    activeTab,
    onTabChange,
    availableVoices,
    onTranslate,
    isTranslating
}) => {

    const renderTocItem = (item: TocItem, depth = 0) => (
        <div key={item.title + item.pageIndex} className="select-none">
            <button
                onClick={() => item.pageIndex !== -1 && onNavigate(item.pageIndex)}
                className={`w-full text-left py-2 px-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded text-sm text-gray-700 dark:text-gray-300 transition-colors flex items-start gap-2 ${depth > 0 ? 'ml-3 border-l border-gray-200 dark:border-gray-700' : ''}`}
                style={{ paddingLeft: `${Math.max(0.5, depth * 0.8)}rem` }}
            >
                <span className={`${depth === 0 ? 'font-medium' : ''} line-clamp-2`}>
                    {item.title}
                </span>
            </button>
            {item.items && item.items.length > 0 && (
                <div className="ml-1">
                    {item.items.map((subItem) => renderTocItem(subItem, depth + 1))}
                </div>
            )}
        </div>
    );

    return (
        <aside className="w-80 bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 flex flex-col h-full z-20 shadow-xl md:shadow-none absolute md:relative transform transition-transform md:translate-x-0 transition-colors duration-300">
            {/* Tabs */}
            <div className="flex border-b border-gray-200 dark:border-gray-700">
                <button
                    onClick={() => onTabChange('settings')}
                    className={`flex-1 py-4 text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-2 transition-colors ${activeTab === 'settings' ? 'text-brand-600 dark:text-brand-400 border-b-2 border-brand-600 dark:border-brand-400 bg-brand-50 dark:bg-gray-700/50' : 'text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'}`}
                >
                    <Settings className="w-4 h-4" /> Settings
                </button>
                <button
                    onClick={() => onTabChange('chapters')}
                    disabled={toc.length === 0}
                    className={`flex-1 py-4 text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-2 transition-colors ${activeTab === 'chapters' ? 'text-brand-600 dark:text-brand-400 border-b-2 border-brand-600 dark:border-brand-400 bg-brand-50 dark:bg-gray-700/50' : 'text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'} ${toc.length === 0 ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                    <BookOpen className="w-4 h-4" /> Chapters
                </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6 custom-scroll">
                {activeTab === 'settings' ? (
                    <div className="space-y-8 animate-fade-in">
                        
                        {/* Language & Translation */}
                        <div className="space-y-4">
                            <label className="text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider flex items-center gap-2">
                                <Globe className="w-3 h-3" /> Language & Translation
                            </label>
                            
                            <div className="space-y-3">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Document Language</label>
                                    <select
                                        className="w-full text-sm border-gray-300 dark:border-gray-600 border rounded-lg p-2.5 focus:ring-2 focus:ring-brand-500 outline-none bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                                        value={settings.sourceLanguage}
                                        onChange={(e) => onSettingsChange({ sourceLanguage: e.target.value })}
                                    >
                                        {LANGUAGES.map((l) => (
                                            <option key={l.code} value={l.code}>{l.name}</option>
                                        ))}
                                    </select>
                                    <p className="text-[10px] text-gray-400 mt-1">Changes re-process the document for correct segmentation.</p>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Target Language (Translation)</label>
                                    <select
                                        className="w-full text-sm border-gray-300 dark:border-gray-600 border rounded-lg p-2.5 focus:ring-2 focus:ring-brand-500 outline-none bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                                        value={settings.targetLanguage}
                                        onChange={(e) => onSettingsChange({ targetLanguage: e.target.value })}
                                    >
                                        {LANGUAGES.map((l) => (
                                            <option key={l.code} value={l.code}>{l.name}</option>
                                        ))}
                                    </select>
                                </div>

                                <button
                                    onClick={onTranslate}
                                    disabled={isTranslating}
                                    className={`w-full flex items-center justify-center gap-2 py-2 px-4 rounded-lg text-sm font-medium text-white transition-all shadow-sm ${
                                        isTranslating 
                                        ? 'bg-brand-400 cursor-wait' 
                                        : 'bg-brand-600 hover:bg-brand-700 hover:shadow'
                                    }`}
                                >
                                    {isTranslating ? (
                                        <>
                                            <Languages className="w-4 h-4 animate-pulse" /> Translating...
                                        </>
                                    ) : (
                                        <>
                                            <Languages className="w-4 h-4" /> Translate Document
                                        </>
                                    )}
                                </button>
                            </div>
                        </div>

                        <hr className="border-gray-100 dark:border-gray-700" />

                        {/* Engine Selection */}
                        <div className="space-y-3">
                            <label className="text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider">Voice Engine</label>
                            <div className="grid grid-cols-3 gap-2">
                                <button
                                    onClick={() => onSettingsChange({ engine: 'browser' })}
                                    className={`py-2 px-1 text-xs font-medium rounded-lg border transition-all ${settings.engine === 'browser' ? 'bg-brand-50 dark:bg-brand-900/20 border-brand-200 dark:border-brand-700 text-brand-700 dark:text-brand-300 ring-1 ring-brand-200 dark:ring-brand-800' : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'}`}
                                >
                                    Browser
                                </button>
                                <button
                                    onClick={() => onSettingsChange({ engine: 'openai' })}
                                    className={`py-2 px-1 text-xs font-medium rounded-lg border transition-all ${settings.engine === 'openai' ? 'bg-brand-50 dark:bg-brand-900/20 border-brand-200 dark:border-brand-700 text-brand-700 dark:text-brand-300 ring-1 ring-brand-200 dark:ring-brand-800' : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'}`}
                                >
                                    OpenAI
                                </button>
                                <button
                                    onClick={() => onSettingsChange({ engine: 'google' })}
                                    className={`py-2 px-1 text-xs font-medium rounded-lg border transition-all ${settings.engine === 'google' ? 'bg-brand-50 dark:bg-brand-900/20 border-brand-200 dark:border-brand-700 text-brand-700 dark:text-brand-300 ring-1 ring-brand-200 dark:ring-brand-800' : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'}`}
                                >
                                    Gemini
                                </button>
                            </div>
                        </div>

                        {settings.engine === 'google' && (
                             <div className="space-y-4 pt-2 border-l-2 border-brand-200 dark:border-brand-800 pl-3">
                                 <div className="bg-brand-50 dark:bg-brand-900/20 p-3 rounded text-xs text-brand-800 dark:text-brand-200 flex gap-2">
                                    <Sparkles className="w-4 h-4 shrink-0 mt-0.5" />
                                    <div>
                                        <span className="font-bold">Smart Emotion:</span> Gemini will analyze the text context and narrate with appropriate emotions (Happy, Sad, Angry, etc.).
                                    </div>
                                 </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1 flex items-center gap-2">
                                        <Mic className="w-4 h-4 text-gray-400" /> Gemini Voice
                                    </label>
                                    <select
                                        className="w-full text-sm border-gray-300 dark:border-gray-600 border rounded-lg p-2.5 focus:ring-2 focus:ring-brand-500 outline-none bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                                        value={settings.googleVoice}
                                        onChange={(e) => onSettingsChange({ googleVoice: e.target.value })}
                                    >
                                        {GEMINI_VOICES.map((v) => (
                                            <option key={v} value={v} className="capitalize">{v}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>
                        )}

                        {settings.engine === 'openai' && (
                            <div className="space-y-4 pt-2">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1 flex items-center gap-2">
                                        <Key className="w-4 h-4 text-gray-400" /> API Key
                                    </label>
                                    <input
                                        type="password"
                                        value={settings.openaiKey}
                                        onChange={(e) => onSettingsChange({ openaiKey: e.target.value })}
                                        placeholder="sk-..."
                                        className="w-full text-sm border-gray-300 dark:border-gray-600 border rounded-lg p-2.5 focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none transition-shadow bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                                    />
                                    <p className="text-xs text-gray-400 mt-1.5">Key is stored locally in your browser.</p>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1 flex items-center gap-2">
                                        <Mic className="w-4 h-4 text-gray-400" /> Voice Model
                                    </label>
                                    <select
                                        className="w-full text-sm border-gray-300 dark:border-gray-600 border rounded-lg p-2.5 focus:ring-2 focus:ring-brand-500 outline-none bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                                        value={settings.openaiVoice}
                                        onChange={(e) => onSettingsChange({ openaiVoice: e.target.value })}
                                    >
                                        {['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'].map((v) => (
                                            <option key={v} value={v} className="capitalize">{v}</option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <div className="flex justify-between mb-2">
                                        <label className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-2">
                                            <Activity className="w-4 h-4 text-gray-400" /> Speed
                                        </label>
                                        <span className="text-xs font-mono bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded text-gray-600 dark:text-gray-300">{settings.rate}x</span>
                                    </div>
                                    <input
                                        type="range" min="0.5" max="2.0" step="0.1"
                                        value={settings.rate}
                                        onChange={(e) => onSettingsChange({ rate: parseFloat(e.target.value) })}
                                        className="w-full h-1.5 bg-gray-200 dark:bg-gray-600 rounded-lg appearance-none cursor-pointer accent-brand-600 dark:accent-brand-500"
                                    />
                                    <div className="flex justify-between text-[10px] text-gray-400 dark:text-gray-500 mt-1 uppercase tracking-wide font-medium">
                                        <span>Slow</span>
                                        <span>Fast</span>
                                    </div>
                                </div>
                            </div>
                        )}
                        
                        {settings.engine === 'browser' && (
                            <div className="space-y-4 pt-2">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1 flex items-center gap-2">
                                        <Mic className="w-4 h-4 text-gray-400" /> System Voice
                                    </label>
                                    <select
                                        className="w-full text-sm border-gray-300 dark:border-gray-600 border rounded-lg p-2.5 focus:ring-2 focus:ring-brand-500 outline-none bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                                        value={settings.browserVoice?.name || ""}
                                        onChange={(e) => {
                                            const voice = availableVoices.find(v => v.name === e.target.value);
                                            onSettingsChange({ browserVoice: voice || null });
                                        }}
                                    >
                                        {availableVoices.map((v) => (
                                            <option key={v.name} value={v.name}>
                                                {v.name.length > 30 ? v.name.substring(0, 30) + '...' : v.name} ({v.lang})
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <div className="flex justify-between mb-2">
                                        <label className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-2">
                                            <Activity className="w-4 h-4 text-gray-400" /> Speed
                                        </label>
                                        <span className="text-xs font-mono bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded text-gray-600 dark:text-gray-300">{settings.rate}x</span>
                                    </div>
                                    <input
                                        type="range" min="0.5" max="2.0" step="0.1"
                                        value={settings.rate}
                                        onChange={(e) => onSettingsChange({ rate: parseFloat(e.target.value) })}
                                        className="w-full h-1.5 bg-gray-200 dark:bg-gray-600 rounded-lg appearance-none cursor-pointer accent-brand-600 dark:accent-brand-500"
                                    />
                                    <div className="flex justify-between text-[10px] text-gray-400 dark:text-gray-500 mt-1 uppercase tracking-wide font-medium">
                                        <span>Slow</span>
                                        <span>Fast</span>
                                    </div>
                                </div>
                                <div>
                                    <div className="flex justify-between mb-2">
                                        <label className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-2">
                                            <Volume2 className="w-4 h-4 text-gray-400" /> Pitch
                                        </label>
                                        <span className="text-xs font-mono bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded text-gray-600 dark:text-gray-300">{settings.pitch}</span>
                                    </div>
                                    <input
                                        type="range" min="0.5" max="2" step="0.1"
                                        value={settings.pitch}
                                        onChange={(e) => onSettingsChange({ pitch: parseFloat(e.target.value) })}
                                        className="w-full h-1.5 bg-gray-200 dark:bg-gray-600 rounded-lg appearance-none cursor-pointer accent-brand-600 dark:accent-brand-500"
                                    />
                                </div>
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="space-y-1">
                        {toc.length > 0 ? (
                            toc.map((item) => renderTocItem(item))
                        ) : (
                            <div className="text-center text-gray-400 dark:text-gray-500 text-sm py-12 px-4 border border-dashed border-gray-200 dark:border-gray-700 rounded-lg">
                                <BookOpen className="w-8 h-8 mx-auto mb-2 opacity-20" />
                                <p>No chapters found in this PDF.</p>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </aside>
    );
};