import type { ProviderHandler } from './types';

export const TencentHunyuanApiHandler: ProviderHandler = {
    transformRequest(body: Record<string, any>, model: string) {
        return { ...body, model };
    },

    transformResponse(data: Record<string, any>) {
        return data.Response || data;
    },

    extractUsage(data: Record<string, any>) {
        const usage = data.usage || data.Usage || data.Response?.Usage || {};
        return {
            promptTokens: usage.prompt_tokens || usage.PromptTokens || 0,
            completionTokens: usage.completion_tokens || usage.CompletionTokens || 0,
        };
    },

    buildHeaders(apiKey: string) {
        const headers = new Headers();
        headers.set('Content-Type', 'application/json');
        headers.set('Authorization', `Bearer ${apiKey}`);
        return headers;
    },
};
