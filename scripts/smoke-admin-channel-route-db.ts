import {
    run,
    startPostgres,
    stopPostgres,
} from './enterprise-smoke-postgres';

function smokeEnv(databaseUrl: string): Record<string, string> {
    return {
        DATABASE_URL: databaseUrl,
        JWT_SECRET: 'admin-channel-route-db-smoke-jwt-secret',
        ENCRYPTION_SECRET: 'admin-channel-route-db-smoke-encryption-secret',
        ENCRYPTION_SALT: 'admin-channel-route-db-smoke-salt',
        PG_BOSS_SCHEMA: 'pgboss_admin_channel_route_db_smoke',
        PG_BOSS_APP_NAME: 'elygate-admin-channel-route-db-smoke',
    };
}

async function main(): Promise<void> {
    const postgres = await startPostgres();
    console.log(`[admin-channel-route-db-smoke-wrapper] started temp PostgreSQL on ${postgres.port}`);
    try {
        await run('bun', ['--cwd', 'apps/gateway', 'src/routes/admin/channelRouteDbSmoke.ts'], { env: smokeEnv(postgres.databaseUrl) });
        console.log('[admin-channel-route-db-smoke-wrapper] ok');
    } finally {
        await stopPostgres(postgres.dir);
    }
}

try {
    await main();
} catch (error) {
    console.error(`[admin-channel-route-db-smoke-wrapper] failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
}
