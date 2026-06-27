import {
    run,
    startPostgres,
    stopPostgres,
} from './enterprise-smoke-postgres';

function smokeEnv(databaseUrl: string): Record<string, string> {
    return {
        DATABASE_URL: databaseUrl,
        JWT_SECRET: 'new-api-protocol-db-smoke-jwt-secret',
        ENCRYPTION_SECRET: 'new-api-protocol-db-smoke-encryption-secret',
        ENCRYPTION_SALT: 'new-api-protocol-db-smoke-salt',
        PG_BOSS_SCHEMA: 'pgboss_new_api_protocol_db_smoke',
        PG_BOSS_APP_NAME: 'elygate-new-api-protocol-db-smoke',
        GATEWAY_URL: 'http://127.0.0.1:9',
    };
}

async function main(): Promise<void> {
    const postgres = await startPostgres();
    console.log(`[new-api-protocol-db-smoke-wrapper] started temp PostgreSQL on ${postgres.port}`);
    try {
        await run('bun', ['--cwd', 'apps/gateway', 'src/routes/protocolDbSmoke.ts'], { env: smokeEnv(postgres.databaseUrl) });
        console.log('[new-api-protocol-db-smoke-wrapper] ok');
    } finally {
        await stopPostgres(postgres.dir);
    }
}

try {
    await main();
} catch (error) {
    console.error(`[new-api-protocol-db-smoke-wrapper] failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
}
