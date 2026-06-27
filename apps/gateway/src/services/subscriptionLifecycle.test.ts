import { describe, expect, mock, test } from 'bun:test';

mock.module('@elygate/db', () => ({
    db: {},
    sql: {},
}));

mock.module('../services/logger', () => ({
    log: {
        info: mock(() => undefined),
        warn: mock(() => undefined),
        error: mock(() => undefined),
    },
}));

const {
    calculateNextReset,
    countResetCycles,
    durationEndFromPackage,
    resolveResetPolicy,
} = await import('./subscription');

describe('subscription quota lifecycle helpers', () => {
    test('resolves New API style quota reset policies from explicit and legacy fields', () => {
        expect(resolveResetPolicy({ quotaResetPeriod: 'daily' } as never)).toEqual({ period: 'daily', interval: 1, customSeconds: 0 });
        expect(resolveResetPolicy({ quotaResetPeriod: 'custom', cycleInterval: 3, quotaResetCustomSeconds: 900 } as never)).toEqual({
            period: 'custom',
            interval: 3,
            customSeconds: 900,
        });
        expect(resolveResetPolicy({ cycleUnit: 'hour', cycleInterval: 2 } as never)).toEqual({
            period: 'custom',
            interval: 1,
            customSeconds: 7200,
        });
    });

    test('calculates duration end and caps quota reset at subscription end', () => {
        const now = new Date('2026-06-27T10:00:00.000Z');
        expect(durationEndFromPackage({ durationUnit: 'custom', customSeconds: 3600, durationDays: 30 } as never, now).toISOString())
            .toBe('2026-06-27T11:00:00.000Z');

        const endTime = new Date('2026-06-28T00:30:00.000Z');
        expect(calculateNextReset(now, { quotaResetPeriod: 'daily' } as never, endTime)?.toISOString())
            .toBe('2026-06-28T00:00:00.000Z');
        expect(calculateNextReset(now, { quotaResetPeriod: 'weekly' } as never, endTime)).toBeNull();
    });

    test('counts elapsed reset cycles for custom quota refills', () => {
        const lastResetAt = new Date('2026-06-27T00:00:00.000Z');
        const now = new Date('2026-06-27T00:35:00.000Z');
        expect(countResetCycles(lastResetAt, now, {
            quotaResetPeriod: 'custom',
            quotaResetCustomSeconds: 600,
        } as never)).toBe(3);
    });
});
