import { Elysia } from 'elysia';
import { memoryCache } from '../services/cache';
import { billAndLog } from '../services/billing';
import { calculateCost } from '../services/ratio';
import { getChannelKeys } from '../services/encryption';
import { UnifiedDispatcher } from '../services/dispatcher';
import { getProviderHandler } from '../providers';
import { type TokenRecord, type UserRecord, type ChannelConfig } from '../types';

/**
 * Anthropic Messages API Compatible Endpoint
 * 
 * This endpoint accepts Anthropic API format requests and converts them
 * to the appropriate format based on the upstream channel type.
 * 
 * Request Flow:
 * 1. User sends Anthropic format request to /v1/messages
 * 2. Gateway looks up channel for the requested model
 * 3. If channel is Anthropic type -> forward as-is
 * 4. If channel is OpenAI type -> convert to OpenAI format
 * 5. Return response in Anthropic format
 */

interface AnthropicMessage {
    role: 'user' | 'assistant';
    content: string | AnthropicContentBlock[];
}

interface AnthropicContentBlock {
    type: 'text' | 'image' | 'tool_use' | 'tool_result';
    text?: string;
    source?: {
        type: 'base64' | 'url';
        media_type: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
        data?: string;
        url?: string;
    };
    tool_use_id?: string;
    name?: string;
    input?: any;
    content?: string | AnthropicContentBlock[];
}

interface AnthropicRequest {
    model: string;
    messages: AnthropicMessage[];
    max_tokens: number;
    system?: string;
    temperature?: number;
    top_p?: number;
    top_k?: number;
    stream?: boolean;
    tools?: any[];
    tool_choice?: any;
    thinking?: {
        type: 'enabled';
        budget_tokens: number;
    };
}

interface AnthropicResponse {
    id: string;
    type: 'message' | 'message_start' | 'content_block_start' | 'content_block_delta' | 'content_block_stop' | 'message_delta' | 'message_stop';
    role?: 'assistant';
    content?: AnthropicContentBlock[];
    model?: string;
    stop_reason?: 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use';
    stop_sequence?: any;
    usage?: {
        input_tokens: number;
        output_tokens: number;
        cache_creation_input_tokens?: number;
        cache_read_input_tokens?: number;
    };
}

/**
 * Convert Anthropic request to OpenAI format
 */
function anthropicToOpenAI(anthropicReq: AnthropicRequest): any {
    const messages: any[] = [];
    
    // Add system message if present
    if (anthropicReq.system) {
        messages.push({
            role: 'system',
            content: anthropicReq.system
        });
    }
    
    // Convert messages
    for (const msg of anthropicReq.messages) {
        if (typeof msg.content === 'string') {
            messages.push({
                role: msg.role,
                content: msg.content
            });
        } else if (Array.isArray(msg.content)) {
            // Handle multimodal content
            const openaiContent: any[] = [];
            for (const block of msg.content) {
                if (block.type === 'text') {
                    openaiContent.push({
                        type: 'text',
                        text: block.text
                    });
                } else if (block.type === 'image' && block.source) {
                    if (block.source.type === 'url') {
                        openaiContent.push({
                            type: 'image_url',
                            image_url: {
                                url: block.source.url
                            }
                        });
                    } else if (block.source.type === 'base64') {
                        openaiContent.push({
                            type: 'image_url',
                            image_url: {
                                url: `data:${block.source.media_type};base64,${block.source.data}`
                            }
                        });
                    }
                } else if (block.type === 'tool_use') {
                    // Handle tool_use in assistant messages
                    openaiContent.push({
                        type: 'text',
                        text: JSON.stringify({
                            tool_use: {
                                id: block.tool_use_id,
                                name: block.name,
                                input: block.input
                            }
                        })
                    });
                } else if (block.type === 'tool_result') {
                    // Tool results are mapped to user role with tool content
                    openaiContent.push({
                        type: 'text',
                        text: typeof block.content === 'string' ? block.content : JSON.stringify(block.content)
                    });
                }
            }
            messages.push({
                role: msg.role,
                content: openaiContent.length === 1 && openaiContent[0].type === 'text' 
                    ? openaiContent[0].text 
                    : openaiContent
            });
        }
    }
    
    const openaiReq: any = {
        model: anthropicReq.model,
        messages,
        max_tokens: anthropicReq.max_tokens,
        stream: anthropicReq.stream || false
    };
    
    if (anthropicReq.temperature !== undefined) {
        openaiReq.temperature = anthropicReq.temperature;
    }
    if (anthropicReq.top_p !== undefined) {
        openaiReq.top_p = anthropicReq.top_p;
    }
    if (anthropicReq.top_k !== undefined) {
        openaiReq.top_k = anthropicReq.top_k;
    }
    if (anthropicReq.tools) {
        openaiReq.tools = anthropicReq.tools.map((tool: any) => ({
            type: 'function',
            function: {
                name: tool.name,
                description: tool.description,
                parameters: tool.input_schema
            }
        }));
    }
    if (anthropicReq.tool_choice) {
        openaiReq.tool_choice = anthropicReq.tool_choice;
    }
    
    return openaiReq;
}

