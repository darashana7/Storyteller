import React, { useEffect, useRef } from 'react';
import { Upload } from 'lucide-react';
import { VoiceEngine } from '../types';

interface ReaderDisplayProps {
    sentences: string[];
    currentIndex: number;
    isLoading: boolean;
    isProcessingPdf: boolean;
    onSentenceClick: (index: number) => void;
    onFileUpload: (file: File) => void;
    engine: VoiceEngine;
}

export const ReaderDisplay: React.FC<ReaderDisplayProps> = ({
    sentences,
    currentIndex,
    isLoading,
    isProcessingPdf,
    onSentenceClick,
    onFileUpload,
    engine
}) => {
    const activeRef = useRef<HTMLSpanElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    // Auto-scroll to active sentence
    useEffect(() => {
        if (activeRef.current && containerRef.current) {
            const container = containerRef.current;
            const element = activeRef.current;
            
            // Simple logic: Scroll element to center
            const elementTop = element.offsetTop;
            const elementHeight = element.offsetHeight;
            const containerHeight = container.offsetHeight;
            
            container.scrollTo({
                top: elementTop - containerHeight / 2 + elementHeight / 2,
                behavior: 'smooth'
            });
        }
    }, [currentIndex]);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            onFileUpload(e.target.files[0]);
        }
    };

    if (isProcessingPdf) {
        return (
            <div className="flex flex-col items-center justify-center h-full text-gray-500 dark:text-gray-400 space-y-4">
                <div className="w-12 h-12 border-4 border-brand-200 dark:border-brand-800 border-t-brand-600 dark:border-t-brand-500 rounded-full animate-spin"></div>
                <p className="font-medium animate-pulse">Analyzing document & building library...</p>
            </div>
        );
    }

    if (sentences.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-full text-center p-8">
                <div className="w-24 h-24 bg-brand-50 dark:bg-gray-800 rounded-full flex items-center justify-center mb-6 text-brand-300 dark:text-gray-600">
                    <Upload className="w-10 h-10 text-brand-500 dark:text-brand-400" />
                </div>
                <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-200 mb-2">No Document Loaded</h2>
                <p className="text-gray-500 dark:text-gray-400 max-w-md mb-8">
                    Upload a PDF file to begin the storytelling experience. We'll extract the text and read it to you.
                </p>
                <label className="cursor-pointer bg-brand-600 hover:bg-brand-700 dark:bg-brand-600 dark:hover:bg-brand-500 text-white px-8 py-3 rounded-full transition shadow-lg shadow-brand-200 dark:shadow-none hover:shadow-xl transform hover:-translate-y-0.5 font-medium flex items-center gap-2">
                    <Upload className="w-4 h-4" />
                    Select PDF
                    <input type="file" accept="application/pdf" onChange={handleFileChange} className="hidden" />
                </label>
            </div>
        );
    }

    return (
        <div ref={containerRef} className="flex-1 overflow-y-auto p-6 md:p-12 lg:p-20 custom-scroll bg-[#fcfbf9] dark:bg-gray-900 transition-colors duration-300">
            <div className="max-w-3xl mx-auto">
                <div className="font-serif text-xl md:text-2xl leading-[1.8] text-gray-800 dark:text-gray-200 space-y-4 text-justify">
                    {sentences.map((sentence, index) => {
                        const isActive = currentIndex === index;
                        // Determine highlight color based on engine
                        let highlightClass = 'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-900 dark:text-yellow-100 shadow-sm decoration-clone'; // Default/Browser
                        if (engine === 'openai') highlightClass = 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-900 dark:text-indigo-100 shadow-sm decoration-clone';
                        if (engine === 'google') highlightClass = 'bg-cyan-100 dark:bg-cyan-900/40 text-cyan-900 dark:text-cyan-100 shadow-sm decoration-clone ring-2 ring-cyan-200 dark:ring-cyan-800/50';

                        return (
                            <span
                                key={index}
                                id={`s-${index}`}
                                ref={isActive ? activeRef : null}
                                onClick={() => onSentenceClick(index)}
                                className={`
                                    cursor-pointer rounded px-1 transition-all duration-300
                                    ${isActive 
                                        ? highlightClass
                                        : 'hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300'}
                                    ${isActive && isLoading ? 'animate-pulse opacity-70' : ''}
                                `}
                            >
                                {sentence}{' '}
                            </span>
                        );
                    })}
                </div>
                {/* Spacer for bottom scrolling */}
                <div className="h-48"></div>
            </div>
        </div>
    );
};