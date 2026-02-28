import { ProviderHandler } from './types';

/**
 * Udio API Handler for Music Generation
 * Handles request transformation and usage estimation.
 */
export class UdioApiHandler implements ProviderHandler {
    transformRequest(body: Record<string, any>, model: string) {
        return {
            prompt: body.prompt,
            gpt_description: body.description,
            custom_mode: body.custom || false,
            make_instrumental: body.instrumental || false,
            model: 'udio-v1'
        };
    }

    transformResponse(data: any) {
        // Standardization for Audio/Music output
        return {
            id: data.id || `udio-${Date.now()}`,
            object: 'music.generation',
            created: Math.floor(Date.now() / 1000),
            model: 'udio-v1',
            data: data.tracks || []
        };
    }

    extractUsage(data: any) {
        // Music units billing
        return {
            promptTokens: 1, // 1 Generation task
            completionTokens: 0
        };
    }

    buildHeaders(apiKey: string) {
        const headers = new Headers();
        headers.set('Content-Type', 'application/json');
        headers.set('Authorization', `Bearer ${apiKey}`);
        return headers;
    }
}
