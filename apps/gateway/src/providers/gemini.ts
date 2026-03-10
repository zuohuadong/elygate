import { ProviderHandler } from './types';

/**
 * Google Gemini Native API Handler
 * Converts OpenAI format to :generateContent
 */
export class GeminiApiHandler implements ProviderHandler {

    transformRequest(body: Record<string, any>, model: string) {
        // Extract system messages to pass as Gemini's native systemInstruction
        const systemMessages = (body.messages || []).filter((m: any) => m.role === 'system');
        const nonSystemMessages = (body.messages || []).filter((m: any) => m.role !== 'system');

        // Map OpenAI message format -> Gemini contents format
        const contents = nonSystemMessages.map((msg: any) => {
            const role = msg.role === 'assistant' ? 'model' : 'user';
            const parts = typeof msg.content === 'string'
                ? [{ text: msg.content }]
                : Array.isArray(msg.content)
                    ? msg.content.map((c: any) => c.type === 'text' ? { text: c.text } : { text: c.image_url?.url || '' })
                    : [{ text: String(msg.content) }];
            return { role, parts };
        });

        // Extract common parameters
        const generationConfig: any = {};
        if (body.temperature !== undefined) generationConfig.temperature = body.temperature;
        if (body.max_tokens !== undefined) generationConfig.maxOutputTokens = body.max_tokens;
        if (body.top_p !== undefined) generationConfig.topP = body.top_p;
        if (body.top_k !== undefined) generationConfig.topK = body.top_k;
        if (body.stop) generationConfig.stopSequences = Array.isArray(body.stop) ? body.stop : [body.stop];

        const result: any = { contents, generationConfig };

        // Support for Thinking Config (Gemini 2.0 / 3.5 Pro)
        if (body.thinkingConfig || body.generationConfig?.thinkingConfig) {
            const tc = body.thinkingConfig || body.generationConfig.thinkingConfig;
            generationConfig.thinkingConfig = {
                includeThoughts: true,
                thinkingBudgetTokens: tc.include_thoughts === false ? 0 : (tc.thinking_budget_tokens || tc.thinkingBudgetTokens || 2048)
            };
            // Map "MEDIUM" or other custom levels if provided in a vendor-specific way
            if (tc.level === 'MEDIUM') {
                generationConfig.thinkingConfig.thinkingBudgetTokens = 4096; // Example mapping
            }
        }

        // Pass system prompt as native Gemini systemInstruction
        if (systemMessages.length > 0) {
            const systemText = systemMessages.map((m: any) => m.content).join('\n');
            result.systemInstruction = { parts: [{ text: systemText }] };
        }

        return result;
    }

    transformResponse(data: any) {
        // Map Gemini response back to OpenAI format
        let text = '';
        let reasoningContent = '';

        if (data?.candidates?.[0]?.content?.parts) {
            for (const part of data.candidates[0].content.parts) {
                if (part.text) {
                    text += part.text;
                }
                // Handle native 'thought' or 'thought_text' parts in Gemini 3.5 Pro
                if (part.thought || part.role === 'thought' || part.thought_text) {
                    reasoningContent += part.thought || part.thought_text || part.text || '';
                }
            }
        }

        // Actually, for Gemini 2.0 Thinking models, the reasoning is often in a part where part.text is the reasoning
        // but it's marked as a specific type if using the latest SDK. 
        // In the raw API, we need to be careful.

        const message: any = {
            role: 'assistant',
            content: text
        };

        if (reasoningContent) {
            message.reasoning_content = reasoningContent;
        }

        return {
            id: 'chatcmpl-gemini-' + Date.now(),
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            choices: [
                {
                    index: 0,
                    message,
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
