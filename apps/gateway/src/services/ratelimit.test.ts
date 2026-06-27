import { describe, expect, mock, test } from 'bun:test';

mock.module('@elygate/db', () => ({
    db: {
        insert: () => {
            throw new Error('db unavailable');
        },
        select: () => {
            throw new Error('db unavailable');
        },
        update: () => {
            throw new Error('db unavailable');
        },
        delete: () => {
            throw new Error('db unavailable');
        },
    },
}));

const {
    blockRateLimit,
    consumeRateLimit,
    deleteRateLimitKey,
    getRateLimit,
    getRateLimitHeaders,
    rewardRateLimit,
} = await import('./ratelimit');

describe('PostgreSQL rate limit fallback semantics', () => {
    test('consumes fixed-window points locally when PostgreSQL is unavailable', async () => {
        const first = await consumeRateLimit({ key: 'rl:consume', limit: 2, windowMs: 1_000 });
        const second = await consumeRateLimit({ key: 'rl:consume', limit: 2, windowMs: 1_000, points: 2 });

        expect(first).toMatchObject({ allowed: true, consumedPoints: 1, remainingPoints: 1, store: 'local' });
        expect(second).toMatchObject({ allowed: false, consumedPoints: 3, remainingPoints: 0, blocked: true, store: 'local' });
        expect(getRateLimitHeaders(second)['Retry-After']).toBeDefined();
    });

    test('supports get, reward, block, and delete on fallback windows', async () => {
        await consumeRateLimit({ key: 'rl:state', limit: 5, windowMs: 1_000, points: 3 });

        expect(await getRateLimit('rl:state', 5)).toMatchObject({ consumedPoints: 3, remainingPoints: 2, store: 'local' });
        expect(await rewardRateLimit('rl:state', 2, 5)).toMatchObject({ consumedPoints: 1, remainingPoints: 4, store: 'local' });
        expect(await blockRateLimit('rl:state', 1_000, 5)).toMatchObject({ allowed: false, consumedPoints: 6, blocked: true, store: 'local' });
        expect(await deleteRateLimitKey('rl:state')).toBe(false);
        expect(await getRateLimit('rl:state', 5)).toBeNull();
    });
});
