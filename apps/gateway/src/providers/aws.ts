import { createHmac, createHash } from 'crypto';
import type { ProviderHandler } from './types';

/**
 * AWS Bedrock API Handler
 * Handles SigV4 signing for AWS Bedrock Runtime API.
 * Expected base_url format: https://bedrock-runtime.{region}.amazonaws.com
 * API key field should contain: AWS_ACCESS_KEY_ID:AWS_SECRET_ACCESS_KEY[:AWS_SESSION_TOKEN]
 */

function getAmzDate() {
    return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function getDateStamp() {
    return new Date().toISOString().slice(0, 10).replace(/-/g, '');
}

function hmacSha256(key: Buffer | string, data: string): Buffer {
    return createHmac('sha256', key).update(data).digest();
}

function sha256Hex(data: string): string {
    return createHash('sha256').update(data).digest('hex');
}

function signV4(method: string, url: URL, headers: Record<string, string>, body: string, accessKey: string, secretKey: string, sessionToken?: string) {
    const region = url.hostname.match(/bedrock-runtime\.([^.]+)\.amazonaws\.com/)?.[1] || 'us-east-1';
    const service = 'bedrock';
    const amzDate = getAmzDate();
    const dateStamp = getDateStamp();

    headers['host'] = url.hostname;
    headers['x-amz-date'] = amzDate;
    headers['x-amz-content-sha256'] = sha256Hex(body);
    if (sessionToken) headers['x-amz-security-token'] = sessionToken;

    const signedHeaderKeys = Object.keys(headers).map(k => k.toLowerCase()).sort();
    const signedHeaders = signedHeaderKeys.join(';');
    const canonicalHeaders = signedHeaderKeys.map(k => `${k}:${headers[Object.keys(headers).find(h => h.toLowerCase() === k)!]!.trim()}`).join('\n') + '\n';

    const canonicalRequest = [method, url.pathname + url.search, canonicalHeaders, signedHeaders, headers['x-amz-content-sha256']].join('\n');
    const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
    const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, sha256Hex(canonicalRequest)].join('\n');

    let signingKey = hmacSha256(`AWS4${secretKey}`, dateStamp);
    signingKey = hmacSha256(signingKey, region);
    signingKey = hmacSha256(signingKey, service);
    signingKey = hmacSha256(signingKey, 'aws4_request');

    const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');
    headers['Authorization'] = `AWS4-HMAC-SHA256 Credential=${accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
    return headers;
}

export const AwsBedrockApiHandler: ProviderHandler = {
    transformRequest(body: Record<string, any>, model: string) {
        const messages = body.messages || [];
        // Build Converse API compatible body
        const systemPrompt = messages.filter((m: any) => m.role === 'system').map((m: any) => ({ text: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }));
        const conversationMessages = messages
            .filter((m: any) => m.role !== 'system')
            .map((m: any) => ({
                role: m.role === 'assistant' ? 'assistant' : 'user',
                content: [{ text: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }],
            }));

        const reqBody: Record<string, any> = {
            messages: conversationMessages,
            inferenceConfig: {
                maxTokens: body.max_tokens || body.maxTokens || 2048,
                temperature: body.temperature ?? 0.7,
                topP: body.top_p ?? 1,
                ...(body.stop ? { stopSequences: Array.isArray(body.stop) ? body.stop : [body.stop] } : {}),
            },
        };
        if (systemPrompt.length > 0) reqBody.system = systemPrompt;
        return reqBody;
    },

    transformResponse(data: Record<string, any>) {
        const output = data.output || data;
        const message = output?.message || output?.choices?.[0]?.message || {};
        const content = message.content || [];
        const text = Array.isArray(content) ? content.map((c: any) => c.text || '').join('') : (typeof content === 'string' ? content : '');

        return {
            id: `chatcmpl-${Date.now()}`,
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            model: data.model || 'bedrock',
            choices: [{
                index: 0,
                message: { role: message.role || 'assistant', content: text },
                finish_reason: output?.stopReason || data.stop_reason || 'stop',
            }],
            usage: {
                prompt_tokens: data.usage?.inputTokenCount || data.usage?.prompt_tokens || 0,
                completion_tokens: data.usage?.outputTokenCount || data.usage?.completion_tokens || 0,
                total_tokens: (data.usage?.inputTokenCount || 0) + (data.usage?.outputTokenCount || 0),
            },
        };
    },

    extractUsage(data: Record<string, any>) {
        return {
            promptTokens: data.usage?.inputTokenCount || data.usage?.prompt_tokens || 0,
            completionTokens: data.usage?.outputTokenCount || data.usage?.completion_tokens || 0,
        };
    },

    buildHeaders(apiKey: string) {
        const headers = new Headers();
        headers.set('Content-Type', 'application/json');
        headers.set('Accept', 'application/json');
        // Headers will be replaced by SigV4 in overrideRequestUrl flow
        if (apiKey) headers.set('Authorization', `Bearer ${apiKey}`);
        return headers;
    },

    overrideRequestUrl(baseUrl: string, model: string, endpointType: string) {
        const cleanUrl = baseUrl.replace(/\/+$/, '');
        // Bedrock Runtime URL: POST /model/{modelId}/invoke or /model/{modelId}/converse
        const modelId = model.replace(/\//g, ':');
        if (endpointType === 'embeddings') {
            return `${cleanUrl}/model/${encodeURIComponent(modelId)}/invoke`;
        }
        return `${cleanUrl}/model/${encodeURIComponent(modelId)}/converse`;
    },
};

/**
 * Apply SigV4 signing to a fetch request for AWS Bedrock.
 * Called by the dispatcher before sending the request.
 */
export function signBedrockRequest(method: string, url: string, headers: Headers, body: string, apiKey: string): void {
    const parsedUrl = new URL(url);
    const parts = apiKey.split(':');
    const accessKey = parts[0] || '';
    const secretKey = parts[1] || '';
    const sessionToken = parts[2] || undefined;

    if (!accessKey || !secretKey) return;

    const headerObj: Record<string, string> = {};
    headers.forEach((v, k) => { headerObj[k] = v; });

    signV4(method, parsedUrl, headerObj, body, accessKey, secretKey, sessionToken);

    // Clear existing auth headers and apply signed ones
    headers.delete('Authorization');
    headers.delete('authorization');
    for (const [k, v] of Object.entries(headerObj)) {
        headers.set(k, v);
    }
}
