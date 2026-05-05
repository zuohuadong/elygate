import type { ProviderHandler } from './types';

export const AwsBedrockApiHandler: ProviderHandler = {
    transformRequest(body: Record<string, any>, model: string) {
        return { ...body, model };
    },

    transformResponse(data: Record<string, any>) {
        return data;
    },

    extractUsage(data: Record<string, any>) {
        return {
            promptTokens: data.usage?.prompt_tokens || data.usage?.inputTokens || data.usage?.input_tokens || 0,
            completionTokens: data.usage?.completion_tokens || data.usage?.outputTokens || data.usage?.output_tokens || 0,
        };
    },

    buildHeaders(apiKey: string) {
        const headers = new Headers();
        headers.set('Content-Type', 'application/json');
        if (apiKey) headers.set('Authorization', `Bearer ${apiKey}`);
        return headers;
    },
};
