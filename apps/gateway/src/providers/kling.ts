import { ProviderHandler } from './types';

/**
 * Kling Video API Handler
 * Handles video generation requests.
 */
export class KlingApiHandler implements ProviderHandler {
    transformRequest(body: Record<string, any>, model: string) {
        return {
            model: model,
            prompt: body.prompt,
            negative_prompt: body.negative_prompt,
            cfg_scale: body.cfg_scale,
            mode: body.mode || 'pro',
            duration: body.duration || 5
        };
    }

    transformResponse(data: any) {
        // Return standard task ID or video URL if available immediately
        return data;
    }

    extractUsage(data: any) {
        // Video is usually fixed high cost per second or action
        return {
            promptTokens: 1000, // Mock high cost for video
            completionTokens: 0,
        };
    }

    buildHeaders(apiKey: string) {
        const headers = new Headers();
        headers.set('Content-Type', 'application/json');
        headers.set('Authorization', `Bearer ${apiKey}`);
        return headers;
    }
}
