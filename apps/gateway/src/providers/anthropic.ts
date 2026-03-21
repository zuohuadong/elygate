import { ProviderHandler } from './types';

/**
 * Anthropic Claude API Adapter
 * Transforms OpenAI-like requests to Anthropic strictly required format.
 */
export class AnthropicApiHandler implements ProviderHandler {
    transformRequest(body: Record<string, any>, model: string) {
        // Claude requires max_tokens parameter
        let maxTokens = body.max_tokens || 4096;

        // Skip system messages for the 'messages' array
        const anthropicMessages = body.messages
            .filter((m: Record<string, any>) => m.role !== 'system')
            .map((m: Record<string, any>) => {
                // If content is already an array (Anthropic style), keep it.
                // If it's a string, Anthropic supports it as-is or we could wrap it.
                // Also handle tool_calls (OpenAI style) -> tool_use (Anthropic style)
                if (m.role === 'assistant' && m.tool_calls) {
                    const content = [];
                    if (m.content) content.push({ type: 'text', text: m.content });
                    for (const tc of m.tool_calls) {
                        content.push({
                            type: 'tool_use',
                            id: tc.id,
                            name: tc.function.name,
                            input: JSON.parse(tc.function.arguments)
                        });
                    }
                    return { role: 'assistant', content };
                }
                // Handle tool (OpenAI style) role -> tool_result (Anthropic style)
                if (m.role === 'tool') {
                    return {
                        role: 'user',
                        content: [
                            {
                                type: 'tool_result',
                                tool_use_id: m.tool_call_id,
                                content: m.content
                            }
                        ]
                    };
                }
                return { role: m.role, content: m.content };
            });

        const systemMessage = body.messages.find((m: Record<string, any>) => m.role === 'system')?.content || '';

        const payload: Record<string, any> = {
            model,
            max_tokens: maxTokens,
            messages: anthropicMessages,
            temperature: body.temperature ?? 1.0,
            stream: body.stream || false,
        };

        if (systemMessage) {
            payload.system = systemMessage;
        }

        if (body.tools) {
            payload.tools = body.tools.map((t: Record<string, any>) => ({
                name: t.function.name,
                description: t.function.description,
                input_schema: t.function.parameters
            }));
        }

        if (body.tool_choice) {
            payload.tool_choice = body.tool_choice;
        }

        if (body.thinking) {
            payload.thinking = body.thinking;
            // When thinking is enabled, max_tokens must be greater than budget
            if (body.thinking.budget_tokens >= maxTokens) {
                payload.max_tokens = body.thinking.budget_tokens + 1024;
            }
        }

        return payload;
    }

    transformResponse(data: Record<string, any>): Record<string, any> {
        if (!data || !data.content) return data;

        const message: Record<string, any> = {
            role: 'assistant',
            content: '',
        };

        const toolCalls = [];
        let reasoningContent = '';

        for (const block of data.content) {
            if (block.type === 'text') {
                message.content += block.text;
            } else if (block.type === 'thinking') {
                reasoningContent += block.thinking;
            } else if (block.type === 'tool_use') {
                toolCalls.push({
                    id: block.id,
                    type: 'function',
                    function: {
                        name: block.name,
                        arguments: JSON.stringify(block.input)
                    }
                });
            }
        }

        if (toolCalls.length > 0) {
            message.tool_calls = toolCalls;
        }

        if (reasoningContent) {
            message.reasoning_content = reasoningContent;
        }

        // Claude format -> OpenAI format
        return {
            id: data.id || `chatcmpl-${Date.now()}`,
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            model: data.model,
            choices: [
                {
                    index: 0,
                    message,
                    finish_reason: data.stop_reason === 'end_turn' ? 'stop' : (data.stop_reason === 'tool_use' ? 'tool_calls' : data.stop_reason),
                },
            ],
            usage: {
                prompt_tokens: data.usage?.input_tokens || 0,
                completion_tokens: data.usage?.output_tokens || 0,
                total_tokens: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0),
            },
        };
    }

    extractUsage(data: Record<string, any>) {
        const promptTokens = data.usage?.input_tokens || 0;
        const completionTokens = data.usage?.output_tokens || 0;
        const cachedTokens = data.usage?.cache_read_input_tokens;
        return {
            promptTokens,
            completionTokens,
            ...(cachedTokens !== undefined && { cachedTokens })
        };
    }

    buildHeaders(apiKey: string) {
        const headers = new Headers();
        headers.set('Content-Type', 'application/json');
        headers.set('x-api-key', apiKey);
        headers.set('anthropic-version', '2023-06-01');
        return headers;
    }
}
