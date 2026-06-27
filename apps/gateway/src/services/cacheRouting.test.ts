import { beforeEach, describe, expect, mock, test } from 'bun:test';

mock.module('@elygate/db', () => ({
    db: {},
    sql: {},
}));

mock.module('@elygate/pg-listen', () => ({
    createPgListener: () => undefined,
}));

const optionValues = new Map<string, unknown>();

mock.module('./optionCache', () => ({
    optionCache: {
        get(key: string, fallback: unknown) {
            return optionValues.has(key) ? optionValues.get(key) : fallback;
        },
    },
}));

mock.module('../services/logger', () => ({
    log: {
        info: mock(() => undefined),
        warn: mock(() => undefined),
        error: mock(() => undefined),
    },
}));

const { memoryCache } = await import('./cache');

describe('memory cache routing selection', () => {
    beforeEach(() => {
        optionValues.clear();
        memoryCache.channelRoutes = new Map();
    });

    test('filters channels by user group and sorts by priority then weight', () => {
        memoryCache.channelRoutes.set('gpt-4.1', [
            { id: 1, groups: ['vip'], priority: 1, weight: 100, status: 1 },
            { id: 2, groups: ['default'], priority: 2, weight: 1, status: 1 },
            { id: 3, groups: ['default'], priority: 2, weight: 10, status: 1 },
            { id: 4, groups: [], priority: 0, weight: 1000, status: 1 },
        ] as never);

        const selected = memoryCache.selectChannels('gpt-4.1', 'default').map((channel) => channel.id);

        expect(selected).toEqual([3, 2, 4]);
    });

    test('keeps half-open channels behind active channels within the same tier', () => {
        memoryCache.channelRoutes.set('gpt-4.1', [
            { id: 1, groups: ['default'], priority: 1, weight: 100, status: 4 },
            { id: 2, groups: ['default'], priority: 1, weight: 1, status: 1 },
        ] as never);

        const selected = memoryCache.selectChannels('gpt-4.1', 'default').map((channel) => channel.id);

        expect(selected).toEqual([2, 1]);
    });
});
