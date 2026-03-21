import { ProviderHandler } from './types';

/**
 * Kling Video API Handler
 * Handles video generation requests.
 */
export const KlingApiHandler: ProviderHandler = {
    transformRequest,
    transformResponse,
    extractUsage,
    buildHeaders
};

function transformRequest(body: Record<string, any>, model: string) {
        return {
            model: model,
            prompt: body.prompt,
            negative_prompt: body.negative_prompt,
            cfg_scale: body.cfg_scale,
            mode: body.mode || 'pro',
            duration: body.duration || 5
        };
    }

function transformResponse(data: Record<string, any>) {
        // Return standard task ID or video URL if available immediately
        return data;
    }

function extractUsage(data: Record<string, any>) {
        // Video is usually fixed high cost per second or action
        return {
            promptTokens: 1000, // Mock high cost for video
            completionTokens: 0,
        };
    }

function buildHeaders(apiKey: string) {
        const headers = new Headers();
        headers.set('Content-Type', 'application/json');
        headers.set('Authorization', `Bearer ${apiKey}`);
        return headers;
    }