/**
 * Convert OpenAI response to Anthropic format
 */
function openAIToAnthropic(openaiRes: any, model: string): AnthropicResponse {
    const content: AnthropicContentBlock[] = [];
    
    // Handle both streaming (delta) and non-streaming (message) formats
    const choice = openaiRes.choices?.[0];
    const message = choice?.message || choice?.delta;
    
    // Handle tool calls
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
    
    // Handle text content
    const textContent = message?.content;
    if (textContent && (!message?.tool_calls || message.tool_calls.length === 0)) {
        content.push({
            type: 'text',
            text: textContent
        });
    }
    
    // Map finish_reason
    let stopReason: 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use' = 'end_turn';
    const finishReason = choice?.finish_reason;
    if (finishReason === 'length') {
        stopReason = 'max_tokens';
    } else if (finishReason === 'tool_calls') {
        stopReason = 'tool_use';
    } else if (finishReason === 'stop') {
        stopReason = 'end_turn';
    }
    
    return {
        id: openaiRes.id || `msg_${Date.now()}`,
        type: 'message',
        role: 'assistant',
        content,
        model,
        stop_reason: stopReason,
        usage: {
            input_tokens: openaiRes.usage?.prompt_tokens || 0,
            output_tokens: openaiRes.usage?.completion_tokens || 0
        }
    };
}

export const anthropicRouter = new Elysia()
    .post('/messages', async ({ body, headers, query }: any) => {
        const startTime = Date.now();
        
        // Elysia headers is a plain object, not a Headers instance
        const headerObj = headers as Record<string, string>;
        const getHeader = (name: string) => headerObj[name.toLowerCase()] || headerObj[name] || '';
        
        const ip = getHeader('x-forwarded-for') || getHeader('x-real-ip') || 'unknown';
        const ua = getHeader('user-agent') || 'unknown';
        
        try {
            // Parse request body
            const anthropicReq: AnthropicRequest = typeof body === 'string' ? JSON.parse(body) : body;
            const model = anthropicReq.model;
            const isStream = anthropicReq.stream || false;
            
            // Extract API key from headers (x-api-key or Authorization)
            let apiKey = getHeader('x-api-key') || '';
            if (!apiKey) {
                const authHeader = getHeader('authorization') || '';
                if (authHeader.startsWith('Bearer ')) {
                    apiKey = authHeader.slice(7);
                }
            }
            
            if (!apiKey) {
                return new Response(JSON.stringify({
                    type: 'error',
                    error: {
                        type: 'authentication_error',
                        message: 'Missing API key. Use x-api-key header or Authorization: Bearer <key>'
                    }
                }), {
                    status: 401,
                    headers: { 'Content-Type': 'application/json' }
                });
            }
            
            // Validate token (use async method to check cache and DB)
            const t = await memoryCache.getTokenFromCache(apiKey);
            if (!t) {
                return new Response(JSON.stringify({
                    type: 'error',
                    error: {
                        type: 'authentication_error',
                        message: 'Invalid API key'
                    }
                }), {
                    status: 401,
                    headers: { 'Content-Type': 'application/json' }
                });
            }
            
            // Get user from cache (use async method to check cache and DB)
            const u = await memoryCache.getUserFromDB(t.userId);
            if (!u) {
                return new Response(JSON.stringify({
                    type: 'error',
                    error: {
                        type: 'authentication_error',
                        message: 'User not found'
                    }
                }), {
                    status: 401,
                    headers: { 'Content-Type': 'application/json' }
                });
            }
            
            // Check token status
            if (t.status !== 1) {
                return new Response(JSON.stringify({
                    type: 'error',
                    error: {
                        type: 'authentication_error',
                        message: 'API key is disabled'
                    }
                }), {
                    status: 401,
                    headers: { 'Content-Type': 'application/json' }
                });
            }
            
            // Check model access
            const tokenModels = t.models || [];
            if (tokenModels.length > 0 && !tokenModels.includes(model) && !tokenModels.includes('*')) {
                return new Response(JSON.stringify({
                    type: 'error',
                    error: {
                        type: 'invalid_request_error',
                        message: `Model ${model} is not allowed for this token`
                    }
                }), {
                    status: 400,
                    headers: { 'Content-Type': 'application/json' }
                });
            }
            
            // Get channel for this model
            const channels = memoryCache.selectChannels(model, u.group);
            if (!channels || channels.length === 0) {
                return new Response(JSON.stringify({
                    type: 'error',
                    error: {
                        type: 'not_found_error',
                        message: `No available channel for model: ${model}`
                    }
                }), {
                    status: 404,
                    headers: { 'Content-Type': 'application/json' }
                });
            }
            
            const channel = channels[0];
            console.log(`[Anthropic] Selected channel: ${channel.name} (id=${channel.id}), model: ${model}`);
            
            // Get channel keys (channel.key is the encrypted keys string)
            const keys = getChannelKeys(channel.key);
            if (!keys || keys.length === 0) {
                return new Response(JSON.stringify({
                    type: 'error',
                    error: {
                        type: 'api_error',
                        message: 'No API keys available for channel'
                    }
                }), {
                    status: 500,
                    headers: { 'Content-Type': 'application/json' }
                });
            }
            
            const activeKey = keys[0];
            
            // Determine if we need to convert the request
            const channelType = channel.type;
            const isAnthropicChannel = channelType === 3; // ChannelType.ANTHROPIC
            
            let requestBody: any;
            let upstreamModel = model;
            
            // Handle model mapping
            if (channel.modelMapping && channel.modelMapping[model]) {
                upstreamModel = channel.modelMapping[model];
            }
            
            if (isAnthropicChannel) {
                // Keep Anthropic format for Anthropic channels
                requestBody = {
                    ...anthropicReq,
                    model: upstreamModel
                };
            } else {
                // Convert to OpenAI format for other channels
                requestBody = anthropicToOpenAI(anthropicReq);
                requestBody.model = upstreamModel;
            }
            
            // Dispatch request using UnifiedDispatcher
            const result = await UnifiedDispatcher.dispatch({
                model,
                body: requestBody,
                user: u,
                token: t,
                endpointType: 'chat',
                stream: isStream,
                ip,
                ua
            });
            
            // Handle streaming response
            if (isStream && result instanceof Response) {
                // For streaming, we need to convert the SSE format
                return convertStreamToAnthropic(result, model);
            }
            
            // Handle non-streaming response
            if (!isStream && result && !(result instanceof Response)) {
                // Convert response back to Anthropic format if needed
                if (!isAnthropicChannel) {
                    const anthropicResponse = openAIToAnthropic(result, model);
                    
                    // Bill and log
                    const promptTokens = anthropicResponse.usage?.input_tokens || 0;
                    const completionTokens = anthropicResponse.usage?.output_tokens || 0;
                    
                    await billAndLog({
                        userId: u.id,
                        tokenId: t.id,
                        channelId: channel.id,
                        modelName: model,
                        promptTokens,
                        completionTokens,
                        userGroup: u.group,
                        isStream: false,
                        elapsedMs: Date.now() - startTime,
                        ip,
                        ua
                    }).catch(e => console.error('[Anthropic] Billing Error:', e.message));
                    
                    return anthropicResponse;
                }
                
                // Already in Anthropic format
                return result;
            }
            
            return result;
            
        } catch (error: any) {
            console.error('[Anthropic] Error:', error.message);
            return new Response(JSON.stringify({
                type: 'error',
                error: {
                    type: 'api_error',
                    message: error.message
                }
            }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' }
            });
        }
    });

