import { ProviderHandler } from './types';

/**
 * Midjourney Proxy (MJ-Proxy) Adapter
 * Allows MJ-specific actions to be passed through OpenAI-like chat completion requests.
 * Standard MJ-Proxy often uses /mj/submit/imagine etc., but here we support 
 * a chat-compatible passthrough if the upstream is an MJ-OpenAI bridge.
 */
export class MidjourneyApiHandler implements ProviderHandler {
    transformRequest(body: Record<string, any>, model: string) {
        // Multi-modal/Image specific parameters for MJ
        return {
            ...body,
            model: model || 'mj-chat',
            // MJ Proxy specific field mapping if any
            action: body.action,
            index: body.index,
            state: body.state
        };
    }

    transformResponse(data: any) {
        // Usually MJ Proxy returns task ID or image URL inside standard OpenAI choices
        return data;
    }

    extractUsage(data: any) {
        // MJ is usually fixed cost per action, mock as 1 token or use specific MJ pricing
        return {
            promptTokens: 1,
            completionTokens: 0,
        };
    }

    buildHeaders(apiKey: string) {
        const headers = new Headers();
        headers.set('Content-Type', 'application/json');
        headers.set('mj-api-secret', apiKey); // Some MJ proxies use this header
        headers.set('Authorization', `Bearer ${apiKey}`);
        return headers;
    }
}
