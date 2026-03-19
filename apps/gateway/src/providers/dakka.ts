import { type ProviderHandler } from './types';

export class DakkaApiHandler implements ProviderHandler {
    transformRequest(body: Record<string, any>, model: string): Record<string, any> {
        // Extract prompt from OpenAI request format
        let prompt = '';
        if (body.prompt) {
            prompt = body.prompt;
        } else if (body.messages && body.messages.length > 0) {
            prompt = body.messages[body.messages.length - 1].content;
        }

        // Parse optional size from prompt or body format if needed, but default to 1:1
        let size = "1:1";
        if (body.size) {
            // OpenAI size mapping if needed, e.g. 1024x1024 -> 1:1
            if (body.size === '1024x1024') size = '1:1';
            else if (body.size === '1024x1792') size = '2:3';
            else if (body.size === '1792x1024') size = '3:2';
        }

        return {
            model: model,
            prompt: prompt,
            size: size,
            variants: body.n || 1,
            shutProgress: true // Always wait for final result seamlessly
            // webhook omitted to just wait for SSE response synchronously
        };
    }

    transformResponse(data: any): Record<string, any> {
        // Grsai Dakka API returns an object like:
        // { "id": "...", "url": "https://...", "status": "succeeded", "results": [{"url": "..."}] }
        
        let url = '';
        if (data.results && data.results.length > 0) {
            url = data.results[0].url;
        } else if (data.url) {
            url = data.url;
        }
        
        // Wrap into standard OpenAI Image format
        return {
            created: Math.floor(Date.now() / 1000),
            data: [
                {
                    url: url
                }
            ]
        };
    }

    extractUsage(data: any): { promptTokens: number; completionTokens: number } {
        // The API specification says variants increase cost (1 variant = 50 points etc.)
        // We will default to standard OpenAI usage calculation for image creation
        // which usually registers as a prompt token based on billing strategy
        return { promptTokens: 1000, completionTokens: 0 };
    }

    buildHeaders(apiKey: string): Headers {
        return new Headers({
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        });
    }
}