/**
 * Convert streaming response to Anthropic SSE format
 */
async function convertStreamToAnthropic(response: Response, model: string): Promise<Response> {
    const reader = response.body?.getReader();
    if (!reader) {
        return response;
    }
    
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    
    const stream = new ReadableStream({
        async start(controller) {
            // Send message_start event
            const messageStart = {
                type: 'message_start',
                message: {
                    id: `msg_${Date.now()}`,
                    type: 'message',
                    role: 'assistant',
                    content: [],
                    model,
                    stop_reason: null,
                    usage: { input_tokens: 0, output_tokens: 0 }
                }
            };
            controller.enqueue(encoder.encode(`event: message_start\ndata: ${JSON.stringify(messageStart)}\n\n`));
            
            let buffer = '';
            let contentIndex = 0;
            
            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    
                    buffer += decoder.decode(value);
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || '';
                    
                    for (const line of lines) {
                        if (line.startsWith('data: ')) {
                            const data = line.slice(6);
                            if (data === '[DONE]') {
                                // Send message_stop event
                                const messageStop = {
                                    type: 'message_stop'
                                };
                                controller.enqueue(encoder.encode(`event: message_stop\ndata: ${JSON.stringify(messageStop)}\n\n`));
                            } else {
                                try {
                                    const chunk = JSON.parse(data);
                                    const delta = chunk.choices?.[0]?.delta;
                                    
                                    if (delta?.content) {
                                        // Send content_block_delta event
                                        const contentDelta = {
                                            type: 'content_block_delta',
                                            index: contentIndex,
                                            delta: {
                                                type: 'text_delta',
                                                text: delta.content
                                            }
                                        };
                                        controller.enqueue(encoder.encode(`event: content_block_delta\ndata: ${JSON.stringify(contentDelta)}\n\n`));
                                    }
                                    
                                    if (delta?.tool_calls) {
                                        for (const tc of delta.tool_calls) {
                                            const toolDelta = {
                                                type: 'content_block_delta',
                                                index: contentIndex,
                                                delta: {
                                                    type: 'input_json_delta',
                                                    partial_json: tc.function?.arguments || ''
                                                }
                                            };
                                            controller.enqueue(encoder.encode(`event: content_block_delta\ndata: ${JSON.stringify(toolDelta)}\n\n`));
                                        }
                                    }
                                } catch (e) {
                                    // Skip invalid JSON
                                }
                            }
                        }
                    }
                }
            } catch (error) {
                console.error('[Anthropic] Stream conversion error:', error);
            }
            
            controller.close();
        }
    });
    
    return new Response(stream, {
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
        }
    });
}
