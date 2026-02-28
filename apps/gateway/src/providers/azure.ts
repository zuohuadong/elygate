import { ProviderHandler } from './types';

/**
 * Azure OpenAI Protocol Adapter
 * Highly consistent with native OpenAI, except:
 * 1. Auth header uses 'api-key' instead of 'Authorization: Bearer'
 * 2. URL requires api-version parameter (handled at the routing layer)
 */
export class AzureOpenAIApiHandler implements ProviderHandler {
    transformRequest(body: Record<string, any>, model: string) {
        // Request body is identical to native OpenAI
        return {
            ...body,
            model
        };
    }

    transformResponse(data: any): any {
        // Response body is identical to native OpenAI
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
        // Azure specific auth header
        headers.set('api-key', apiKey);
        return headers;
    }
}
