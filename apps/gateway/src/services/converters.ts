import type { Context } from 'elysia';

export interface InternalRequest {
    model: string;
    messages: { role: string; content: unknown }[];
    stream?: boolean;
    temperature?: number;
    top_p?: number;
    max_tokens?: number;
    tools?: Record<string, unknown>[];
    tool_choice?: string | Record<string, unknown>;
    [key: string]: any;
}

export interface InternalResponse {
    id: string;
    object: string;
    created: number;
    model: string;
    choices: Record<string, any>[];
    usage?: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    };
    [key: string]: any;
}

/**
 * Base Converter Interface
 * Handles bidirectional conversion between User Format and Internal (OpenAI) Format.
 */
export interface FormatConverter {
    convertRequest(body: Record<string, any>): InternalRequest;
    convertResponse(internalRes: InternalResponse): Record<string, any>;
    convertStreamChunk(chunk: Record<string, any>): string | null;
    convertError(error: unknown): Record<string, any>;
}

function classifyError(msg: string): string {
    if (msg.includes('401') || msg.includes('API key')) return 'authentication_error';
    if (msg.includes('404')) return 'not_found_error';
    if (msg.includes('429')) return 'rate_limit_error';
    return 'api_error';
}

export const OpenAIConverter: FormatConverter = {
    convertRequest(body: Record<string, any>): InternalRequest {
        return body as InternalRequest;
    },
    convertResponse(internalRes: InternalResponse): Record<string, any> {
        return internalRes;
    },
    convertStreamChunk(chunk: Record<string, any>): string | null {
        return `data: ${JSON.stringify(chunk)}\n\n`;
    },
    convertError(error: unknown): Record<string, any> {
        const msg = (error as any).message || 'Unknown error';
        return { error: { message: msg, type: classifyError(msg), param: null, code: classifyError(msg) } };
    }
};

