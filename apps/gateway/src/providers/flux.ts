import { ProviderHandler } from './types';

/**
 * Flux API Handler (Typically via Fal.ai or Replicate)
 * Standardizes Flux.1 model requests.
 */
export const FluxApiHandler: ProviderHandler = {
    transformRequest,
    transformResponse,
    extractUsage,
    buildHeaders
};

function transformRequest(body: Record<string, any>, model: string) {
        return {
            prompt: body.prompt,
            image_size: body.size || '1024x1024',
            num_inference_steps: body.steps || 28,
            guidance_scale: body.guidance || 3.5,
            sync_mode: true
        };
    }

function transformResponse(data: Record<string, any>) {
        // Standardize to OpenAI images generation format
        return {
            created: Math.floor(Date.now() / 1000),
            data: (data.images || [data.image]).map((img: Record<string, any>) => ({
                url: typeof img === 'string' ? img : img.url
            }))
        };
    }

function extractUsage(data: Record<string, any>) {
        // Fixed cost for images usually, but we return a count for billing
        return {
            promptTokens: 1, // Represent 1 image
            completionTokens: 0
        };
    }

function buildHeaders(apiKey: string) {
        const headers = new Headers();
        headers.set('Content-Type', 'application/json');
        headers.set('Authorization', `Key ${apiKey}`);
        return headers;
    }

