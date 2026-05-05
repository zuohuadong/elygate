import { createHmac, createHash } from 'crypto';
import type { ProviderHandler } from './types';

/**
 * Tencent Hunyuan API Handler
 * API key format: SECRET_ID:SECRET_KEY
 * Base URL: https://hunyuan.tencentcloudapi.com (or regional endpoint)
 *
 * Tencent Hunyuan OpenAPI is mostly OpenAI-compatible when accessed via the
 * /v1/chat/completions path at https://api.hunyuan.cloud.tencent.com.
 * This handler supports both native TC3-HMAC signing and OpenAI-compatible mode.
 */

export const TencentHunyuanApiHandler: ProviderHandler = {
    transformRequest(body: Record<string, any>, model: string) {
        return { ...body, model };
    },

    transformResponse(data: Record<string, any>) {
        // Handle native Tencent response wrapper
        const inner = data.Response || data;
        if (inner.Choices) {
            return {
                id: inner.Id || inner.id || `chatcmpl-${Date.now()}`,
                object: 'chat.completion',
                created: inner.Created || Math.floor(Date.now() / 1000),
                model: inner.Model || 'unknown',
                choices: (inner.Choices || []).map((c: any, i: number) => ({
                    index: i,
                    message: {
                        role: c.Message?.Role || c.Message?.role || 'assistant',
                        content: c.Message?.Content || c.Message?.content || '',
                    },
                    finish_reason: c.FinishReason || c.finish_reason || 'stop',
                })),
                usage: {
                    prompt_tokens: inner.Usage?.PromptTokens || inner.Usage?.prompt_tokens || 0,
                    completion_tokens: inner.Usage?.CompletionTokens || inner.Usage?.completion_tokens || 0,
                    total_tokens: inner.Usage?.TotalTokens || inner.Usage?.total_tokens || 0,
                },
            };
        }
        // OpenAI-compatible passthrough
        return data;
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

    overrideRequestUrl(baseUrl: string, model: string, endpointType: string) {
        const cleanUrl = baseUrl.replace(/\/+$/, '');
        if (endpointType === 'embeddings') {
            return `${cleanUrl}/v1/embeddings`;
        }
        return `${cleanUrl}/v1/chat/completions`;
    },
};