export const AnthropicConverter: FormatConverter = {
    convertRequest(body: Record<string, any>): InternalRequest {
        const messages: { role: string; content: unknown }[] = [];

        // System prompt
        if (body.system) {
            const sysContent = typeof body.system === 'string'
                ? body.system
                : Array.isArray(body.system)
                    ? body.system.map((b: any) => b.text || '').join('\n')
                    : String(body.system);
            messages.push({ role: 'system', content: sysContent });
        }

        for (const msg of (body.messages || [])) {
            if (typeof msg.content === 'string') {
                messages.push({ role: msg.role, content: msg.content });
            } else if (Array.isArray(msg.content)) {
                const openaiContent: Record<string, any>[] = [];
                for (const block of msg.content) {
                    if (block.type === 'text') {
                        openaiContent.push({ type: 'text', text: block.text });
                    } else if (block.type === 'image' && block.source) {
                        const url = block.source.type === 'url'
                            ? block.source.url
                            : `data:${block.source.media_type};base64,${block.source.data}`;
                        openaiContent.push({ type: 'image_url', image_url: { url } });
                    } else if (block.type === 'tool_use') {
                        // Convert Anthropic tool_use to OpenAI tool_calls format via text encoding
                        openaiContent.push({
                            type: 'text',
                            text: JSON.stringify({ tool_use: { id: block.tool_use_id, name: block.name, input: block.input } })
                        });
                    } else if (block.type === 'tool_result') {
                        const resultText = typeof block.content === 'string'
                            ? block.content
                            : Array.isArray(block.content)
                                ? block.content.map((c: any) => c.text || '').join('')
                                : JSON.stringify(block.content);
                        openaiContent.push({ type: 'text', text: `[Tool Result ${block.tool_use_id}]: ${resultText}` });
                    }
                }
                messages.push({ role: msg.role, content: openaiContent });
            }
        }

        return {
            model: body.model || '',
            messages,
            stream: body.stream || false,
            temperature: body.temperature,
            top_p: body.top_p,
            max_tokens: body.max_tokens,
            tools: body.tools?.map((t: any) => ({
                type: 'function',
                function: { name: t.name, description: t.description, parameters: t.input_schema }
            })),
            tool_choice: body.tool_choice?.type === 'any' ? 'auto'
                : body.tool_choice?.type === 'tool' ? { type: 'function', function: { name: body.tool_choice.name } }
                : body.tool_choice,
        } as InternalRequest;
    },

    convertResponse(internalRes: InternalResponse): Record<string, any> {
        const choice = internalRes.choices?.[0];
        const message = choice?.message;
        const content: unknown[] = [];

        if (message?.tool_calls) {
            for (const tc of message.tool_calls) {
                content.push({
                    type: 'tool_use',
                    id: tc.id,
                    name: tc.function.name,
                    input: JSON.parse(tc.function.arguments || '{}')
                });
            }
        }

        if (message?.content) {
            content.push({ type: 'text', text: message.content });
        }

        let stopReason: string = 'end_turn';
        if (choice?.finish_reason === 'length') stopReason = 'max_tokens';
        else if (choice?.finish_reason === 'tool_calls') stopReason = 'tool_use';

        return {
            id: internalRes.id || `msg_${Date.now()}`,
            type: 'message',
            role: 'assistant',
            content: content.length > 0 ? content : [{ type: 'text', text: '' }],
            model: internalRes.model,
            stop_reason: stopReason,
            stop_sequence: null,
            usage: {
                input_tokens: internalRes.usage?.prompt_tokens || 0,
                output_tokens: internalRes.usage?.completion_tokens || 0
            }
        };
    },

    convertStreamChunk(chunk: Record<string, any>): string | null {
        const delta = chunk.choices?.[0]?.delta;
        if (!delta) return null;

        // Text content delta
        if (delta.content) {
            return `event: content_block_delta\ndata: ${JSON.stringify({
                type: 'content_block_delta',
                index: 0,
                delta: { type: 'text_delta', text: delta.content }
            })}\n\n`;
        }

        // Tool call delta
        if (delta.tool_calls) {
            const tc = delta.tool_calls[0];
            if (tc.function?.name) {
                return `event: content_block_start\ndata: ${JSON.stringify({
                    type: 'content_block_start',
                    index: 1,
                    content_block: { type: 'tool_use', id: tc.id, name: tc.function.name, input: {} }
                })}\n\n`;
            }
            if (tc.function?.arguments) {
                return `event: content_block_delta\ndata: ${JSON.stringify({
                    type: 'content_block_delta',
                    index: 1,
                    delta: { type: 'input_json_delta', partial_json: tc.function.arguments }
                })}\n\n`;
            }
        }

        // Finish
        if (chunk.choices?.[0]?.finish_reason) {
            const reason = chunk.choices[0].finish_reason === 'tool_calls' ? 'tool_use'
                : chunk.choices[0].finish_reason === 'length' ? 'max_tokens' : 'end_turn';
            return `event: message_delta\ndata: ${JSON.stringify({
                type: 'message_delta',
                delta: { stop_reason: reason },
                usage: { output_tokens: chunk.usage?.completion_tokens || 0 }
            })}\n\n`;
        }

        return null;
    },

    convertError(error: unknown): Record<string, any> {
        const msg = (error as any).message || 'Unknown error';
        const type = classifyError(msg);
        return { type: 'error', error: { type, message: msg } };
    }
};

