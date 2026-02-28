import { ProviderHandler } from './types';

/**
 * Anthropic Claude API Adapter
 * Transforms OpenAI-like requests to Anthropic strictly required format.
 */
export class AnthropicApiHandler implements ProviderHandler {
    transformRequest(body: Record<string, any>, model: string) {
        // Claude requires max_tokens parameter
        let maxTokens = body.max_tokens || 4096;

        const anthropicMessages = body.messages.filter((m: any) => m.role !== 'system');
        const systemMessage = body.messages.find((m: any) => m.role === 'system')?.content || '';

        const payload: Record<string, any> = {
            model,
            max_tokens: maxTokens,
            messages: anthropicMessages,
            temperature: body.temperature || 1.0,
            stream: body.stream || false,
        };

        if (systemMessage) {
            payload.system = systemMessage;
        }

        return payload;
    }

    transformResponse(data: any): any {
        if (!data || !data.content) return data;

        // Claude format -> OpenAI format
        return {
            id: data.id || `chatcmpl-${Date.now()}`,
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            model: data.model,
            choices: [
                {
                    index: 0,
                    message: {
                        role: 'assistant',
                        content: data.content[0]?.text || '',
                    },
                    finish_reason: data.stop_reason === 'end_turn' ? 'stop' : data.stop_reason,
                },
            ],
            usage: {
                prompt_tokens: data.usage?.input_tokens || 0,
                completion_tokens: data.usage?.output_tokens || 0,
                total_tokens: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0),
            },
        };
    }

    extractUsage(data: any) {
        return {
            promptTokens: data.usage?.input_tokens || 0,
            completionTokens: data.usage?.output_tokens || 0,
        };
    }

    buildHeaders(apiKey: string) {
        const headers = new Headers();
        headers.set('Content-Type', 'application/json');
        headers.set('x-api-key', apiKey);
        headers.set('anthropic-version', '2023-06-01');
        return headers;
    }
}
