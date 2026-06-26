import {
    run,
    startPostgres,
    stopPostgres,
} from './enterprise-smoke-postgres';

function smokeEnv(databaseUrl: string): Record<string, string> {
    return {
        DATABASE_URL: databaseUrl,
        JWT_SECRET: 'enterprise-db-smoke-jwt-secret',
        ENCRYPTION_SECRET: 'enterprise-db-smoke-encryption-secret',
        ENCRYPTION_SALT: 'enterprise-db-smoke-salt',
        ELYGATE_LAYER: 'enterprise',
        ENTERPRISE_AUTH_MODE: 'dev',
        PG_BOSS_SCHEMA: 'pgboss_enterprise_db_smoke',
        PG_BOSS_APP_NAME: 'elygate-enterprise-db-smoke',
    };
}

async function main(): Promise<void> {
    const postgres = await startPostgres();
    console.log(`[enterprise-db-smoke-wrapper] started temp PostgreSQL on ${postgres.port}`);
    try {
        await run('bun', ['--cwd', 'apps/gateway', 'src/enterprise/dbSmoke.ts'], { env: smokeEnv(postgres.databaseUrl) });
        console.log('[enterprise-db-smoke-wrapper] ok');
    } finally {
        await stopPostgres(postgres.dir);
    }
}

try {
    await main();
} catch (error) {
    console.error(`[enterprise-db-smoke-wrapper] failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
}
