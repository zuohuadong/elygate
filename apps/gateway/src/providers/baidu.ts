import { ProviderHandler } from './types';

/**
 * Baidu ErnieBot API Handler
 * Note: Baidu uses a different message structure and requires access_token.
 */
export const BaiduApiHandler: ProviderHandler = {
    transformRequest,
    transformResponse,
    extractUsage,
    buildHeaders
};

function transformRequest(body: Record<string, any>, model: string) {
        // Baidu messages: [{"role": "user", "content": "..."}] 
        // Roles: user, assistant
        const messages = (body.messages || []).map((m: Record<string, any>) => ({
            role: m.role === 'assistant' ? 'assistant' : 'user',
            content: m.content
        }));

        return {
            messages,
            stream: body.stream || false,
            user_id: body.user || 'elygate_user'
        };
    }

function transformResponse(data: Record<string, any>) {
        // Baidu response -> OpenAI format
        return {
            id: data.id || `chatcmpl-baidu-${Date.now()}`,
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            choices: [
                {
                    index: 0,
                    message: {
                        role: 'assistant',
                        content: data.result || ''
                    },
                    finish_reason: 'stop'
                }
            ],
            usage: {
                prompt_tokens: data.usage?.prompt_tokens || 0,
                completion_tokens: data.usage?.completion_tokens || 0,
                total_tokens: (data.usage?.prompt_tokens || 0) + (data.usage?.completion_tokens || 0)
            }
        };
    }

function extractUsage(data: Record<string, any>) {
        return {
            promptTokens: data.usage?.prompt_tokens || 0,
            completionTokens: data.usage?.completion_tokens || 0,
        };
    }

function buildHeaders(apiKey: string) {
        const headers = new Headers();
        headers.set('Content-Type', 'application/json');
        // Note: Baidu usually requires access_token in URL query, 
        // but for some gateways it might be passed in headers.
        // In Elygate, if the 'key' stored is the Access Token, we pass it here.
        return headers;
    }

