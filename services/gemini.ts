import { GoogleGenAI, Modality, Type } from "@google/genai";

// Initialize Gemini Client
// Using process.env.API_KEY as required by the environment
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });

export const GEMINI_VOICES = ['Puck', 'Charon', 'Kore', 'Fenrir', 'Zephyr'];

export const LANGUAGES = [
    { code: 'en', name: 'English' },
    { code: 'es', name: 'Spanish' },
    { code: 'fr', name: 'French' },
    { code: 'de', name: 'German' },
    { code: 'it', name: 'Italian' },
    { code: 'pt', name: 'Portuguese' },
    { code: 'zh', name: 'Chinese (Simplified)' },
    { code: 'ja', name: 'Japanese' },
    { code: 'ko', name: 'Korean' },
    { code: 'hi', name: 'Hindi' },
    { code: 'ru', name: 'Russian' }
];

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
The text may be in any language, but you must return the emotion adjective in English.
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

/**
 * Transcribes audio using Gemini 2.5 Flash.
 */
export const transcribeAudio = async (base64Audio: string, mimeType: string): Promise<string> => {
    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: {
                parts: [
                    {
                        inlineData: {
                            mimeType: mimeType,
                            data: base64Audio
                        }
                    },
                    { text: "Transcribe this audio exactly as spoken. Return only the transcription text, no preamble." }
                ]
            }
        });
        return response.text || "";
    } catch (error) {
        console.error("Transcription error:", error);
        throw error;
    }
};

/**
 * Translates a batch of text segments to a target language using Gemini.
 */
export const translateBatch = async (
    texts: string[],
    targetLanguage: string
): Promise<string[]> => {
    if (texts.length === 0) return [];

    try {
        // Construct a structured prompt to ensure 1:1 translation
        const prompt = `You are a professional translator. Translate the following JSON array of sentences into ${targetLanguage}. 
        Rules:
        1. Maintain the exact same number of elements in the array.
        2. Preserve the order of sentences.
        3. Do not merge or split sentences.
        4. Return ONLY the JSON array of strings, no markdown code blocks or explanations.
        
        Input Array:
        ${JSON.stringify(texts)}`;

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
            config: {
                responseMimeType: 'application/json',
                responseSchema: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING }
                }
            }
        });

        const jsonStr = response.text?.trim() || "[]";
        try {
            const parsed = JSON.parse(jsonStr);
            if (Array.isArray(parsed)) {
                return parsed;
            }
            return texts; // Fallback if format is wrong
        } catch (e) {
            console.error("JSON parse error for translation:", e);
            return texts;
        }

    } catch (error) {
        console.error("Translation failed:", error);
        throw error;
    }
};