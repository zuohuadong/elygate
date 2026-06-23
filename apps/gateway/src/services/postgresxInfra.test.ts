import { describe, expect, test } from 'bun:test';
import type { BunSqlAdapterInput } from '@postgresx/noredis/adapters/bun';
import {
    createElygatePostgresxClient,
    smokeElygatePostgresxClient,
} from './postgresxInfra';

function createFakeSql(): BunSqlAdapterInput & { queries: string[] } {
    const queries: string[] = [];
    return {
        queries,
        async unsafe<T = Record<string, unknown>>(query: string): Promise<T[]> {
            queries.push(query);
            return [];
        },
    };
}

describe('postgresx infrastructure bridge', () => {
    test('creates a pgredis client with Elygate defaults and runs smoke health', async () => {
        const sql = createFakeSql();
        const client = createElygatePostgresxClient({ sql });

        const result = await smokeElygatePostgresxClient(client);

        expect(result).toEqual({
            ok: true,
            namespace: 'elygate',
            tablePrefix: 'elygate_px',
            cacheTable: 'elygate_px_kv',
            l1Max: 10_000,
        });
        expect(sql.queries).toEqual(['SELECT 1']);
    });

    test('allows isolated namespaces and smaller L1 settings for pilots', async () => {
        const sql = createFakeSql();
        const client = createElygatePostgresxClient({
            sql,
            namespace: 'pilot',
            tablePrefix: 'pilot_px',
            cacheL1: { max: 32, ttlMs: 500 },
        });

        const result = await smokeElygatePostgresxClient(client);

        expect(result.namespace).toBe('pilot');
        expect(result.tablePrefix).toBe('pilot_px');
        expect(result.cacheTable).toBe('pilot_px_kv');
        expect(result.l1Max).toBe(32);
    });
});
