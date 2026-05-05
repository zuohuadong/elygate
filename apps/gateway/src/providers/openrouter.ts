import { ProviderHandler } from './types';

/**
 * OpenRouter API Handler
 * OpenRouter is OpenAI-compatible but adds model routing and special headers.
 */
export const OpenRouterApiHandler: ProviderHandler = {
    transformRequest(body: Record<string, any>, model: string) {
        return { ...body, model };
    },

    transformResponse(data: Record<string, any>) {
        return data;
    },

    extractUsage(data: Record<string, any>) {
        return {
            promptTokens: data.usage?.prompt_tokens || 0,
            completionTokens: data.usage?.completion_tokens || 0,
            cachedTokens: data.usage?.prompt_tokens_details?.cached_tokens,
        };
    },

    buildHeaders(apiKey: string) {
        const headers = new Headers();
        headers.set('Content-Type', 'application/json');
        headers.set('Authorization', `Bearer ${apiKey}`);
        headers.set('HTTP-Referer', 'https://elygate.app');
        headers.set('X-Title', 'Elygate');
        return headers;
    },
};
