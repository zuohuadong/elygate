import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { Elysia } from 'elysia';

const fetchCalls: Array<{ url: string; init: RequestInit }> = [];
let realtimeBaseUrl = 'https://upstream.example';

mock.module('@elygate/db', () => ({
    db: {
        update: () => ({
            set: () => ({
                where: async () => undefined,
            }),
        }),
    },
    sql: {},
}));

mock.module('../services/cache', () => ({
    memoryCache: {
        selectChannels: () => [{
            id: 1,
            name: 'realtime-openai',
            type: 1,
            baseUrl: realtimeBaseUrl,
            key: 'sk-upstream',
            headerOverride: { 'x-extra': '1' },
        }],
        getTokenFromCache: async () => ({ id: 2, userId: 1, status: 1, tokenGroup: 'default' }),
        getUserFromDB: async () => ({ id: 1, username: 'rt', group: 'default', quota: 1000, usedQuota: 0, status: 1 }),
    },
}));

mock.module('../services/optionCache', () => ({
    optionCache: {
        get: (_key: string, fallback: unknown) => fallback,
    },
}));

mock.module('../providers', () => ({
    getProviderHandler: () => ({
        buildHeaders: (key: string) => new Headers({ authorization: `Bearer ${key}` }),
    }),
}));

mock.module('../services/encryption', () => ({
    getChannelKeys: (value: string) => [value],
}));

mock.module('../services/logger', () => ({
    log: {
        info: mock(() => undefined),
        error: mock(() => undefined),
    },
}));

const { realtimeRouter } = await import('./realtime');

function app() {
    return new Elysia()
        .derive(() => ({
            user: { id: 1, username: 'rt', group: 'default', quota: 1000, usedQuota: 0, status: 1 },
            token: { id: 2, userId: 1, status: 1, tokenGroup: 'default' },
        }))
        .use(realtimeRouter);
}

describe('Realtime route compatibility', () => {
    beforeEach(() => {
        fetchCalls.length = 0;
        realtimeBaseUrl = 'https://upstream.example';
        globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
            fetchCalls.push({ url: String(url), init: init || {} });
            return new Response(JSON.stringify({ id: 'sess_123', object: 'realtime.session' }), { status: 201 });
        }) as unknown as typeof fetch;
    });

    test('returns an explicit upgrade error for non-WebSocket realtime GET requests', async () => {
        const response = await app().handle(new Request('http://localhost/realtime'));
        const body = await response.json() as Record<string, any>;

        expect(response.status).toBe(400);
        expect(body.error.type).toBe('invalid_request');
    });

    test('proxies realtime session creation with OpenAI beta header', async () => {
        const response = await app().handle(new Request('http://localhost/realtime/sessions', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ model: 'gpt-4o-realtime' }),
        }));

        expect(response.status).toBe(201);
        expect(await response.json()).toEqual({ id: 'sess_123', object: 'realtime.session' });
        expect(fetchCalls[0].url).toBe('https://upstream.example/v1/realtime/sessions');
        const headers = fetchCalls[0].init.headers as Headers;
        expect(headers.get('OpenAI-Beta')).toBe('realtime=v1');
        expect(headers.get('authorization')).toBe('Bearer sk-upstream');
        expect(headers.get('x-extra')).toBe('1');
    });

    test('proxies realtime WebSocket messages through an upstream session', async () => {
        const upstreamRequests: Array<{ readonly path: string; readonly authorization: string | null; readonly beta: string | null; readonly extra: string | null }> = [];
        const upstreamMessages: string[] = [];

        const upstream = Bun.serve<{ readonly headers: Headers }>({
            port: 0,
            fetch(request, server) {
                const url = new URL(request.url);
                if (url.pathname === '/v1/realtime' && server.upgrade(request, { data: { headers: request.headers } })) {
                    upstreamRequests.push({
                        path: `${url.pathname}?${url.searchParams.toString()}`,
                        authorization: request.headers.get('authorization'),
                        beta: request.headers.get('OpenAI-Beta'),
                        extra: request.headers.get('x-extra'),
                    });
                    return undefined;
                }
                return new Response('not found', { status: 404 });
            },
            websocket: {
                open(ws) {
                    ws.send(JSON.stringify({ type: 'session.created', smoke: true }));
                },
                message(ws, message) {
                    upstreamMessages.push(typeof message === 'string' ? message : message.toString());
                    ws.send(JSON.stringify({ type: 'response.text.delta', delta: 'pong' }));
                    ws.close(1000, 'smoke complete');
                },
            },
        });

        const gateway = app().listen(0);
        realtimeBaseUrl = `http://127.0.0.1:${upstream.port}`;

        try {
            const messages: string[] = [];
            await new Promise<void>((resolve, reject) => {
                const timeout = setTimeout(() => reject(new Error([
                    'timed out waiting for realtime websocket smoke',
                    `upstreamRequests=${JSON.stringify(upstreamRequests)}`,
                    `upstreamMessages=${JSON.stringify(upstreamMessages)}`,
                    `clientMessages=${JSON.stringify(messages)}`,
                ].join('\n'))), 2_000);
                const ws = new WebSocket(`ws://127.0.0.1:${gateway.server?.port}/realtime?model=gpt-4o-realtime&key=sk-test`);

                ws.onopen = () => {
                    setTimeout(() => ws.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: 'AA==' })), 25);
                };
                ws.onmessage = (event) => {
                    messages.push(String(event.data));
                    if (messages.some((message) => message.includes('response.text.delta'))) {
                        clearTimeout(timeout);
                        ws.close();
                        resolve();
                    }
                };
                ws.onerror = () => {
                    clearTimeout(timeout);
                    reject(new Error('gateway realtime websocket errored'));
                };
                ws.onclose = (event) => {
                    if (!messages.some((message) => message.includes('response.text.delta'))) {
                        clearTimeout(timeout);
                        reject(new Error(`gateway realtime websocket closed before upstream response: ${event.code} ${event.reason}`));
                    }
                };
            });

            expect(upstreamRequests).toEqual([{
                path: '/v1/realtime?model=gpt-4o-realtime',
                authorization: 'Bearer sk-upstream',
                beta: 'realtime=v1',
                extra: '1',
            }]);
            expect(upstreamMessages).toEqual([JSON.stringify({ type: 'input_audio_buffer.append', audio: 'AA==' })]);
            expect(messages.some((message) => message.includes('session.created'))).toBe(true);
        } finally {
            gateway.server?.stop(true);
            upstream.stop(true);
        }
    });
});
