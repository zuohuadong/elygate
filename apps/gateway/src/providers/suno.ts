import { ProviderHandler } from './types';

/**
 * Suno Music API Handler
 * Handles music generation requests (often via /api/v1/generate or similar).
 */
export class SunoApiHandler implements ProviderHandler {
    transformRequest(body: Record<string, any>, model: string) {
        return {
            prompt: body.prompt,
            model: model,
            customMode: body.customMode || false,
            instrumental: body.instrumental || false,
            style: body.style,
            title: body.title
        };
    }

    transformResponse(data: any) {
        // Return task ID or music URLs if available
        return {
            id: data.taskId || data.id,
            object: 'music.generation',
            created: Math.floor(Date.now() / 1000),
            data: data
        };
    }

    extractUsage(data: any) {
        // Suno usually billed per song/shot
        return {
            promptTokens: 500, // Fixed cost per generation
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
