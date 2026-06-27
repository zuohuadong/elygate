import { describe, expect, test } from 'bun:test';

const { DifyApiHandler } = await import('./dify');
const { AnthropicApiHandler } = await import('./anthropic');
const { GeminiApiHandler } = await import('./gemini');
const { OpenAIApiHandler } = await import('./openai');
const { ZhipuProvider } = await import('./zhipu');

async function withImmediatePolling<T>(fn: () => Promise<T>): Promise<T> {
    const originalSetTimeout = globalThis.setTimeout;
    globalThis.setTimeout = ((handler: Parameters<typeof setTimeout>[0], _timeout?: Parameters<typeof setTimeout>[1], ...args: unknown[]) => {
        if (typeof handler === 'function') {
            queueMicrotask(() => handler(...args));
        }
        return 0 as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout;

    try {
        return await fn();
    } finally {
        globalThis.setTimeout = originalSetTimeout;
    }
}

function installFetchSequence(payloads: Array<Record<string, unknown>>, statuses: number[] = []): () => number {
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async () => {
        const index = Math.min(calls, payloads.length - 1);
        calls += 1;
        return new Response(JSON.stringify(payloads[index]), {
            status: statuses[index] ?? 200,
            headers: { 'content-type': 'application/json' },
        });
    }) as unknown as typeof fetch;

    return () => {
        globalThis.fetch = originalFetch;
        return calls;
    };
}

describe('provider contract compatibility', () => {
    test('maps Dify chat messages into blocking and streaming workflow calls', () => {
        const request = DifyApiHandler.transformRequest({
            messages: [{ role: 'user', content: 'hello dify' }],
            stream: true,
            user_id: 'user_1',
        }, 'dify-app');

        expect(request).toMatchObject({
            query: 'hello dify',
            response_mode: 'streaming',
            user: 'user_1',
            model: 'dify-app',
        });
        expect(DifyApiHandler.overrideRequestUrl?.('https://dify.example.test/', 'dify-app', 'chat')).toBe('https://dify.example.test/v1/chat-messages');

        const response = DifyApiHandler.transformResponse({
            message_id: 'msg_1',
            answer: 'done',
            metadata: { usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 } },
        });
        expect(response).toMatchObject({
            id: 'msg_1',
            object: 'chat.completion',
            choices: [{ message: { role: 'assistant', content: 'done' } }],
            usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 },
        });
        expect(DifyApiHandler.extractUsage({ metadata: { usage: { prompt_tokens: 3, completion_tokens: 4 } } })).toEqual({
            promptTokens: 3,
            completionTokens: 4,
        });
    });

    test('maps OpenAI tool calls to Anthropic Claude tool_use and back', async () => {
        const request = AnthropicApiHandler.transformRequest({
            messages: [
                { role: 'system', content: 'be terse' },
                { role: 'user', content: 'weather' },
                {
                    role: 'assistant',
                    content: 'calling tool',
                    tool_calls: [{
                        id: 'call_1',
                        function: { name: 'weather', arguments: '{"city":"Paris"}' },
                    }],
                },
                { role: 'tool', tool_call_id: 'call_1', content: '{"temp":21}' },
            ],
            tools: [{ function: { name: 'weather', description: 'forecast', parameters: { type: 'object' } } }],
            max_tokens: 64,
        }, 'claude-3-5-sonnet');

        expect(request.system).toBe('be terse');
        expect(request.messages).toEqual([
            { role: 'user', content: 'weather' },
            {
                role: 'assistant',
                content: [
                    { type: 'text', text: 'calling tool' },
                    { type: 'tool_use', id: 'call_1', name: 'weather', input: { city: 'Paris' } },
                ],
            },
            { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_1', content: '{"temp":21}' }] },
        ]);

        const response = await AnthropicApiHandler.transformResponse({
            id: 'msg_1',
            model: 'claude-3-5-sonnet',
            content: [
                { type: 'thinking', thinking: 'reasoning' },
                { type: 'text', text: 'sunny' },
                { type: 'tool_use', id: 'toolu_1', name: 'weather', input: { city: 'Paris' } },
            ],
            stop_reason: 'tool_use',
            usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 2 },
        });
        expect(response.choices[0].message).toMatchObject({
            content: 'sunny',
            reasoning_content: 'reasoning',
            tool_calls: [{ id: 'toolu_1', function: { name: 'weather', arguments: '{"city":"Paris"}' } }],
        });
        expect(response.choices[0].finish_reason).toBe('tool_calls');
        expect(AnthropicApiHandler.extractUsage({ usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 2 } })).toEqual({
            promptTokens: 10,
            completionTokens: 5,
            cachedTokens: 2,
        });
    });

    test('maps Gemini multimodal requests, responses, and cached-token usage', async () => {
        const request = GeminiApiHandler.transformRequest({
            messages: [
                { role: 'system', content: 'system prompt' },
                {
                    role: 'user',
                    content: [
                        { type: 'text', text: 'describe' },
                        { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
                    ],
                },
            ],
            temperature: 0.2,
            max_tokens: 128,
            stop: 'END',
        }, 'gemini-2.5-pro');

        expect(request.systemInstruction).toEqual({ parts: [{ text: 'system prompt' }] });
        expect(request.contents[0].parts).toEqual([
            { text: 'describe' },
            { inlineData: { mimeType: 'image/png', data: 'AAAA' } },
        ]);
        expect(request.generationConfig).toMatchObject({ temperature: 0.2, maxOutputTokens: 128, stopSequences: ['END'] });

        const response = await GeminiApiHandler.transformResponse({
            candidates: [{ content: { parts: [{ text: 'A' }, { text: ' cat' }] }, finishReason: 'STOP' }],
            usageMetadata: { promptTokenCount: 6, candidatesTokenCount: 2, totalTokenCount: 8, cachedContentTokenCount: 1 },
        });
        expect(response.choices[0].message.content).toBe('A cat');
        expect(response.usage).toEqual({ prompt_tokens: 6, completion_tokens: 2, total_tokens: 8 });
        expect(GeminiApiHandler.extractUsage({ usageMetadata: { promptTokenCount: 6, candidatesTokenCount: 2, cachedContentTokenCount: 1 } })).toEqual({
            promptTokens: 6,
            completionTokens: 2,
            cachedTokens: 1,
        });
    });

    test('keeps custom OpenAI-compatible upstream payloads pass-through with auth headers', () => {
        const request = OpenAIApiHandler.transformRequest({
            messages: [{ role: 'user', content: 'hello' }],
            computer_use: { enabled: true },
            deferred_tools: true,
        }, 'custom-model');

        expect(request).toMatchObject({
            model: 'custom-model',
            computer_use: { enabled: true },
            tools_metadata: { search: true, deferred: true },
        });

        const headers = OpenAIApiHandler.buildHeaders('sk-custom');
        expect(headers.get('authorization')).toBe('Bearer sk-custom');
        expect(OpenAIApiHandler.extractUsage({ usage: { prompt_tokens: 4, completion_tokens: 3, prompt_tokens_details: { cached_tokens: 1 } } })).toEqual({
            promptTokens: 4,
            completionTokens: 3,
            cachedTokens: 1,
        });
    });

    test('polls Zhipu async video tasks until provider completion', async () => {
        const restoreFetch = installFetchSequence([
            { task_status: 'PROCESSING' },
            {
                task_status: 'SUCCESS',
                model: 'cogvideox-3',
                video_result: [{ url: 'https://media.example.test/video.mp4', cover_image_url: 'https://media.example.test/cover.jpg' }],
            },
        ]);

        try {
            const result = await withImmediatePolling(() => ZhipuProvider.pollAsyncResult?.('task_123', 'https://open.bigmodel.cn/api/paas/v4', 'sk-test') ?? Promise.reject(new Error('missing poller')));
            expect(result).toEqual({
                id: 'task_123',
                model: 'cogvideox-3',
                videos: [{ url: 'https://media.example.test/video.mp4', cover_url: 'https://media.example.test/cover.jpg' }],
            });
        } finally {
            expect(restoreFetch()).toBe(2);
        }
    });

    test('fails Zhipu async video polling immediately when provider task fails', async () => {
        const restoreFetch = installFetchSequence([
            { task_status: 'FAILED', error: 'provider rejected task' },
        ]);

        try {
            await expect(withImmediatePolling(() => ZhipuProvider.pollAsyncResult?.('task_fail', 'https://open.bigmodel.cn', 'sk-test') ?? Promise.reject(new Error('missing poller'))))
                .rejects.toThrow('Task failed');
        } finally {
            expect(restoreFetch()).toBe(1);
        }
    });
});
