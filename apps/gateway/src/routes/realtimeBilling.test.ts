import { describe, expect, mock, test } from 'bun:test';

mock.module('@elygate/db', () => ({
    db: {},
    sql: {},
}));

mock.module('../services/billing', () => ({
    billAndLog: async () => undefined,
}));

mock.module('../services/cache', () => ({
    memoryCache: {
        selectChannels: () => [],
        getTokenFromCache: async () => null,
        getUserFromDB: async () => null,
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

const { buildRealtimeBillingContext, estimateRealtimeUsage } = await import('./realtime');

describe('Realtime billing and audit helpers', () => {
    test('estimates streaming session usage from message count', () => {
        expect(estimateRealtimeUsage(0)).toEqual({ promptTokens: 0, completionTokens: 0 });
        expect(estimateRealtimeUsage(3)).toEqual({ promptTokens: 0, completionTokens: 150 });
        expect(estimateRealtimeUsage(-1)).toEqual({ promptTokens: 0, completionTokens: 0 });
    });

    test('builds a billAndLog context for realtime WebSocket session close', () => {
        const ctx = buildRealtimeBillingContext({
            user: { id: 11, username: 'u', group: 'vip', role: 1, quota: 1000, usedQuota: 0, status: 1, orgId: 9 },
            token: { id: 22, userId: 11, name: 't', key: 'sk', remainQuota: -1, usedQuota: 0, status: 1, expiredAt: null, models: [], subnet: '', rateLimit: 0 },
            channelId: 33,
            model: 'gpt-4o-realtime',
            group: 'vip',
            messageCount: 4,
            elapsedMs: 1234,
            statusCode: 1000,
        });

        expect(ctx).toMatchObject({
            userId: 11,
            tokenId: 22,
            channelId: 33,
            modelName: 'gpt-4o-realtime',
            promptTokens: 0,
            completionTokens: 200,
            userGroup: 'vip',
            isStream: true,
            statusCode: 1000,
            elapsedMs: 1234,
            orgId: 9,
            externalFeatureType: 'realtime',
        });
    });
});
