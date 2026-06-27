import {
    run,
    startPostgres,
    stopPostgres,
} from './enterprise-smoke-postgres';

function smokeEnv(databaseUrl: string): Record<string, string> {
    return {
        DATABASE_URL: databaseUrl,
        JWT_SECRET: 'new-api-task-route-db-smoke-jwt-secret',
        ENCRYPTION_SECRET: 'new-api-task-route-db-smoke-encryption-secret',
        ENCRYPTION_SALT: 'new-api-task-route-db-smoke-salt',
        PG_BOSS_SCHEMA: 'pgboss_new_api_task_route_db_smoke',
        PG_BOSS_APP_NAME: 'elygate-new-api-task-route-db-smoke',
    };
}

async function main(): Promise<void> {
    const postgres = await startPostgres();
    console.log(`[new-api-task-route-db-smoke-wrapper] started temp PostgreSQL on ${postgres.port}`);
    try {
        await run('bun', ['--cwd', 'apps/gateway', 'src/routes/taskRouteDbSmoke.ts'], { env: smokeEnv(postgres.databaseUrl) });
        console.log('[new-api-task-route-db-smoke-wrapper] ok');
    } finally {
        await stopPostgres(postgres.dir);
    }
}

try {
    await main();
} catch (error) {
    console.error(`[new-api-task-route-db-smoke-wrapper] failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
}
