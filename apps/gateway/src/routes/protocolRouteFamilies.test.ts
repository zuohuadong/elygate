import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { Elysia } from 'elysia';

const dispatchCalls: Array<Record<string, unknown>> = [];

mock.module('../services/dispatcher', () => ({
    dispatch: async (options: Record<string, unknown>) => {
        dispatchCalls.push(options);
        return { ok: true, endpointType: options.endpointType };
    },
}));

mock.module('../services/cache', () => ({
    memoryCache: {
        getTokenFromCache: async () => ({
            id: 2,
            userId: 1,
            name: 'protocol-token',
            key: 'sk-protocol',
            status: 1,
            remainQuota: 1000,
            usedQuota: 0,
            models: [],
        }),
        getUserFromDB: async () => ({
            id: 1,
            username: 'protocol-user',
            group: 'default',
            role: 1,
            quota: 1000,
            usedQuota: 0,
            status: 1,
        }),
    },
}));

mock.module('../services/converters', () => ({
    getConverter: () => ({
        convertRequest: (body: unknown) => body,
        convertResponse: (body: unknown) => body,
        convertError: (error: unknown) => ({ error: String(error) }),
    }),
}));

mock.module('../middleware/auth', () => ({
    assertModelAccess: () => undefined,
}));

mock.module('../services/logger', () => ({
    log: {
        info: mock(() => undefined),
        warn: mock(() => undefined),
        error: mock(() => undefined),
    },
}));

const { audioRouter } = await import('./audio');
const { embeddingsRouter } = await import('./embeddings');
const { rerankRouter } = await import('./rerank');

function audioApp() {
    return new Elysia().use(audioRouter);
}

function embeddingsApp() {
    return new Elysia().use(embeddingsRouter);
}

function rerankApp() {
    return new Elysia()
        .derive(() => ({
            user: { id: 1, username: 'protocol-user', group: 'default', role: 1, quota: 1000, usedQuota: 0, status: 1 },
            token: { id: 2, userId: 1, name: 'protocol-token', key: 'sk-protocol', status: 1, remainQuota: 1000, usedQuota: 0, models: [] },
        }))
        .use(rerankRouter);
}

describe('protocol route family compatibility', () => {
    beforeEach(() => {
        dispatchCalls.length = 0;
    });

    test('routes audio speech requests to the audio dispatcher family', async () => {
        const response = await audioApp().handle(new Request('http://localhost/audio/speech', {
            method: 'POST',
            headers: {
                authorization: 'Bearer sk-protocol',
                'content-type': 'application/json',
                'user-agent': 'test',
            },
            body: JSON.stringify({ model: 'tts-1', input: 'hello' }),
        }));

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ ok: true, endpointType: 'audio/speech' });
        expect(dispatchCalls[0]).toMatchObject({
            model: 'tts-1',
            endpointType: 'audio/speech',
            stream: false,
        });
    });

    test('routes embeddings requests to the embeddings dispatcher family', async () => {
        const response = await embeddingsApp().handle(new Request('http://localhost/embeddings', {
            method: 'POST',
            headers: {
                authorization: 'Bearer sk-protocol',
                'content-type': 'application/json',
                'user-agent': 'test',
            },
            body: JSON.stringify({ model: 'text-embedding-3-small', input: ['a', 'b'] }),
        }));

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ ok: true, endpointType: 'embeddings' });
        expect(dispatchCalls[0]).toMatchObject({
            model: 'text-embedding-3-small',
            endpointType: 'embeddings',
            stream: false,
        });
    });

    test('routes rerank requests through the shared proxy route without cache conversion', async () => {
        const response = await rerankApp().handle(new Request('http://localhost/rerank', {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'user-agent': 'test',
            },
            body: JSON.stringify({ model: 'bge-reranker', query: 'q', documents: ['a', 'b'] }),
        }));

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ ok: true, endpointType: 'rerank' });
        expect(dispatchCalls[0]).toMatchObject({
            model: 'bge-reranker',
            endpointType: 'rerank',
            skipTransform: false,
        });
    });
});
