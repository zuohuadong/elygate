import type { ProviderHandler } from './types';

export const CloudflareApiHandler: ProviderHandler = {
    transformRequest(body: Record<string, any>, model: string) {
        return { ...body, model };
    },

    transformResponse(data: Record<string, any>) {
        return data.result || data;
    },

    extractUsage(data: Record<string, any>) {
        const usage = data.usage || data.result?.usage || {};
        return {
            promptTokens: usage.prompt_tokens || usage.input_tokens || 0,
            completionTokens: usage.completion_tokens || usage.output_tokens || 0,
        };
    },

    buildHeaders(apiKey: string) {
        const headers = new Headers();
        headers.set('Content-Type', 'application/json');
        headers.set('Authorization', `Bearer ${apiKey}`);
        return headers;
    },
};
