import { ProviderHandler } from './types';

/**
 * Xunfei Spark API Handler (HTTP Version)
 */
export class XunfeiApiHandler implements ProviderHandler {
    transformRequest(body: Record<string, any>, model: string) {
        return {
            model: model,
            messages: body.messages,
            stream: body.stream || false
        };
    }

    transformResponse(data: any) {
        return {
            id: data.id || `chatcmpl-spark-${Date.now()}`,
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            choices: [
                {
                    index: 0,
                    message: {
                        role: 'assistant',
                        content: data.choices?.[0]?.message?.content || ''
                    },
                    finish_reason: 'stop'
                }
            ],
            usage: {
                prompt_tokens: data.usage?.prompt_tokens || 0,
                completion_tokens: data.usage?.completion_tokens || 0,
                total_tokens: data.usage?.total_tokens || 0
            }
        };
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
