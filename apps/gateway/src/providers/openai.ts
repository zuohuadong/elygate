import { ProviderHandler } from './types';

/**
 * Native OpenAI Compatible Provider Handler
 * Note: Most compatible APIs (e.g., AnyRouter, Groq, DeepSeek API) can be handled via direct passthrough.
 */
export class OpenAIApiHandler implements ProviderHandler {

    transformRequest(body: Record<string, any>, model: string) {
        // Support for 2026 GPT-5.4 specific parameters
        const transformed: Record<string, any> = {
            ...body,
            model
        };

        // Handle computer_use capability if present
        if (body.computer_use) {
            transformed.computer_use = body.computer_use;
        }

        // Handle deferred tool loading (tool_search)
        if (body.tool_search || body.deferred_tools) {
            transformed.tools_metadata = {
                search: body.tool_search || true,
                deferred: body.deferred_tools || true
            };
        }

        return transformed;
    }

    transformResponse(data: any) {
        // Remove null values to make response cleaner
        const removeNulls = (obj: any): any => {
            if (Array.isArray(obj)) {
                return obj.map(removeNulls).filter(v => v !== null);
            }
            if (obj !== null && typeof obj === 'object') {
                const cleaned: any = {};
                for (const key of Object.keys(obj)) {
                    const value = obj[key];
                    if (value !== null) {
                        cleaned[key] = removeNulls(value);
                    }
                }
                return cleaned;
            }
            return obj;
        };
        return removeNulls(data);
    }

    extractUsage(data: any) {
        const promptTokens = data.usage?.prompt_tokens || 0;
        const completionTokens = data.usage?.completion_tokens || 0;
        const cachedTokens = data.usage?.prompt_tokens_details?.cached_tokens;
        return {
            promptTokens,
            completionTokens,
            ...(cachedTokens !== undefined && { cachedTokens })
        };
    }

    buildHeaders(apiKey: string) {
        const headers = new Headers();
        headers.set('Content-Type', 'application/json');
        headers.set('Authorization', `Bearer ${apiKey}`);
        return headers;
    }
}
