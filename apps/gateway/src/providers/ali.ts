import { ProviderHandler } from './types';

/**
 * Alibaba DashScope API Handler
 */
export const AliApiHandler: ProviderHandler = {
    transformRequest,
    transformResponse,
    extractUsage,
    buildHeaders
};

function transformRequest(body: Record<string, any>, model: string) {
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

function transformResponse(data: Record<string, any>) {
        const choice = data.output?.choices?.[0] || {};
        const message: Record<string, any> = {
            role: 'assistant',
            content: choice.message?.content || ''
        };

        if (choice.message?.reasoning_content) {
            message.reasoning_content = choice.message.reasoning_content;
        }

        if (choice.message?.thought) {
            message.reasoning_content = (message.reasoning_content || '') + choice.message.thought;
        }

        return {
            id: data.request_id || `chatcmpl-ali-${Date.now()}`,
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            choices: [
                {
                    index: 0,
                    message,
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

function extractUsage(data: Record<string, any>) {
        return {
            promptTokens: data.usage?.input_tokens || 0,
            completionTokens: data.usage?.output_tokens || 0,
        };
    }

function buildHeaders(apiKey: string) {
        const headers = new Headers();
        headers.set('Content-Type', 'application/json');
        headers.set('Authorization', `Bearer ${apiKey}`);
        return headers;
    }

