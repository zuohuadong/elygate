import { ProviderHandler } from './types';

/**
 * Alibaba DashScope API Handler
 */
export class AliApiHandler implements ProviderHandler {
    transformRequest(body: Record<string, any>, model: string) {
        return {
            model: model,
            input: {
                messages: body.messages
            },
            parameters: {
                result_format: "message",
                temperature: body.temperature,
                top_p: body.top_p,
                incremental_output: body.stream || false
            }
        };
    }

    transformResponse(data: any) {
        const choice = data.output?.choices?.[0] || {};
        return {
            id: data.request_id || `chatcmpl-ali-${Date.now()}`,
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            choices: [
                {
                    index: 0,
                    message: {
                        role: 'assistant',
                        content: choice.message?.content || ''
                    },
                    finish_reason: choice.finish_reason || 'stop'
                }
            ],
            usage: {
                prompt_tokens: data.usage?.input_tokens || 0,
                completion_tokens: data.usage?.output_tokens || 0,
                total_tokens: data.usage?.total_tokens || 0
            }
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
        headers.set('Authorization', `Bearer ${apiKey}`);
        return headers;
    }
}
