import { describe, expect, mock, test } from 'bun:test';

mock.module('@elygate/db', () => ({
    db: {},
    sql: {},
}));

mock.module('./cache', () => ({
    memoryCache: {
        userGroups: new Map(),
        selectChannels: () => [],
    },
}));

mock.module('./optionCache', () => ({
    optionCache: {
        get: (_key: string, fallback: unknown) => fallback,
    },
}));

mock.module('./logger', () => ({
    log: {
        info: mock(() => undefined),
        warn: mock(() => undefined),
        error: mock(() => undefined),
    },
}));

const {
    applyStatusCodeMapping,
    buildStreamingProxyResponse,
    isExactResponseCacheable,
    isRetryableError,
    selectNextRetryGroup,
} = await import('./dispatcher');

describe('dispatcher exact response cache policy', () => {
    test('allows exact cache only for non-streaming text-style requests', () => {
        expect(isExactResponseCacheable('chat', false, false)).toBe(true);
        expect(isExactResponseCacheable('embeddings', false, false)).toBe(true);
    });

    test('bypasses exact cache for streaming, form-data, and media/protocol endpoints', () => {
        expect(isExactResponseCacheable('chat', true, false)).toBe(false);
        expect(isExactResponseCacheable('chat', false, true)).toBe(false);
        expect(isExactResponseCacheable('images', false, false)).toBe(false);
        expect(isExactResponseCacheable('responses', false, false)).toBe(false);
        expect(isExactResponseCacheable('audio', false, false)).toBe(false);
    });

    test('maps upstream status codes before circuit breaker and log side effects', () => {
        expect(applyStatusCodeMapping(529, { 529: 429 })).toBe(429);
        expect(applyStatusCodeMapping(500, '{"500":503}')).toBe(503);
        expect(applyStatusCodeMapping(401, { 401: 401 })).toBe(401);
        expect(applyStatusCodeMapping(499, { 499: 'bad' })).toBe(499);
    });

    test('classifies retryable errors and selects the next auto retry group', () => {
        expect(isRetryableError(new Error('HTTP 429 Too Many Requests'))).toBe(true);
        expect(isRetryableError(new Error('Status 503: overloaded'))).toBe(true);
        expect(isRetryableError(new Error('HTTP 401 Unauthorized'))).toBe(false);
        expect(isRetryableError(new Error('Status 422: bad request'))).toBe(false);

        const tried = new Set(['default']);
        const next = selectNextRetryGroup(['default', 'vip', 'backup'], tried, 'gpt-4.1', (_model, group) => (
            group === 'backup' ? [{ id: 7, name: 'backup' } as never] : []
        ));

        expect(next?.group).toBe('backup');
        expect(next?.channels.map((channel) => channel.id)).toEqual([7]);
        expect(tried.has('backup')).toBe(true);
    });

    test('propagates upstream streaming status and SSE headers to clients', async () => {
        const source = new ReadableStream({
            start(controller) {
                controller.enqueue(new TextEncoder().encode('data: {"ok":true}\n\n'));
                controller.close();
            },
        });
        const response = buildStreamingProxyResponse(source, 202);

        expect(response.status).toBe(202);
        expect(response.headers.get('content-type')).toBe('text/event-stream');
        expect(response.headers.get('cache-control')).toBe('no-cache');
        expect(await response.text()).toBe('data: {"ok":true}\n\n');
    });
});
