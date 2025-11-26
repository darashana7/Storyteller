export interface TocItem {
    title: string;
    pageIndex: number;
    items: TocItem[];
}

export interface PdfData {
    textSegments: string[];
    pageMapping: number[]; // Index of the first sentence on each page
    toc: TocItem[];
}

export type VoiceEngine = 'browser' | 'openai' | 'google';

export interface AppSettings {
    engine: VoiceEngine;
    browserVoice: SpeechSynthesisVoice | null;
    openaiKey: string;
    openaiVoice: string; // 'alloy', 'echo', etc.
    googleVoice: string; // 'Puck', 'Kore', etc.
    rate: number;
    pitch: number; // Only for browser
    darkMode: boolean;
    sourceLanguage: string; // 'en', 'es', etc.
    targetLanguage: string; // 'en', 'es', etc.
}

export interface PlaybackState {
    isPlaying: boolean;
    isLoading: boolean;
    currentIndex: number;
    detectedEmotion?: string;
}