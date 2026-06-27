import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { Elysia } from 'elysia';

const dispatchCalls: Array<Record<string, unknown>> = [];

mock.module('../services/dispatcher', () => ({
    dispatch: async (options: Record<string, unknown>) => {
        dispatchCalls.push(options);
        return { id: 'chatcmpl_test', choices: [], usage: { prompt_tokens: 1, completion_tokens: 1 } };
    },
}));

mock.module('../middleware/auth', () => ({
    assertModelAccess: () => undefined,
}));

mock.module('../services/responseCache', () => ({
    lookupResponseCache: async () => null,
    storeResponseCache: mock(() => Promise.resolve()),
}));

mock.module('../services/memory', () => ({
    buildMemorySystemMessage: async () => null,
    extractMemoryTextFromMessages: () => '',
    rememberAsync: mock(() => undefined),
    shouldReadMemory: () => false,
    shouldRememberContent: () => false,
    shouldWriteMemory: () => false,
}));

mock.module('../services/cache', () => ({
    memoryCache: {
        selectChannels: () => [],
    },
}));

mock.module('../services/optionCache', () => ({
    optionCache: {
        get: (_key: string, fallback: unknown) => fallback,
    },
}));

mock.module('../services/logger', () => ({
    log: {
        info: mock(() => undefined),
        warn: mock(() => undefined),
        error: mock(() => undefined),
    },
}));

const { chatRouter } = await import('./chat');

function app() {
    return new Elysia()
        .derive(() => ({
            user: { id: 1, username: 'chat-user', group: 'default', role: 1, quota: 1000, usedQuota: 0, status: 1 },
            token: { id: 2, userId: 1, name: 'chat-token', key: 'sk-chat', status: 1, remainQuota: 1000, usedQuota: 0, models: [] },
        }))
        .use(chatRouter);
}

describe('Chat completions route compatibility', () => {
    beforeEach(() => {
        dispatchCalls.length = 0;
    });

    test('passes OpenAI chat completion shape to dispatcher without semantic cache dependency', async () => {
        const requestBody = {
            model: 'gpt-4.1',
            messages: [{ role: 'user', content: 'hello' }],
            stream: false,
        };
        const response = await app().handle(new Request('http://localhost/chat/completions', {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'user-agent': 'test',
            },
            body: JSON.stringify(requestBody),
        }));

        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ id: 'chatcmpl_test' });
        expect(dispatchCalls[0]).toMatchObject({
            model: 'gpt-4.1',
            endpointType: 'chat',
            stream: false,
        });
        expect(dispatchCalls[0].body).toEqual(requestBody);
    });
});