export const GeminiConverter: FormatConverter = {
    convertRequest(body: Record<string, any>): InternalRequest {
        const contents = body.contents || [];
        const messages: { role: string; content: unknown }[] = [];

        if (body.systemInstruction) {
            messages.push({
                role: 'system',
                content: body.systemInstruction.parts?.map((p: Record<string, any>) => p.text).join('\n')
            });
        }

        for (const content of contents) {
            const role = content.role === 'model' ? 'assistant' : 'user';
            const parts = content.parts?.map((p: Record<string, any>) => {
                if (p.text) return { type: 'text', text: p.text };
                if (p.inlineData) return { type: 'image_url', image_url: { url: `data:${p.inlineData.mimeType};base64,${p.inlineData.data}` } };
                if (p.fileData) return { type: 'image_url', image_url: { url: p.fileData.fileUri } };
                return { type: 'text', text: '' };
            }) || [];
            const textOnly = parts.length > 0 && parts.every((p: Record<string, any>) => p.type === 'text');
            messages.push({
                role,
                content: textOnly ? parts.map((p: Record<string, any>) => p.text || '').join('\n') : parts
            });
        }

        return {
            messages,
            model: '',
            generationConfig: body.generationConfig,
            temperature: body.generationConfig?.temperature,
            top_p: body.generationConfig?.topP,
            max_tokens: body.generationConfig?.maxOutputTokens,
            stream: false,
        } as InternalRequest;
    },

    convertResponse(internalRes: InternalResponse): Record<string, any> {
        const choice = internalRes.choices?.[0];
        const textContent = typeof choice?.message?.content === 'string' ? choice.message.content : '';
        return {
            candidates: [{
                content: { parts: [{ text: textContent }], role: 'model' },
                finishReason: choice?.finish_reason?.toUpperCase() || 'STOP',
                index: 0
            }],
            usageMetadata: {
                promptTokenCount: internalRes.usage?.prompt_tokens || 0,
                candidatesTokenCount: internalRes.usage?.completion_tokens || 0,
                totalTokenCount: internalRes.usage?.total_tokens || 0
            }
        };
    },

    convertStreamChunk(chunk: Record<string, any>): string | null {
        const choice = chunk.choices?.[0];
        const res = GeminiConverter.convertResponse({ ...chunk, choices: [choice] } as any);
        return `${JSON.stringify(res)}\n`;
    },

    convertError(error: unknown): Record<string, any> {
        const msg = (error as any).message || 'Unknown error';
        const code = msg.includes('401') ? 401 : msg.includes('404') ? 404 : msg.includes('429') ? 429 : 500;
        const status = code === 401 ? 'UNAUTHENTICATED' : code === 404 ? 'NOT_FOUND' : code === 429 ? 'RESOURCE_EXHAUSTED' : 'INTERNAL';
        return { error: { code, message: msg, status } };
    }
};

export const AliConverter: FormatConverter = {
    convertRequest(body: Record<string, any>): InternalRequest {
        const input = body.input || {};
        const params = body.parameters || {};
        const messages = input.messages || [];
        return {
            model: body.model || '',
            messages: messages.map((m: any) => ({ role: m.role, content: m.content })),
            stream: params.incremental_output || false,
            temperature: params.temperature,
            top_p: params.top_p,
            max_tokens: params.max_tokens,
        } as InternalRequest;
    },

    convertResponse(internalRes: InternalResponse): Record<string, any> {
        const choice = internalRes.choices?.[0];
        return {
            output: {
                choices: [{
                    message: { role: 'assistant', content: choice?.message?.content || '' },
                    finish_reason: choice?.finish_reason || 'stop'
                }],
            },
            usage: {
                total_tokens: internalRes.usage?.total_tokens || 0,
                input_tokens: internalRes.usage?.prompt_tokens || 0,
                output_tokens: internalRes.usage?.completion_tokens || 0,
            },
            request_id: internalRes.id || '',
        };
    },

    convertStreamChunk(chunk: Record<string, any>): string | null {
        const res = AliConverter.convertResponse(chunk as any);
        return `data: ${JSON.stringify(res)}\n\n`;
    },

    convertError(error: unknown): Record<string, any> {
        const msg = (error as any).message || 'Unknown error';
        return { code: classifyError(msg), message: msg };
    }
};

export const AliImageConverter: FormatConverter = {
    convertRequest(body: Record<string, any>): InternalRequest {
        return { model: body.model || '', messages: [], ...body } as InternalRequest;
    },
    convertResponse(internalRes: Record<string, any>): Record<string, any> { return internalRes; },
    convertStreamChunk(): string | null { return null; },
    convertError(error: unknown): Record<string, any> {
        return { code: 'InternalError', message: (error as any)?.message || 'Error' };
    }
};

export const BaiduConverter: FormatConverter = {
    convertRequest(body: Record<string, any>): InternalRequest {
        return {
            model: body.model || '',
            messages: body.messages || [],
            stream: body.stream || false,
            temperature: body.temperature,
            top_p: body.top_p,
            max_tokens: body.max_tokens,
        } as InternalRequest;
    },

    convertResponse(internalRes: InternalResponse): Record<string, any> {
        const choice = internalRes.choices?.[0];
        return {
            id: internalRes.id || '',
            object: 'chat.completion',
            result: choice?.message?.content || '',
            created: internalRes.created || Math.floor(Date.now() / 1000),
            usage: {
                prompt_tokens: internalRes.usage?.prompt_tokens || 0,
                completion_tokens: internalRes.usage?.completion_tokens || 0,
                total_tokens: internalRes.usage?.total_tokens || 0,
            },
        };
    },

    convertStreamChunk(chunk: Record<string, any>): string | null {
        const res = BaiduConverter.convertResponse(chunk as any);
        return `data: ${JSON.stringify(res)}\n\n`;
    },

    convertError(error: unknown): Record<string, any> {
        const msg = (error as any)?.message || 'Unknown error';
        return { error_code: 1, error_msg: msg };
    }
};

