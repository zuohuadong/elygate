import { beforeEach, describe, expect, mock, test } from 'bun:test';

type ResponseCacheRow = {
    response: string | Record<string, unknown>;
};

type SelectPlan = {
    rows: ResponseCacheRow[];
};

type DbState = {
    enabled: boolean;
    ttlHours: number;
    selectPlans: SelectPlan[];
    updateCalls: number;
    insertValues: Array<Record<string, unknown>>;
    deleteReturn: Array<Record<string, unknown>>;
};

const state: DbState = {
    enabled: true,
    ttlHours: 24,
    selectPlans: [],
    updateCalls: 0,
    insertValues: [],
    deleteReturn: [],
};

const memoryCache = {
    stats: {
        responseCacheHits: 0,
        responseCacheMisses: 0,
    },
};

const db = {
    select: mock(() => ({
        from: () => ({
            where: () => ({
                limit: async () => state.selectPlans.shift()?.rows ?? [],
            }),
        }),
    })),
    update: mock(() => ({
        set: () => ({
            where: async () => {
                state.updateCalls += 1;
                return [];
            },
        }),
    })),
    insert: mock(() => ({
        values: (values: Record<string, unknown>) => {
            state.insertValues.push(values);
            return {
                onConflictDoUpdate: async () => undefined,
            };
        },
    })),
    delete: mock(() => ({
        where: () => ({
            returning: async () => state.deleteReturn,
        }),
    })),
};

mock.module('@elygate/db', () => ({
    db,
    sql: {},
}));

mock.module('./optionCache', () => ({
    optionCache: {
        get(key: string, fallback: unknown) {
            if (key === 'ResponseCacheEnabled') return state.enabled;
            if (key === 'ResponseCacheTTLHours') return state.ttlHours;
            return fallback;
        },
    },
}));

mock.module('./cache', () => ({
    memoryCache,
}));

mock.module('../services/logger', () => ({
    log: {
        info: mock(() => undefined),
        warn: mock(() => undefined),
        error: mock(() => undefined),
    },
}));

const {
    clearResponseCache,
    lookupResponseCache,
    storeResponseCache,
} = await import('./responseCache');

describe('response cache', () => {
    beforeEach(() => {
        state.enabled = true;
        state.ttlHours = 24;
        state.selectPlans = [];
        state.updateCalls = 0;
        state.insertValues = [];
        state.deleteReturn = [];
        memoryCache.stats.responseCacheHits = 0;
        memoryCache.stats.responseCacheMisses = 0;
    });

    test('returns null without touching storage when exact cache is disabled', async () => {
        state.enabled = false;

        const hit = await lookupResponseCache('gpt-4.1', [[{ role: 'user', content: 'hello' }]], 7);

        expect(hit).toBeNull();
        expect(db.select).not.toHaveBeenCalled();
        expect(memoryCache.stats.responseCacheHits).toBe(0);
        expect(memoryCache.stats.responseCacheMisses).toBe(0);
    });

    test('records exact cache hits and refreshes last read timestamp', async () => {
        state.selectPlans.push({
            rows: [{ response: '{"id":"chatcmpl_cache","choices":[]}' }],
        });

        const hit = await lookupResponseCache('gpt-4.1', [[{ role: 'user', content: 'hello' }]], 7);

        expect(hit).toEqual({ id: 'chatcmpl_cache', choices: [] });
        expect(memoryCache.stats.responseCacheHits).toBe(1);
        expect(memoryCache.stats.responseCacheMisses).toBe(0);
        expect(state.updateCalls).toBe(1);
    });

    test('records exact cache misses', async () => {
        state.selectPlans.push({ rows: [] });

        const hit = await lookupResponseCache('gpt-4.1', [[{ role: 'user', content: 'hello' }]], 7);

        expect(hit).toBeNull();
        expect(memoryCache.stats.responseCacheHits).toBe(0);
        expect(memoryCache.stats.responseCacheMisses).toBe(1);
        expect(state.updateCalls).toBe(0);
    });

    test('stores non-stream response cache rows with configured ttl', async () => {
        state.ttlHours = 2;
        const before = Date.now();

        await storeResponseCache(
            'gpt-4.1',
            [[{ role: 'user', content: 'hello' }]],
            { id: 'chatcmpl_store' },
            { prompt_tokens: 5 },
            7,
        );

        const stored = state.insertValues[0];
        expect(stored.modelName).toBe('gpt-4.1');
        expect(stored.response).toEqual({ id: 'chatcmpl_store' });
        expect(stored.usage).toEqual({ prompt_tokens: 5 });
        expect(stored.createdBy).toBe(7);
        expect(stored.expiredAt).toBeInstanceOf(Date);
        expect((stored.expiredAt as Date).getTime()).toBeGreaterThanOrEqual(before + 2 * 60 * 60 * 1_000);
    });

    test('skips storage when exact cache is disabled', async () => {
        state.enabled = false;

        await storeResponseCache(
            'gpt-4.1',
            [[{ role: 'user', content: 'hello' }]],
            { id: 'chatcmpl_skip' },
            {},
            7,
        );

        expect(state.insertValues).toHaveLength(0);
    });

    test('clears old response cache rows and returns affected count', async () => {
        state.deleteReturn = [{ hash: 'a' }, { hash: 'b' }];

        const deleted = await clearResponseCache(12);

        expect(deleted).toBe(2);
    });
});
