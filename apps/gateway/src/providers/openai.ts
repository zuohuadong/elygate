import { ProviderHandler } from './types';
import { removeNullFields } from '../utils/transform';

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
        return removeNullFields(data);
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
