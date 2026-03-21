import type { Context } from 'elysia';

export interface InternalRequest {
    model: string;
    messages: { role: string; content: unknown }[][];
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

/**
 * OpenAI Format Converter (Passthrough)
 */
export class OpenAIConverter implements FormatConverter {
    convertRequest(body: Record<string, any>): InternalRequest {
        return body as InternalRequest;
    }
    convertResponse(internalRes: InternalResponse): Record<string, any> {
        return internalRes;
    }
    convertStreamChunk(chunk: Record<string, any>): string | null {
        return `data: ${JSON.stringify(chunk)}\n\n`;
    }

    convertError(error: unknown): Record<string, any> {
        return {
            error: {
                message: error.message || 'Unknown error',
                type: error.type || 'api_error',
                param: error.param,
                code: error.code
            }
        };
    }
}

/**
 * Anthropic Format Converter
 */
export class AnthropicConverter implements FormatConverter {
    convertRequest(body: Record<string, any>): InternalRequest {
        const anthropicReq = body;
        const messages: { role: string; content: unknown }[][] = [];
        
        if (anthropicReq.system) {
            messages.push({ role: 'system', content: anthropicReq.system });
        }
        
        for (const msg of anthropicReq.messages) {
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
                        openaiContent.push({
                            type: 'text',
                            text: JSON.stringify({ tool_use: { id: block.tool_use_id, name: block.name, input: block.input } })
                        });
                    }
                }
                messages.push({ role: msg.role, content: openaiContent });
            }
        }
        
        return {
            model: anthropicReq.model,
            messages,
            max_tokens: anthropicReq.max_tokens,
            stream: anthropicReq.stream || false,
            temperature: anthropicReq.temperature,
            top_p: anthropicReq.top_p,
            top_k: anthropicReq.top_k,
            tools: anthropicReq.tools?.map((t: Record<string, any>) => ({
                type: 'function',
                function: { name: t.name, description: t.description, parameters: t.input_schema }
            })),
            tool_choice: anthropicReq.tool_choice
        };
    }

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
                    input: JSON.parse(tc.function.arguments)
                });
            }
        }
        
        if (message?.content && (!message.tool_calls || message.tool_calls.length === 0)) {
            content.push({ type: 'text', text: message.content });
        }
        
        let stopReason: string = 'end_turn';
        if (choice?.finish_reason === 'length') stopReason = 'max_tokens';
        else if (choice?.finish_reason === 'tool_calls') stopReason = 'tool_use';
        
        return {
            id: internalRes.id || `msg_${Date.now()}`,
            type: 'message',
            role: 'assistant',
            content,
            model: internalRes.model,
            stop_reason: stopReason,
            usage: {
                input_tokens: internalRes.usage?.prompt_tokens || 0,
                output_tokens: internalRes.usage?.completion_tokens || 0
            }
        };
    }

    convertStreamChunk(chunk: Record<string, any>): string | null {
        const delta = chunk.choices?.[0]?.delta;
        if (!delta) return null;

        if (delta.content) {
            return `event: content_block_delta\ndata: ${JSON.stringify({
                type: 'content_block_delta',
                index: 0,
                delta: { type: 'text_delta', text: delta.content }
            })}\n\n`;
        }
        
        return null;
    }

    convertError(error: unknown): Record<string, any> {
        let type = 'api_error';
        const msg = error.message || 'Unknown error';
        if (msg.includes('401') || msg.includes('API key')) type = 'authentication_error';
        else if (msg.includes('404')) type = 'not_found_error';
        else if (msg.includes('429')) type = 'rate_limit_error';

        return {
            type: 'error',
            error: {
                type,
                message: msg
            }
        };
    }
}

/**
 * Gemini Format Converter
 */
export class GeminiConverter implements FormatConverter {
    convertRequest(body: Record<string, any>): InternalRequest {
        // Simple mapping for Gemini :generateContent format
        const contents = body.contents || [];
        const messages: { role: string; content: unknown }[][] = [];
        
        if (body.systemInstruction) {
            messages.push({
                role: 'system',
                content: body.systemInstruction.parts?.map((p: Record<string, any>) => p.text).join('\n')
            });
        }

        for (const content of contents) {
            const role = content.role === 'model' ? 'assistant' : 'user';
            const textParts = content.parts?.filter((p: Record<string, any>) => p.text).map((p: Record<string, any>) => p.text).join('\n');
            messages.push({ role, content: textParts });
        }

        return {
            model: 'gemini-model', // Model often in URL for Gemini, will be overridden by router
            messages,
            temperature: body.generationConfig?.temperature,
            max_tokens: body.generationConfig?.maxOutputTokens,
            top_p: body.generationConfig?.topP,
            top_k: body.generationConfig?.topK,
            stream: false // Gemini native has separate stream endpoint
        };
    }

