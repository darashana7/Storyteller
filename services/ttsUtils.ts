import { AppSettings } from '../types';

export const fetchOpenAIAudio = async (
    text: string, 
    apiKey: string, 
    voice: string, 
    speed: number
): Promise<string> => {
    const response = await fetch("https://api.openai.com/v1/audio/speech", {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            model: "tts-1",
            input: text,
            voice: voice,
            speed: speed,
        }),
    });

    if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error?.message || "Failed to fetch audio from OpenAI");
    }

    const blob = await response.blob();
    return URL.createObjectURL(blob);
};

export const getBrowserVoices = (): SpeechSynthesisVoice[] => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return [];
    return window.speechSynthesis.getVoices();
};

export const speakBrowser = (
    text: string, 
    settings: AppSettings, 
    onEnd: () => void, 
    onError: (e: any) => void
): SpeechSynthesisUtterance => {
    const utterance = new SpeechSynthesisUtterance(text);
    if (settings.browserVoice) {
        utterance.voice = settings.browserVoice;
    }
    utterance.rate = settings.rate;
    utterance.pitch = settings.pitch;
    
    utterance.onend = onEnd;
    utterance.onerror = (e) => {
        if (e.error === 'interrupted' || e.error === 'canceled') return;
        onError(e);
    };

    window.speechSynthesis.speak(utterance);
    return utterance;
};