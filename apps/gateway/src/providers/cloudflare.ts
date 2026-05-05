import type { ProviderHandler } from './types';

/**
 * Cloudflare Workers AI API Handler
 * URL pattern: https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/ai/v1/chat/completions
 * API key: Cloudflare API token (Bearer)
 * The base_url should be: https://api.cloudflare.com or the full endpoint with account ID.
 *
 * If base_url does not contain /accounts/, we expect the key format: API_TOKEN:ACCOUNT_ID
 */

function buildCloudflareUrl(baseUrl: string, model: string, endpointType: string, accountPart?: string): string {
    const cleanUrl = baseUrl.replace(/\/+$/, '');
    // If base_url already has /accounts/ in path, use as-is with model appended
    if (cleanUrl.includes('/accounts/')) {
        const base = cleanUrl.replace(/\/v1\/.*$/, '');
        return `${base}/ai/run/${encodeURIComponent(model)}`;
    }
    // Otherwise construct from account ID (from key suffix) or default path
    const accountId = accountPart || '';
    if (accountId) {
        return `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${encodeURIComponent(model)}`;
    }
    return `${cleanUrl}/v1/chat/completions`;
}

export const CloudflareApiHandler: ProviderHandler = {
    transformRequest(body: Record<string, any>, model: string) {
        // Workers AI uses messages array, mostly OpenAI compatible
        return { ...body, model };
    },

    transformResponse(data: Record<string, any>) {
        // CF returns { success: true, result: { ... } } wrapper
        const inner = data.result || data;
        if (inner.response) {
            // Simple text response format
            return {
                id: `chatcmpl-${Date.now()}`,
                object: 'chat.completion',
                created: Math.floor(Date.now() / 1000),
                model: inner.model || 'cloudflare',
                choices: [{
                    index: 0,
                    message: { role: 'assistant', content: inner.response },
                    finish_reason: 'stop',
                }],
                usage: inner.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
            };
        }
        // OpenAI-compatible passthrough
        return inner;
    },

    extractUsage(data: Record<string, any>) {
        const usage = data.usage || data.result?.usage || {};
        return {
            promptTokens: usage.prompt_tokens || usage.input_tokens || 0,
            completionTokens: usage.completion_tokens || usage.output_tokens || 0,
        };
    },

    buildHeaders(apiKey: string) {
        // Key may be "API_TOKEN:ACCOUNT_ID"
        const token = apiKey.includes(':') ? apiKey.split(':')[0] : apiKey;
        const headers = new Headers();
        headers.set('Content-Type', 'application/json');
        headers.set('Authorization', `Bearer ${token}`);
        return headers;
    },

    overrideRequestUrl(baseUrl: string, model: string, endpointType: string) {
        const cleanUrl = baseUrl.replace(/\/+$/, '');
        // Extract account ID from the URL pattern if available
        const accountMatch = cleanUrl.match(/accounts\/([a-f0-9]+)/);
        const accountId = accountMatch?.[1] || '';
        return buildCloudflareUrl(cleanUrl, model, endpointType, accountId);
    },
};
