import type { ProviderHandler } from './types';

/**
 * Codex / OpenAI Responses API Handler
 * ChannelType.CODEX (57) is for OpenAI's newer Codex/Responses API.
 * Uses the /v1/responses endpoint with potentially different auth headers.
 *
 * The Codex API is OpenAI-compatible but uses the Responses API format:
 * - POST /v1/responses with { model, input, stream, ... }
 * - Returns output items instead of choices
 */

export const CodexApiHandler: ProviderHandler = {
    transformRequest(body: Record<string, any>, model: string) {
        // If already in responses format (has 'input'), pass through
        if (body.input) return { ...body, model };
        // Convert chat completions format to responses format
        return {
            model,
            input: body.messages || body.input || '',
            stream: body.stream || false,
            temperature: body.temperature,
            top_p: body.top_p,
            max_output_tokens: body.max_tokens || body.max_output_tokens,
            ...(body.tools ? { tools: body.tools } : {}),
            ...(body.tool_choice ? { tool_choice: body.tool_choice } : {}),
            ...(body.response_format ? { response_format: body.response_format } : {}),
        };
    },

    transformResponse(data: Record<string, any>) {
        // If already in OpenAI chat format, pass through
        if (data.choices) return data;
        // Convert responses format to chat completions for downstream compatibility
        if (data.output) {
            const textItems = (data.output || []).filter((item: any) => item.type === 'message' || item.content);
            const content = textItems.map((item: any) => {
                if (item.content) {
                    return Array.isArray(item.content) ? item.content.map((c: any) => c.text || '').join('') : String(item.content);
                }
                return '';
            }).join('');

            return {
                id: data.id || `chatcmpl-${Date.now()}`,
                object: 'chat.completion',
                created: data.created_at || Math.floor(Date.now() / 1000),
                model: data.model || 'codex',
                choices: [{
                    index: 0,
                    message: { role: 'assistant', content },
                    finish_reason: data.status === 'completed' ? 'stop' : data.status || 'stop',
                }],
                usage: data.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
            };
        }
        return data;
    },

    extractUsage(data: Record<string, any>) {
        return {
            promptTokens: data.usage?.prompt_tokens || data.usage?.input_tokens || 0,
            completionTokens: data.usage?.completion_tokens || data.usage?.output_tokens || 0,
        };
    },

    buildHeaders(apiKey: string) {
        const headers = new Headers();
        headers.set('Content-Type', 'application/json');
        headers.set('Authorization', `Bearer ${apiKey}`);
        return headers;
    },

    overrideRequestUrl(baseUrl: string, model: string, endpointType: string) {
        const cleanUrl = baseUrl.replace(/\/+$/, '');
        if (endpointType === 'responses') {
            return `${cleanUrl}/v1/responses`;
        }
        return `${cleanUrl}/v1/chat/completions`;
    },
};
