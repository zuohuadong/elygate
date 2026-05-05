import { ProviderHandler } from './types';

/**
 * SiliconFlow API Handler
 * SiliconFlow is OpenAI-compatible at /v1/chat/completions.
 */
export const SiliconFlowApiHandler: ProviderHandler = {
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
        };
    },

    buildHeaders(apiKey: string) {
        const headers = new Headers();
        headers.set('Content-Type', 'application/json');
        headers.set('Authorization', `Bearer ${apiKey}`);
        return headers;
    },
};
