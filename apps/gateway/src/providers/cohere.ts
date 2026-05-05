import { ProviderHandler } from './types';

/**
 * Cohere API Handler
 * Cohere v2 chat API is OpenAI-compatible at /v2/chat but uses different auth header.
 */
export const CohereApiHandler: ProviderHandler = {
    transformRequest(body: Record<string, any>, model: string) {
        return { ...body, model };
    },

    transformResponse(data: Record<string, any>) {
        return data;
    },

    extractUsage(data: Record<string, any>) {
        const meta = data.meta || {};
        const tokens = meta.tokens || {};
        return {
            promptTokens: tokens.input_tokens || data.usage?.prompt_tokens || 0,
            completionTokens: tokens.output_tokens || data.usage?.completion_tokens || 0,
        };
    },

    buildHeaders(apiKey: string) {
        const headers = new Headers();
        headers.set('Content-Type', 'application/json');
        headers.set('Authorization', `Bearer ${apiKey}`);
        return headers;
    },
};
