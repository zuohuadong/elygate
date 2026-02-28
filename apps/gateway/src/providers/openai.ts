import { ProviderHandler } from './types';

/**
 * Native OpenAI Compatible Provider Handler
 * Note: Most compatible APIs (e.g., AnyRouter, Groq, DeepSeek API) can be handled via direct passthrough.
 */
export class OpenAIApiHandler implements ProviderHandler {

    transformRequest(body: Record<string, any>, model: string) {
        // Some proxy APIs might need to map the 'model' field; currently we pass it through.
        return {
            ...body,
            model
        };
    }

    transformResponse(data: any) {
        // Return directly as it is already in standard format.
        return data;
    }

    extractUsage(data: any) {
        return {
            promptTokens: data.usage?.prompt_tokens || 0,
            completionTokens: data.usage?.completion_tokens || 0,
        };
    }

    buildHeaders(apiKey: string) {
        const headers = new Headers();
        headers.set('Content-Type', 'application/json');
        headers.set('Authorization', `Bearer ${apiKey}`);
        return headers;
    }
}
