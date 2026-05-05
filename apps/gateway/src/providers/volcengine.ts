import type { ProviderHandler } from './types';

/**
 * VolcEngine (Doubao/ByteDance) API Handler
 * VolcEngine exposes OpenAI-compatible endpoints at their Ark platform.
 * Base URL: https://ark.cn-beijing.volces.com/api/v3
 * API key: standard Bearer token from VolcEngine console.
 *
 * Also handles DoubaoVideo (ChannelType.DOUBAO_VIDEO = 54) which uses
 * the same auth but different endpoints for video generation tasks.
 */

export const VolcEngineApiHandler: ProviderHandler = {
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

    overrideRequestUrl(baseUrl: string, model: string, endpointType: string) {
        const cleanUrl = baseUrl.replace(/\/+$/, '');
        if (endpointType === 'embeddings') {
            return `${cleanUrl}/api/v3/embeddings`;
        }
        if (endpointType === 'images') {
            return `${cleanUrl}/api/v3/images/generations`;
        }
        return `${cleanUrl}/api/v3/chat/completions`;
    },
};
