import { memoryCache } from './cache';

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
