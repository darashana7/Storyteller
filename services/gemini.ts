import { GoogleGenAI, Modality } from "@google/genai";

// Initialize Gemini Client
// Using process.env.API_KEY as required by the environment
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });

export const GEMINI_VOICES = ['Puck', 'Charon', 'Kore', 'Fenrir', 'Zephyr'];

/**
 * Analyzes the text to determine the appropriate narrative emotion/tone.
 * Uses a window of context (previous + next 5 sentences) for accuracy.
 */
export const detectEmotion = async (
    text: string, 
    previousText: string | undefined, 
    upcomingContext: string[]
): Promise<string> => {
    try {
        // Escape quotes to prevent prompt injection/confusion
        const safeText = text.replace(/"/g, "'");
        const safePrevious = previousText ? previousText.replace(/"/g, "'") : '';
        const safeUpcoming = upcomingContext.map(s => s.replace(/"/g, "'")).join(' ');

        let prompt = `You are a professional audiobook narrator. Your task is to determine the single best emotional tone for the "Target Sentence" below.
        
Context:
${safePrevious ? `Previous sentence: "${safePrevious}"` : ''}
Target Sentence: "${safeText}"
${safeUpcoming ? `Upcoming Context (next 5 lines): "${safeUpcoming}"` : ''}

Based on the target sentence and the upcoming context, choose one adjective that best describes how to read the target sentence (e.g., Cheerful, Angry, Sad, Suspicious, Neutral, Excited, Funny, Serious, Fearful, Whispering, Shouting).
Return ONLY the adjective.`;

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
        });

        return response.text?.trim() || 'Neutral';
    } catch (error) {
        console.warn('Gemini Emotion Detection Failed:', error);
        return 'Neutral'; // Fallback
    }
};

/**
 * Generates speech using Gemini TTS with a specific emotion.
 */
export const generateGeminiSpeech = async (
    text: string,
    voiceName: string,
    emotion: string
): Promise<ArrayBuffer | null> => {
    try {
        // Use a directive prompt structure that clearly separates instruction from content
        // to prevent the model from reading the instruction (e.g. "Angry:") as part of the speech.
        const ttsPrompt = `Speak the following text with a ${emotion} tone: "${text}"`;
        
        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash-preview-tts",
            contents: [{ parts: [{ text: ttsPrompt }] }],
            config: {
                responseModalities: [Modality.AUDIO],
                speechConfig: {
                    voiceConfig: {
                        prebuiltVoiceConfig: { voiceName: voiceName || 'Puck' },
                    },
                },
            },
        });

        const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        if (!base64Audio) return null;

        // Convert base64 to ArrayBuffer manually (polyfill for environments without buffer lib)
        const binaryString = atob(base64Audio);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        return bytes.buffer;

    } catch (error) {
        console.error('Gemini TTS Failed:', error);
        throw error;
    }
};

/**
 * Decodes raw PCM data from Gemini (24kHz, Mono) into an AudioBuffer.
 */
export async function decodeGeminiAudio(
    audioData: ArrayBuffer,
    audioContext: AudioContext
): Promise<AudioBuffer> {
    // Gemini output is typically 16-bit PCM, 24kHz, Mono.
    const sampleRate = 24000;
    const numChannels = 1;
    
    const dataView = new DataView(audioData);
    // 16-bit samples = 2 bytes per sample
    const numSamples = Math.floor(audioData.byteLength / 2);
    
    const audioBuffer = audioContext.createBuffer(numChannels, numSamples, sampleRate);
    const channelData = audioBuffer.getChannelData(0);

    for (let i = 0; i < numSamples; i++) {
        // Convert Int16 to Float32 (-1.0 to 1.0)
        // Ensure we don't go out of bounds if byteLength is odd (unlikely but safe)
        const offset = i * 2;
        if (offset + 1 < audioData.byteLength) {
            const sample = dataView.getInt16(offset, true); // Little-endian
            channelData[i] = sample / 32768.0;
        }
    }

    return audioBuffer;
}