    convertResponse(internalRes: InternalResponse): Record<string, any> {
        const choice = internalRes.choices?.[0];
        return {
            candidates: [{
                content: {
                    parts: [{ text: choice?.message?.content || '' }],
                    role: 'model'
                },
                finishReason: choice?.finish_reason?.toUpperCase() || 'STOP',
                index: 0
            }],
            usageMetadata: {
                promptTokenCount: internalRes.usage?.prompt_tokens || 0,
                candidatesTokenCount: internalRes.usage?.completion_tokens || 0,
                totalTokenCount: internalRes.usage?.total_tokens || 0
            }
        };
    }

    convertStreamChunk(chunk: Record<string, any>): string | null {
        // Gemini streaming uses a different chunk format
        const choice = chunk.choices?.[0];
        const res = this.convertResponse({ ...chunk, choices: [choice] } as Record<string, any>);
        return `${JSON.stringify(res)}\n`;
    }

    convertError(error: unknown): Record<string, any> {
        return {
            error: {
                code: 500,
                message: error.message || 'Unknown error',
                status: 'INTERNAL'
            }
        };
    }
}

/**
 * Ali DashScope Format Converter
 */
export class AliConverter implements FormatConverter {
    convertRequest(body: Record<string, any>): InternalRequest {
        const input = body.input || {};
        const params = body.parameters || {};
        return {
            model: body.model,
            messages: input.messages || [],
            temperature: params.temperature,
            top_p: params.top_p,
            stream: params.incremental_output || false,
            max_tokens: params.max_tokens
        };
    }

    convertResponse(internalRes: InternalResponse): Record<string, any> {
        const choice = internalRes.choices?.[0];
        return {
            request_id: internalRes.id,
            output: {
                choices: [{
                    finish_reason: choice?.finish_reason || 'stop',
                    message: {
                        role: 'assistant',
                        content: choice?.message?.content || ''
                    }
                }]
            },
            usage: {
                input_tokens: internalRes.usage?.prompt_tokens || 0,
                output_tokens: internalRes.usage?.completion_tokens || 0,
                total_tokens: internalRes.usage?.total_tokens || 0
            }
        };
    }

    convertStreamChunk(chunk: Record<string, any>): string | null {
        const res = this.convertResponse(chunk);
        return `data: ${JSON.stringify(res)}\n\n`;
    }

    convertError(error: unknown): Record<string, any> {
        return {
            code: 'InternalError',
            message: error.message || 'Unknown error',
            request_id: `err_${Date.now()}`
        };
    }
}

/**
 * Ali Image Converter
 */
export class AliImageConverter implements FormatConverter {
    convertRequest(body: Record<string, any>): InternalRequest {
        return {
            model: body.model,
            prompt: body.input?.prompt || '',
            size: body.parameters?.size || '1024*1024',
            n: body.parameters?.n || 1,
            [Symbol.for('isImage')]: true
        } as Record<string, any>;
    }
    convertResponse(internalRes: Record<string, any>): any {
        return {
            output: {
                task_id: internalRes.id,
                task_status: 'SUCCEEDED',
                results: internalRes.data?.map((d: Record<string, any>) => ({ url: d.url })) || []
            },
            request_id: internalRes.id
        };
    }
    convertStreamChunk(): string | null { return null; }
    convertError(error: unknown): Record<string, any> {
        return { code: 'InternalError', message: error.message || 'Unknown error' };
    }
}

/**
 * Baidu ERNIE Format Converter
 */
export class BaiduConverter implements FormatConverter {
    convertRequest(body: Record<string, any>): InternalRequest {
        return {
            model: 'baidu-model', // Overridden by router
            messages: body.messages || [],
            stream: body.stream || false,
            temperature: body.temperature,
            top_p: body.top_p
        };
    }

    convertResponse(internalRes: InternalResponse): Record<string, any> {
        const choice = internalRes.choices?.[0];
        return {
            id: internalRes.id,
            result: choice?.message?.content || '',
            finish_reason: choice?.finish_reason || 'stop',
            usage: {
                prompt_tokens: internalRes.usage?.prompt_tokens || 0,
                completion_tokens: internalRes.usage?.completion_tokens || 0,
                total_tokens: internalRes.usage?.total_tokens || 0
            }
        };
    }

    convertStreamChunk(chunk: Record<string, any>): string | null {
        const res = this.convertResponse(chunk);
        return `data: ${JSON.stringify(res)}\n\n`;
    }

