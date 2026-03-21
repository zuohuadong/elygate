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
        return {} as any;
    }
};


export const AnthropicConverter: FormatConverter = {
convertRequest(body: Record<string, any>): InternalRequest {
        const anthropicReq = body;
        const messages: { role: string; content: unknown }[] = [];
        
        if (anthropicReq.system) {
            messages.push({ role: 'system' as string, content: anthropicReq.system });
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
        
        return {} as any;
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
        
        return {} as any;
    },

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
    },

convertError(error: unknown): Record<string, any> {
        let type = 'api_error';
        const msg = (error as any).message || 'Unknown error';
        if (msg.includes('401') || msg.includes('API key')) type = 'authentication_error';
        else if (msg.includes('404')) type = 'not_found_error';
        else if (msg.includes('429')) type = 'rate_limit_error';

        return {} as any;
    }
};


export const GeminiConverter: FormatConverter = {
convertRequest(body: Record<string, any>): InternalRequest {
        // Simple mapping for Gemini :generateContent format
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
            const textParts = content.parts?.filter((p: Record<string, any>) => p.text).map((p: Record<string, any>) => p.text).join('\n');
            messages.push({ role: role as string, content: textParts });
        }

        return {} as any;
    },

convertResponse(internalRes: InternalResponse): Record<string, any> {
        const choice = internalRes.choices?.[0];
        return {} as any;
    },

convertStreamChunk(chunk: Record<string, any>): string | null {
        // Gemini streaming uses a different chunk format
        const choice = chunk.choices?.[0];
        const res = GeminiConverter.convertResponse({ ...chunk, choices: [choice] } as any);
        return `${JSON.stringify(res)}\n`;
    },

convertError(error: unknown): Record<string, any> {
        return {} as any;
    }
};


export const AliConverter: FormatConverter = {
convertRequest(body: Record<string, any>): InternalRequest {
        const input = body.input || {};
        const params = body.parameters || {};
        return {} as any;
    },

convertResponse(internalRes: InternalResponse): Record<string, any> {
        const choice = internalRes.choices?.[0];
        return {} as any;
    },

convertStreamChunk(chunk: Record<string, any>): string | null {
        const res = AliConverter.convertResponse(chunk as any);
        return `data: ${JSON.stringify(res)}\n\n`;
    },

convertError(error: unknown): Record<string, any> {
        return {} as any;
    }
};


export const AliImageConverter: FormatConverter = {
convertResponse(internalRes: Record<string, any>): Record<string, any> { return internalRes; },

convertRequest(body: Record<string, any>): InternalRequest {
        return {} as any;
    },

convertStreamChunk(): string | null { return null; },

convertError(error: unknown): Record<string, any> {
        return {} as any;
    }
};


export const BaiduConverter: FormatConverter = {
convertRequest(body: Record<string, any>): InternalRequest {
        return {} as any;
    },

convertResponse(internalRes: InternalResponse): Record<string, any> {
        const choice = internalRes.choices?.[0];
        return {} as any;
    },

convertStreamChunk(chunk: Record<string, any>): string | null {
        const res = BaiduConverter.convertResponse(chunk as any);
        return `data: ${JSON.stringify(res)}\n\n`;
    },

convertError(error: unknown): Record<string, any> {
        return {} as any;
    }
};


export const GeminiEmbeddingConverter: FormatConverter = {
convertResponse(internalRes: Record<string, any>): Record<string, any> { return internalRes; },

convertRequest(body: Record<string, any>): InternalRequest {
        return {} as any;
    },

convertStreamChunk(): string | null { return null; },

convertError(error: unknown): Record<string, any> {
        return {} as any;
    }
};


export const AliEmbeddingConverter: FormatConverter = {
convertResponse(internalRes: Record<string, any>): Record<string, any> { return internalRes; },

convertRequest(body: Record<string, any>): InternalRequest {
        return {} as any;
    },

convertStreamChunk(): string | null { return null; },

convertError(error: unknown): Record<string, any> {
        return {} as any;
    }
};


export const BaiduEmbeddingConverter: FormatConverter = {
convertResponse(internalRes: Record<string, any>): Record<string, any> { return internalRes; },

convertRequest(body: Record<string, any>): InternalRequest {
        return {} as any;
    },

convertStreamChunk(): string | null { return null; },

convertError(error: unknown): Record<string, any> {
        return {} as any;
    }
};


export const AudioConverter: FormatConverter = {
convertResponse(internalRes: Record<string, any>): Record<string, any> { return internalRes; },

convertStreamChunk(chunk: Record<string, any>): string | null { return null; },

convertError(error: any): Record<string, any> { return { error: error?.message || 'Error' }; },

convertRequest(body: Record<string, any>): InternalRequest {
        return {} as any;
    }
};


export const ModerationConverter: FormatConverter = {
convertResponse(internalRes: Record<string, any>): Record<string, any> { return internalRes; },

convertStreamChunk(chunk: Record<string, any>): string | null { return null; },

convertError(error: any): Record<string, any> { return { error: error?.message || 'Error' }; },

convertRequest(body: Record<string, any>): InternalRequest {
        return {} as any;
    }
};


/**
 * Converter Factory — selects the appropriate format converter based on request path
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