export const GeminiEmbeddingConverter: FormatConverter = {
    convertRequest(body: Record<string, any>): InternalRequest {
        // Gemini embedContent: { model, content: { parts: [{text}] } }
        const text = body.content?.parts?.[0]?.text || body.text || '';
        return { model: body.model || '', input: text, messages: [] } as InternalRequest;
    },
    convertResponse(internalRes: Record<string, any>): Record<string, any> { return internalRes; },
    convertStreamChunk(): string | null { return null; },
    convertError(error: unknown): Record<string, any> {
        return { error: { code: 500, message: (error as any)?.message || 'Error' } };
    }
};

export const AliEmbeddingConverter: FormatConverter = {
    convertRequest(body: Record<string, any>): InternalRequest {
        // Ali embedding: { model, input: { texts: [...] } }
        const texts = body.input?.texts || [body.input?.text || ''];
        return { model: body.model || '', input: texts, messages: [] } as InternalRequest;
    },
    convertResponse(internalRes: Record<string, any>): Record<string, any> { return internalRes; },
    convertStreamChunk(): string | null { return null; },
    convertError(error: unknown): Record<string, any> {
        return { code: 'InternalError', message: (error as any)?.message || 'Error' };
    }
};

export const BaiduEmbeddingConverter: FormatConverter = {
    convertRequest(body: Record<string, any>): InternalRequest {
        // Baidu embedding: { input: [text, ...] } or { texts: [...] }
        const texts = body.input || body.texts || [];
        return { model: body.model || '', input: texts, messages: [] } as InternalRequest;
    },
    convertResponse(internalRes: Record<string, any>): Record<string, any> { return internalRes; },
    convertStreamChunk(): string | null { return null; },
    convertError(error: unknown): Record<string, any> {
        return { error_code: 1, error_msg: (error as any)?.message || 'Error' };
    }
};

export const AudioConverter: FormatConverter = {
    convertRequest(body: Record<string, any>): InternalRequest {
        return { model: body.model || '', messages: [], ...body } as InternalRequest;
    },
    convertResponse(internalRes: Record<string, any>): Record<string, any> { return internalRes; },
    convertStreamChunk(chunk: Record<string, any>): string | null { return null; },
    convertError(error: any): Record<string, any> { return { error: error?.message || 'Error' }; },
};

export const ModerationConverter: FormatConverter = {
    convertRequest(body: Record<string, any>): InternalRequest {
        return { model: body.model || '', messages: [], ...body } as InternalRequest;
    },
    convertResponse(internalRes: Record<string, any>): Record<string, any> { return internalRes; },
    convertStreamChunk(chunk: Record<string, any>): string | null { return null; },
    convertError(error: any): Record<string, any> { return { error: error?.message || 'Error' }; },
};

/**
 * Converter Factory
 */
export function getConverter(path: string): FormatConverter {
    // Chat
    if (path.includes('/messages')) return AnthropicConverter;
    if (path.includes('/generateContent')) return GeminiConverter;
    if (path.includes('/aigc/text-generation/generation')) return AliConverter;
    if (path.includes('/wenxinworkshop/chat/')) return BaiduConverter;

    // Embeddings
    if (path.includes(':embedContent')) return GeminiEmbeddingConverter;
    if (path.includes('/aigc/multimodal-embedding/')) return AliEmbeddingConverter;
    if (path.includes('/wenxinworkshop/embeddings/')) return BaiduEmbeddingConverter;

    // Images
    if (path.includes('/aigc/text2image/')) return AliImageConverter;

    // Audio
    if (path.includes('/audio/')) return AudioConverter;

    // Moderations
    if (path.includes('/moderations')) return ModerationConverter;

    return OpenAIConverter;
}
