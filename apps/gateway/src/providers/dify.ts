import type { ProviderHandler } from './types';

export const DifyApiHandler: ProviderHandler = {
    transformRequest(body: Record<string, any>, model: string) {
        const last = Array.isArray(body.messages) ? body.messages[body.messages.length - 1] : null;
        return {
            inputs: body.inputs || {},
            query: body.query || (typeof last?.content === 'string' ? last.content : body.prompt || ''),
            response_mode: body.stream ? 'streaming' : 'blocking',
            conversation_id: body.conversation_id,
            user: body.user || body.user_id || 'elygate',
            model,
        };
    },

    transformResponse(data: Record<string, any>) {
        if (data.answer) {
            return {
                id: data.message_id || `chatcmpl-${Date.now()}`,
                object: 'chat.completion',
                created: Math.floor(Date.now() / 1000),
                model: data.model || 'dify',
                choices: [{ index: 0, message: { role: 'assistant', content: data.answer }, finish_reason: 'stop' }],
                usage: data.metadata?.usage || data.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
            };
        }
        return data;
    },

    extractUsage(data: Record<string, any>) {
        const usage = data.metadata?.usage || data.usage || {};
        return {
            promptTokens: usage.prompt_tokens || usage.promptTokens || 0,
            completionTokens: usage.completion_tokens || usage.completionTokens || 0,
        };
    },

    buildHeaders(apiKey: string) {
        const headers = new Headers();
        headers.set('Content-Type', 'application/json');
        headers.set('Authorization', `Bearer ${apiKey}`);
        return headers;
    },

    overrideRequestUrl(baseUrl: string) {
        return `${baseUrl.replace(/\/+$/, '')}/v1/chat-messages`;
    },
};
