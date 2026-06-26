import {
    createPgredis,
    type PgKvCacheL1Options,
    type PgredisClient,
} from '@postgresx/noredis';
import {
    createBunSqlAdapter,
    type BunSqlAdapterInput,
} from '@postgresx/noredis/adapters/bun';

const DEFAULT_NAMESPACE = 'elygate';
const DEFAULT_TABLE_PREFIX = 'elygate_px';
const DEFAULT_L1_OPTIONS = {
    max: 10_000,
    ttlMs: 60_000,
} as const satisfies PgKvCacheL1Options;

export interface ElygatePostgresxOptions {
    sql: BunSqlAdapterInput;
    namespace?: string;
    tablePrefix?: string;
    cacheL1?: false | PgKvCacheL1Options;
}

export interface ElygatePostgresxSmokeResult {
    ok: true;
    namespace: string;
    tablePrefix: string;
    cacheTable: string;
    l1Max: number;
}

export function createElygatePostgresxClient(options: ElygatePostgresxOptions): PgredisClient {
    const namespace = options.namespace ?? DEFAULT_NAMESPACE;
    const tablePrefix = options.tablePrefix ?? DEFAULT_TABLE_PREFIX;

    return createPgredis({
        sql: createBunSqlAdapter(options.sql),
        namespace,
        tablePrefix,
        cache: {
            l1: options.cacheL1 ?? DEFAULT_L1_OPTIONS,
        },
    });
}

function tablePrefixFromCacheTable(cacheTable: string): string {
    return cacheTable.endsWith('_kv') ? cacheTable.slice(0, -3) : cacheTable;
}

export async function smokeElygatePostgresxClient(
    client: PgredisClient,
): Promise<ElygatePostgresxSmokeResult> {
    await client.health();
    const stats = await client.stats();

    return {
        ok: true,
        namespace: stats.cache.namespace,
        tablePrefix: tablePrefixFromCacheTable(stats.cache.tableName),
        cacheTable: stats.cache.tableName,
        l1Max: stats.cache.l1Max,
    };
}