    convertError(error: unknown): Record<string, any> {
        return {
            error_code: 1,
            error_msg: error.message || 'Unknown error'
        };
    }
}

/**
 * Gemini Embedding Converter
 */
export class GeminiEmbeddingConverter implements FormatConverter {
    convertRequest(body: Record<string, any>): InternalRequest {
        return {
            model: 'embedding-model',
            input: body.content?.parts?.[0]?.text || '',
            [Symbol.for('isEmbedding')]: true
        } as Record<string, any>;
    }
    convertResponse(internalRes: Record<string, any>): any {
        return {
            embedding: {
                values: internalRes.data?.[0]?.embedding || []
            }
        };
    }
    convertStreamChunk(): string | null { return null; }
    convertError(error: unknown): Record<string, any> {
        return { error: { message: error.message || 'Unknown error', code: 500 } };
    }
}

/**
 * Ali Embedding Converter
 */
export class AliEmbeddingConverter implements FormatConverter {
    convertRequest(body: Record<string, any>): InternalRequest {
        return {
            model: body.model,
            input: body.input?.texts || body.input?.text || '',
            [Symbol.for('isEmbedding')]: true
        } as Record<string, any>;
    }
    convertResponse(internalRes: Record<string, any>): any {
        return {
            output: {
                embeddings: internalRes.data?.map((d: Record<string, any>) => ({ embedding: d.embedding })) || []
            },
            request_id: internalRes.id,
            usage: internalRes.usage
        };
    }
    convertStreamChunk(): string | null { return null; }
    convertError(error: unknown): Record<string, any> {
        return { code: 'InternalError', message: error.message || 'Unknown error' };
    }
}

/**
 * Baidu Embedding Converter
 */
export class BaiduEmbeddingConverter implements FormatConverter {
    convertRequest(body: Record<string, any>): InternalRequest {
        return {
            model: 'baidu-embedding',
            input: body.input || [],
            [Symbol.for('isEmbedding')]: true
        } as Record<string, any>;
    }
    convertResponse(internalRes: Record<string, any>): any {
        return {
            id: internalRes.id,
            data: internalRes.data?.map((d: Record<string, any>) => ({ embedding: d.embedding, object: 'embedding', index: d.index })) || [],
            usage: internalRes.usage
        };
    }
    convertStreamChunk(): string | null { return null; }
    convertError(error: unknown): Record<string, any> {
        return { error_code: 1, error_msg: error.message || 'Unknown error' };
    }
}

/**
 * Audio (TTS/STT) Converter
 */
export class AudioConverter implements FormatConverter {
    convertRequest(body: Record<string, any>): InternalRequest {
        return {
            model: body.model,
            input: body.input || '',
            voice: body.voice,
            [Symbol.for('isAudio')]: true
        } as Record<string, any>;
    }
    convertResponse(internalRes: Record<string, any>): any {
        return internalRes; // Binaery responses usually passthru
    }
    convertStreamChunk(): string | null { return null; }
    convertError(error: unknown): Record<string, any> {
        return { error: { message: error.message || 'Unknown error', type: 'audio_error' } };
    }
}

/**
 * Moderation Converter
 */
export class ModerationConverter implements FormatConverter {
    convertRequest(body: Record<string, any>): InternalRequest {
        return {
            model: body.model || 'omni-moderation-latest',
            input: body.input,
            [Symbol.for('isModeration')]: true
        } as Record<string, any>;
    }
    convertResponse(internalRes: Record<string, any>): any {
        return internalRes;
    }
    convertStreamChunk(): string | null { return null; }
    convertError(error: unknown): Record<string, any> {
        return { error: { message: error.message || 'Unknown error', type: 'moderation_error' } };
    }
}

/**
 * Converter Factory
 */
export class ConverterFactory {
    static getConverter(path: string): FormatConverter {
        // Chat
        if (path.includes('/messages')) return new AnthropicConverter();
        if (path.includes('/generateContent')) return new GeminiConverter();
        if (path.includes('/aigc/text-generation/generation')) return new AliConverter();
        if (path.includes('/wenxinworkshop/chat/')) return new BaiduConverter();

        // Embeddings
        if (path.includes(':embedContent')) return new GeminiEmbeddingConverter();
        if (path.includes('/aigc/multimodal-embedding/')) return new AliEmbeddingConverter();
        if (path.includes('/wenxinworkshop/embeddings/')) return new BaiduEmbeddingConverter();

        // Images
        if (path.includes('/aigc/text2image/')) return new AliImageConverter();

        // Audio
        if (path.includes('/audio/')) return new AudioConverter();

        // Moderations
        if (path.includes('/moderations')) return new ModerationConverter();

        return new OpenAIConverter();
    }
}
