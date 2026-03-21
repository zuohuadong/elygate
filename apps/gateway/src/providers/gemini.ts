import { ProviderHandler } from './types';

/**
 * Google Gemini Native API Handler
 * Converts OpenAI format to :generateContent
 */
export class GeminiApiHandler implements ProviderHandler {

    transformRequest(body: Record<string, any>, model: string) {
        // body is now InternalRequest (OpenAI-like)
        const systemMessages = (body.messages || []).filter((m: Record<string, any>) => m.role === 'system');
        const nonSystemMessages = (body.messages || []).filter((m: Record<string, any>) => m.role !== 'system');

        const contents = nonSystemMessages.map((msg: Record<string, any>) => {
            const role = msg.role === 'assistant' ? 'model' : 'user';
            const parts = typeof msg.content === 'string'
                ? [{ text: msg.content }]
                : Array.isArray(msg.content)
                    ? msg.content.map((c: Record<string, any>) => c.type === 'text' ? { text: c.text } : { text: c.image_url?.url || '' })
                    : [{ text: String(msg.content) }];
            return { role, parts };
        });

        const generationConfig: Record<string, any> = {
            temperature: body.temperature,
            maxOutputTokens: body.max_tokens,
            topP: body.top_p,
            topK: body.top_k,
        };
        
        if (body.stop) generationConfig.stopSequences = Array.isArray(body.stop) ? body.stop : [body.stop];

        const result: Record<string, any> = { contents, generationConfig };

        if (systemMessages.length > 0) {
            const systemText = systemMessages.map((m: Record<string, any>) => m.content).join('\n');
            result.systemInstruction = { parts: [{ text: systemText }] };
        }

        return result;
    }

    transformResponse(data: Record<string, any>) {
        // Return internal OpenAI format
        let text = '';
        if (data?.candidates?.[0]?.content?.parts) {
            for (const part of data.candidates[0].content.parts) {
                if (part.text) text += part.text;
            }
        }

        return {
            id: 'chatcmpl-gemini-' + Date.now(),
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            choices: [{
                index: 0,
                message: { role: 'assistant', content: text },
                finish_reason: data?.candidates?.[0]?.finishReason?.toLowerCase() || 'stop'
            }],
            usage: {
                prompt_tokens: data?.usageMetadata?.promptTokenCount || 0,
                completion_tokens: data?.usageMetadata?.candidatesTokenCount || 0,
                total_tokens: data?.usageMetadata?.totalTokenCount || 0,
            }
        };
    }

    extractUsage(data: Record<string, any>) {
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
