import { ProviderHandler } from './types';

/**
 * NVIDIA NIM API Provider Handler
 * 
 * NVIDIA NIM supports OpenAI-compatible endpoints for chat completions.
 * For specialized models (images, audio, video), NVIDIA uses different endpoints.
 * 
 * Chat: /v1/chat/completions (OpenAI compatible)
 * Embeddings: /v1/embeddings (OpenAI compatible)
 * Images: /v1/images/generations (may not be available on all models)
 * 
 * Reference: https://build.nvidia.com/explore/discover/models
 */
export class NvidiaApiHandler implements ProviderHandler {

    transformRequest(body: Record<string, any>, model: string) {
        const transformed: Record<string, any> = {
            ...body,
            model
        };

        return transformed;
    }

    transformResponse(data: any) {
        return data;
    }

    extractUsage(data: any) {
        return {
            promptTokens: data.usage?.prompt_tokens || 0,
            completionTokens: data.usage?.completion_tokens || 0,
        };
    }

    buildHeaders(apiKey: string) {
        const headers = new Headers();
        headers.set('Content-Type', 'application/json');
        headers.set('Authorization', `Bearer ${apiKey}`);
        return headers;
    }
}
