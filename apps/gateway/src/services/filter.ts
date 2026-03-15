import { memoryCache } from './cache';

/**
 * Model internal special tokens that should be filtered from responses
 */
const MODEL_INTERNAL_TOKENS = [
    /<\|tool_call_end\|>/g,
    /<\|tool_calls_section_end\|>/g,
    /<\|tool_calls_section_begin\|>/g,
    /<\|tool_call_begin\|>/g,
    /<\|tool_call\|>/g,
    /<\|raw_action\|>/g,
    /<\|raw_function_call\|>/g,
    /<\|function_call\|>/g,
    /<\|code_begin\|>/g,
    /<\|code_end\|>/g,
    /<\|interpreter\|>/g,
    /<\|endofprompt\|>/g,
    /<\|endoftext\|>/g,
];

/**
 * Clean model internal tokens from text
 */
export function cleanModelTokens(text: string): string {
    if (!text || typeof text !== 'string') return text;
    let cleaned = text;
    for (const pattern of MODEL_INTERNAL_TOKENS) {
        cleaned = cleaned.replace(pattern, '');
    }
    return cleaned.trim();
}

/**
 * Clean model internal tokens from response object
 */
export function cleanResponseTokens(data: any): any {
    if (!data) return data;
    
    if (typeof data === 'string') {
        return cleanModelTokens(data);
    }
    
    if (Array.isArray(data)) {
        return data.map(item => cleanResponseTokens(item));
    }
    
    if (typeof data === 'object') {
        const cleaned: any = {};
        for (const [key, value] of Object.entries(data)) {
            if (key === 'content' && typeof value === 'string') {
                cleaned[key] = cleanModelTokens(value);
            } else if (key === 'text' && typeof value === 'string') {
                cleaned[key] = cleanModelTokens(value);
            } else {
                cleaned[key] = cleanResponseTokens(value);
            }
        }
        return cleaned;
    }
    
    return data;
}

/**
 * Enterprise Content Filter (DLP)
 * Supports global and group-specific regex patterns to block sensitive data or inappropriate content.
 */
export class ContentFilter {
    static async validate(text: string, group: string): Promise<{ blocked: boolean; pattern?: string }> {
        if (!text) return { blocked: false };

        const groupPolicy = memoryCache.userGroups.get(group);
        const patterns: string[] = [];

        // 1. Gather global forbidden patterns (from options or group policy)
        if (groupPolicy?.forbiddenPatterns) {
            patterns.push(...groupPolicy.forbiddenPatterns);
        }

        if (patterns.length === 0) return { blocked: false };

        for (const p of patterns) {
            try {
                const regex = new RegExp(p, 'i');
                if (regex.test(text)) {
                    return { blocked: true, pattern: p };
                }
            } catch (e) {
                console.warn(`[ContentFilter] Invalid regex pattern: ${p}`);
            }
        }

        return { blocked: false };
    }

    /**
     * Extracts all text from a request body for validation.
     */
    static extractText(body: any): string {
        if (typeof body === 'string') return body;
        if (Array.isArray(body)) return body.map(this.extractText).join(' ');
        
        let text = '';
        if (body.messages && Array.isArray(body.messages)) {
            text += body.messages.map((m: any) => typeof m.content === 'string' ? m.content : JSON.stringify(m.content)).join(' ');
        }
        if (body.prompt) text += ` ${body.prompt}`;
        if (body.input) text += ` ${typeof body.input === 'string' ? body.input : JSON.stringify(body.input)}`;
        
        return text;
    }
}
