import type { ProviderHandler } from './types';

export const CozeApiHandler: ProviderHandler = {
    transformRequest(body: Record<string, any>, model: string) {
        return { ...body, bot_id: body.bot_id || model };
    },

    transformResponse(data: Record<string, any>) {
        return data;
    },

    extractUsage(data: Record<string, any>) {
        const usage = data.usage || data.data?.usage || {};
        return {
            promptTokens: usage.prompt_tokens || usage.input_count || 0,
            completionTokens: usage.completion_tokens || usage.output_count || 0,
        };
    },

    buildHeaders(apiKey: string) {
        const headers = new Headers();
        headers.set('Content-Type', 'application/json');
        headers.set('Authorization', `Bearer ${apiKey}`);
        return headers;
    },
};
