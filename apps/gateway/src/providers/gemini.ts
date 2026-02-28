import { ProviderHandler } from './types';

/**
 * Google Gemini Native API Handler
 * Converts OpenAI format to :generateContent
 */
export class GeminiApiHandler implements ProviderHandler {

    transformRequest(body: Record<string, any>, model: string) {
        // Map OpenAI message format -> Gemini contents format
        const contents = (body.messages || []).map((msg: any) => {
            // Simple role mapping
            let role = msg.role;
            if (role === 'system') role = 'user'; // Gemini doesn't support 'system' role natively; merge into 'user'
            if (role === 'assistant') role = 'model';

            return {
                role,
                parts: [{ text: msg.content }]
            }
        });

        // Extract common parameters
        const generationConfig = {
            temperature: body.temperature,
            topK: body.top_p,
            maxOutputTokens: body.max_tokens,
        };

        return {
            contents,
            generationConfig
        };
    }

    transformResponse(data: any) {
        // Map Gemini response back to OpenAI format
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';

        return {
            id: 'chatcmpl-gemini-' + Date.now(),
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            choices: [
                {
                    index: 0,
                    message: {
                        role: 'assistant',
                        content: text
                    },
                    finish_reason: data?.candidates?.[0]?.finishReason?.toLowerCase() || 'stop'
                }
            ],
            usage: {
                // Attempt to get from metadata or default to 0
                prompt_tokens: data?.usageMetadata?.promptTokenCount || 0,
                completion_tokens: data?.usageMetadata?.candidatesTokenCount || 0,
                total_tokens: data?.usageMetadata?.totalTokenCount || 0,
            }
        };
    }

    extractUsage(data: any) {
        return {
            promptTokens: data?.usage?.__prompt_tokens || data?.usageMetadata?.promptTokenCount || 0,
            completionTokens: data?.usage?.__completion_tokens || data?.usageMetadata?.candidatesTokenCount || 0,
        };
    }

    buildHeaders(apiKey: string) {
        const headers = new Headers();
        headers.set('Content-Type', 'application/json');
        // Gemini API Key is usually appended to URL query (?key=xxx); extra header check added here if needed.
        headers.set('x-goog-api-key', apiKey);
        return headers;
    }
}
