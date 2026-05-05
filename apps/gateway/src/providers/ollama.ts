import { ProviderHandler } from './types';

/**
 * Ollama API Handler
 * Ollama exposes OpenAI-compatible endpoints at /v1/chat/completions, /v1/embeddings etc.
 * No auth header needed by default.
 */
export const OllamaApiHandler: ProviderHandler = {
    transformRequest(body: Record<string, any>, model: string) {
        return { ...body, model };
    },

    transformResponse(data: Record<string, any>) {
        return data;
    },

    extractUsage(data: Record<string, any>) {
        return {
            promptTokens: data.usage?.prompt_tokens || data.prompt_eval_count || 0,
            completionTokens: data.usage?.completion_tokens || data.eval_count || 0,
        };
    },

    buildHeaders(_apiKey: string) {
        const headers = new Headers();
        headers.set('Content-Type', 'application/json');
        return headers;
    },
};
