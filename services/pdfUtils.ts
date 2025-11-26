import { PdfData, TocItem } from '../types';

// We access pdfjsLib from the window object as it is loaded via CDN in index.html
declare global {
    interface Window {
        pdfjsLib: any;
    }
}

const resolveOutline = async (pdf: any, items: any[]): Promise<TocItem[]> => {
    const resolvedItems: TocItem[] = [];
    for (const item of items) {
        let pageIndex = -1;
        try {
            if (typeof item.dest === 'string') {
                const dest = await pdf.getDestination(item.dest);
                if (dest) pageIndex = await pdf.getPageIndex(dest[0]);
            } else if (Array.isArray(item.dest)) {
                pageIndex = await pdf.getPageIndex(item.dest[0]);
            }
        } catch (e) {
            console.warn("Could not resolve TOC item:", item.title, e);
        }

        const children = item.items && item.items.length > 0
            ? await resolveOutline(pdf, item.items)
            : [];

        resolvedItems.push({
            title: item.title,
            pageIndex,
            items: children
        });
    }
    return resolvedItems;
};

export const parsePdf = async (file: File): Promise<PdfData> => {
    const arrayBuffer = await file.arrayBuffer();
    const loadingTask = window.pdfjsLib.getDocument(new Uint8Array(arrayBuffer));
    const pdf = await loadingTask.promise;

    let extractedSentences: string[] = [];
    let pageMapping: number[] = [];

    // Initialize Intl.Segmenter if available (ES2022+)
    // This provides much better sentence detection than regex, handling abbreviations (Mr., Dr.) correctly.
    const segmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl 
        // @ts-ignore: TypeScript might not have Intl.Segmenter in older lib definitions
        ? new Intl.Segmenter('en', { granularity: 'sentence' }) 
        : null;

    for (let i = 1; i <= pdf.numPages; i++) {
        pageMapping.push(extractedSentences.length);
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        
        // Basic text extraction
        const pageText = textContent.items.map((item: any) => item.str).join(' ');
        
        // Sanitize: collapse multiple spaces into one
        const cleanText = pageText.replace(/\s+/g, ' ');
        
        let sentences: string[] = [];

        if (segmenter) {
            // Robust segmentation
            const segments = segmenter.segment(cleanText);
            for (const { segment } of segments) {
                const trimmed = segment.trim();
                if (trimmed.length > 0) {
                    sentences.push(trimmed);
                }
            }
        } else {
            // Fallback Regex for older environments
            // Splits on periods, exclamation, questions that are followed by space or end of string
            // Also handles quotes roughly.
            const raw = cleanText.match(/[^.!?]+[.!?]+["']?|[^.!?]+$/g);
            if (raw) {
                sentences = raw.map((s: string) => s.trim()).filter((s: string) => s.length > 0);
            }
        }

        if (sentences.length > 0) {
            extractedSentences = [...extractedSentences, ...sentences];
        }
    }

    let toc: TocItem[] = [];
    try {
        const outline = await pdf.getOutline();
        if (outline) {
            toc = await resolveOutline(pdf, outline);
        }
    } catch (err) {
        console.warn("No TOC found or error parsing TOC", err);
    }

    return {
        textSegments: extractedSentences,
        pageMapping,
        toc
    };
};