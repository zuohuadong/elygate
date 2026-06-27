import { Elysia } from 'elysia';
import { db, sql as rawSql } from '@elygate/db';
import { tokens, users } from '@elygate/db/schema';
import { eq } from 'drizzle-orm';
import { applyTaskCallback, createTask } from '../services/task-service';
import { tasksRouter } from './tasks';

type AppHandle = {
    handle(request: Request): Response | Promise<Response>;
};

function sanitizeError(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    return message.replace(/postgres(?:ql)?:\/\/[^@\s]+@/gi, 'postgresql://<redacted>@');
}

async function hasBaseSchema(): Promise<boolean> {
    const rows = await rawSql.unsafe("SELECT to_regclass('public.tasks')::text AS table_name");
    return Boolean(rows[0]?.table_name);
}

async function bootstrapFreshDatabaseIfNeeded(): Promise<void> {
    if (await hasBaseSchema()) return;

    const initSqlPath = new URL('../../../../packages/db/src/init.sql', import.meta.url);
    const initSql = await Bun.file(initSqlPath).text();
    console.log('[task-route-db-smoke] base schema missing; applying packages/db/src/init.sql');
    await rawSql.unsafe(initSql);
}

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

async function jsonRequest(app: AppHandle, path: string, method = 'GET'): Promise<Record<string, unknown>> {
    const response = await app.handle(new Request(`http://localhost${path}`, {
        method,
        headers: { 'content-type': 'application/json', 'user-agent': 'task-route-db-smoke' },
    }));
    const payload = await response.json() as Record<string, unknown>;
    if (!response.ok) {
        throw new Error(`${path} returned ${response.status}: ${JSON.stringify(payload)}`);
    }
    return payload;
}

async function main(): Promise<void> {
    await bootstrapFreshDatabaseIfNeeded();
    await import('../../../../packages/db/src/migrate');

    const suffix = Date.now().toString(36);
    const username = `task_route_smoke_${suffix}`;
    const tokenKey = `sk-task-route-smoke-${suffix}`;

    const [user] = await db.insert(users).values({
        username,
        passwordHash: 'task-route-smoke',
        role: 1,
        quota: 1000000,
    }).returning({ id: users.id });
    assert(user?.id, 'failed to create task smoke user');

    const [token] = await db.insert(tokens).values({
        userId: user.id,
        name: 'task-route-smoke',
        key: tokenKey,
        remainQuota: 1000000,
    }).returning({ id: tokens.id });
    assert(token?.id, 'failed to create task smoke token');

    const app = new Elysia()
        .derive(() => ({
            user: { id: user.id, username, group: 'default', role: 1, quota: 1000000, usedQuota: 0, status: 1 },
            token: { id: token.id, userId: user.id, name: 'task-route-token', key: tokenKey, status: 1, remainQuota: 1000000, usedQuota: 0, models: [] },
        }))
        .use(tasksRouter);

    const taskIds: string[] = [];
    try {
        const taskId = await createTask({
            userId: user.id,
            tokenId: token.id,
            model: 'kling-v2-master',
            type: 'video',
            requestBody: { prompt: 'route smoke' },
        });
        taskIds.push(taskId);

        const task = await jsonRequest(app, `/tasks/${taskId}`);
        assert(task.id === taskId, 'task query did not return created id');
        assert(task.status === 'pending', 'task query did not read pending status from tasks');

        const cancelled = await jsonRequest(app, `/tasks/${taskId}/cancel`, 'POST');
        assert(cancelled.status === 'cancelled', 'task cancel did not return cancelled status');
        assert(cancelled.cancelled === true, 'task cancel did not report cancellation');

        const stored = await rawSql.unsafe(`SELECT status FROM tasks WHERE id = $1`, [taskId]);
        assert(stored[0]?.status === 'cancelled', 'task cancel did not persist cancelled status');

        const completedTaskId = await createTask({
            userId: user.id,
            tokenId: token.id,
            model: 'cogvideox-3',
            type: 'video',
            requestBody: { prompt: 'callback complete' },
        });
        taskIds.push(completedTaskId);
        const providerTaskId = `provider-task-${suffix}`;
        await rawSql.unsafe(`UPDATE tasks SET provider_task_id = $1 WHERE id = $2`, [providerTaskId, completedTaskId]);
        const completed = await applyTaskCallback({
            providerTaskId,
            status: 'completed',
            result: { videos: [{ url: 'https://media.example.test/video.mp4' }] },
        });
        assert(completed?.status === 'completed', 'task callback did not mark task completed');
        const completedRoute = await jsonRequest(app, `/tasks/${completedTaskId}`);
        assert(completedRoute.status === 'completed', 'task route did not expose callback completed status');
        assert((completedRoute.result as Record<string, unknown> | undefined)?.videos, 'task route did not expose callback result');

        const failedTaskId = await createTask({
            userId: user.id,
            tokenId: token.id,
            model: 'kling-v2-master',
            type: 'image',
            requestBody: { prompt: 'callback fail' },
        });
        taskIds.push(failedTaskId);
        const failed = await applyTaskCallback({
            taskId: failedTaskId,
            userId: user.id,
            status: 'failed',
            error: 'provider rejected task',
        });
        assert(failed?.status === 'failed', 'task callback did not mark task failed');
        const failedRoute = await jsonRequest(app, `/tasks/${failedTaskId}`);
        assert(failedRoute.status === 'failed', 'task route did not expose callback failed status');
        assert((failedRoute.error as Record<string, unknown> | undefined)?.message === 'provider rejected task', 'task route did not expose callback error');

        console.log('[task-route-db-smoke] ok');
    } finally {
        for (const taskId of taskIds) {
            await rawSql.unsafe(`DELETE FROM tasks WHERE id = $1`, [taskId]).catch(() => undefined);
        }
        await db.delete(tokens).where(eq(tokens.id, token.id)).catch(() => undefined);
        await db.delete(users).where(eq(users.id, user.id)).catch(() => undefined);
    }
}

try {
    await main();
    process.exit(0);
} catch (error) {
    console.error(`[task-route-db-smoke] failed: ${sanitizeError(error)}`);
    process.exit(1);
}
