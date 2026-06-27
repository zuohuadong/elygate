import {
    run,
    startPostgres,
    stopPostgres,
} from './enterprise-smoke-postgres';

function smokeEnv(databaseUrl: string): Record<string, string> {
    return {
        DATABASE_URL: databaseUrl,
        JWT_SECRET: 'openai-enterprise-route-db-smoke-jwt-secret',
        ENCRYPTION_SECRET: 'openai-enterprise-route-db-smoke-encryption-secret',
        ENCRYPTION_SALT: 'openai-enterprise-route-db-smoke-salt',
        ELYGATE_LAYER: 'enterprise',
        ENTERPRISE_AUTH_MODE: 'dev',
        PG_BOSS_SCHEMA: 'pgboss_openai_enterprise_route_db_smoke',
        PG_BOSS_APP_NAME: 'elygate-openai-enterprise-route-db-smoke',
    };
}

async function main(): Promise<void> {
    const postgres = await startPostgres();
    console.log(`[openai-enterprise-route-db-smoke-wrapper] started temp PostgreSQL on ${postgres.port}`);
    try {
        await run('bun', ['--cwd', 'apps/gateway', 'src/routes/openaiEnterpriseRouteDbSmoke.ts'], { env: smokeEnv(postgres.databaseUrl) });
        console.log('[openai-enterprise-route-db-smoke-wrapper] ok');
    } finally {
        await stopPostgres(postgres.dir);
    }
}

try {
    await main();
} catch (error) {
    console.error(`[openai-enterprise-route-db-smoke-wrapper] failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
}
