import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { Elysia } from 'elysia';
import { ChannelType } from '../providers/types';

const dispatchCalls: Array<Record<string, unknown>> = [];

mock.module('../services/dispatcher', () => ({
    dispatch: async (options: Record<string, unknown>) => {
        dispatchCalls.push(options);
        return { ok: true, upstreamPath: options.upstreamPath ?? null };
    },
}));

mock.module('../services/cache', () => ({
    memoryCache: {
        selectChannels: () => [{ id: 1, type: ChannelType.OPENAI }],
    },
}));

mock.module('../middleware/auth', () => ({
    assertModelAccess: () => undefined,
}));

mock.module('../services/memory', () => ({
    buildMemorySystemMessage: async () => null,
    rememberAsync: () => undefined,
    shouldReadMemory: () => false,
    shouldRememberContent: () => false,
    shouldWriteMemory: () => false,
}));

mock.module('../services/logger', () => ({
    log: {
        info: mock(() => undefined),
        warn: mock(() => undefined),
        error: mock(() => undefined),
    },
}));

const { responsesRouter } = await import('./responses');

function app() {
    return new Elysia()
        .derive(() => ({
            user: { id: 1, username: 'route-test', group: 'default', role: 1, quota: 1000, usedQuota: 0, status: 1 },
            token: { id: 2, userId: 1, name: 'route-token', key: 'sk-route', status: 1, remainQuota: 1000, usedQuota: 0, models: [] },
        }))
        .use(responsesRouter);
}

describe('Responses route compatibility', () => {
    beforeEach(() => {
        dispatchCalls.length = 0;
    });

    test('routes /responses/compact to the explicit upstream compact path', async () => {
        const response = await app().handle(new Request('http://localhost/responses/compact', {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'user-agent': 'test' },
            body: JSON.stringify({ model: 'gpt-4.1', input: 'summarize' }),
        }));

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ ok: true, upstreamPath: '/responses/compact' });
        expect(dispatchCalls[0]).toMatchObject({
            model: 'gpt-4.1',
            endpointType: 'responses',
            stream: false,
            upstreamPath: '/responses/compact',
        });
    });

    test('encodes response id compact route before upstream dispatch', async () => {
        const response = await app().handle(new Request('http://localhost/responses/resp_abc%2Fdef/compact', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ model: 'gpt-4.1', input: 'compact previous' }),
        }));

        expect(response.status).toBe(200);
        expect(dispatchCalls[0].upstreamPath).toBe('/responses/resp_abc%2Fdef/compact');
    });
});
