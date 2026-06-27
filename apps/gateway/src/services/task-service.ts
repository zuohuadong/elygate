import { db } from '@elygate/db';
import { sql as drizzleSql } from 'drizzle-orm';
import { log } from './logger';
import { memoryCache } from './cache';
import { dispatch } from './dispatcher';
import { enqueueLongTask } from './jobQueue';
import type { UserRecord, TokenRecord } from '../types';

export interface TaskRecord {
    id: string;
    userId: number;
    tokenId: number;
    channelId?: number;
    model: string;
    type: string;
    status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
    providerTaskId?: string;
    requestBody?: Record<string, any>;
    result?: Record<string, any>;
    error?: string;
    progress: number;
    createdAt: Date;
    updatedAt: Date;
}

function generateTaskId(): string {
    const ts = Date.now().toString(36);
    const rand = Math.random().toString(36).substring(2, 10);
    return `task_${ts}_${rand}`;
}

export async function createTask(opts: {
    userId: number;
    tokenId: number;
    model: string;
    type: string;
    requestBody: Record<string, any>;
}): Promise<string> {
    const id = generateTaskId();
    await db.execute(drizzleSql`
        INSERT INTO tasks (id, user_id, token_id, model, type, status, request_body)
        VALUES (${id}, ${opts.userId}, ${opts.tokenId}, ${opts.model}, ${opts.type}, 'pending', ${opts.requestBody})
    `);

    try {
        await enqueueLongTask(id);
    } catch (err: any) {
        log.error(`[Task] Created task ${id}, but failed to enqueue pg-boss job: ${err?.message || String(err)}`);
    }

    log.info(`[Task] Created task ${id} for model ${opts.model}`);
    return id;
}

export async function getTask(taskId: string, userId?: number): Promise<TaskRecord | null> {
    const rows = userId
        ? await db.execute(drizzleSql`
            SELECT id, user_id AS "userId", token_id AS "tokenId", channel_id AS "channelId",
                   model, type, status, provider_task_id AS "providerTaskId",
                   request_body AS "requestBody", result, error, progress,
                   created_at AS "createdAt", updated_at AS "updatedAt"
            FROM tasks WHERE id = ${taskId} AND user_id = ${userId}
          `) as any[]
        : await db.execute(drizzleSql`
            SELECT id, user_id AS "userId", token_id AS "tokenId", channel_id AS "channelId",
                   model, type, status, provider_task_id AS "providerTaskId",
                   request_body AS "requestBody", result, error, progress,
                   created_at AS "createdAt", updated_at AS "updatedAt"
            FROM tasks WHERE id = ${taskId}
          `) as any[];
    return (rows[0] as TaskRecord) || null;
}

async function updateTask(taskId: string, updates: Partial<Pick<TaskRecord, 'status' | 'providerTaskId' | 'channelId' | 'result' | 'error' | 'progress'>>) {
    await db.execute(drizzleSql`
        UPDATE tasks SET
            updated_at = NOW(),
            status = COALESCE(${updates.status || null}, status),
            provider_task_id = COALESCE(${updates.providerTaskId || null}, provider_task_id),
            channel_id = COALESCE(${updates.channelId || null}, channel_id),
            result = COALESCE(${updates.result || null}, result),
            error = COALESCE(${updates.error || null}, error),
            progress = COALESCE(${updates.progress !== undefined ? updates.progress : null}, progress)
        WHERE id = ${taskId}
    `);
}

export async function cancelTask(taskId: string, userId: number): Promise<TaskRecord | null> {
    const [row] = await db.execute(drizzleSql`
        UPDATE tasks
        SET status = 'cancelled',
            progress = CASE WHEN progress < 100 THEN progress ELSE 100 END,
            updated_at = NOW()
        WHERE id = ${taskId}
          AND user_id = ${userId}
          AND status IN ('pending', 'processing')
        RETURNING id, user_id AS "userId", token_id AS "tokenId", channel_id AS "channelId",
                  model, type, status, provider_task_id AS "providerTaskId",
                  request_body AS "requestBody", result, error, progress,
                  created_at AS "createdAt", updated_at AS "updatedAt"
    `) as any[];
    return (row as TaskRecord) || null;
}

function callbackStatus(status: string | undefined, hasResult: boolean): TaskRecord['status'] {
    const normalized = (status || '').toLowerCase();
    if (['cancelled', 'canceled'].includes(normalized)) return 'cancelled';
    if (['failed', 'fail', 'error'].includes(normalized)) return 'failed';
    if (['processing', 'running', 'pending', 'queued'].includes(normalized)) return 'processing';
    if (['completed', 'complete', 'success', 'succeeded'].includes(normalized) || hasResult) return 'completed';
    return 'processing';
}

export async function applyTaskCallback(input: {
    taskId?: string;
    providerTaskId?: string;
    userId?: number;
    status?: string;
    result?: Record<string, any>;
    error?: string;
    progress?: number;
}): Promise<TaskRecord | null> {
    if (!input.taskId && !input.providerTaskId) {
        throw new Error('taskId or providerTaskId is required');
    }

    const nextStatus = callbackStatus(input.status, Boolean(input.result));
    const nextProgress = input.progress ?? (nextStatus === 'completed' ? 100 : undefined);
    const [row] = await db.execute(drizzleSql`
        UPDATE tasks
        SET status = ${nextStatus},
            result = COALESCE(${input.result || null}, result),
            error = COALESCE(${input.error || null}, error),
            progress = COALESCE(${nextProgress ?? null}, progress),
            updated_at = NOW()
        WHERE (
            (${input.taskId || null}::text IS NOT NULL AND id = ${input.taskId || null})
            OR (${input.providerTaskId || null}::text IS NOT NULL AND provider_task_id = ${input.providerTaskId || null})
        )
        AND (${input.userId || null}::int IS NULL OR user_id = ${input.userId || null})
        RETURNING id, user_id AS "userId", token_id AS "tokenId", channel_id AS "channelId",
                  model, type, status, provider_task_id AS "providerTaskId",
                  request_body AS "requestBody", result, error, progress,
                  created_at AS "createdAt", updated_at AS "updatedAt"
    `) as any[];
    return (row as TaskRecord) || null;
}

async function processTask(task: TaskRecord) {
    log.info(`[TaskWorker] Processing task ${task.id} (model: ${task.model})`);

    await updateTask(task.id, { status: 'processing', progress: 0 });

    try {
        const user = await memoryCache.getUserFromDB(task.userId);

        let token = Array.from(memoryCache.tokens.values()).find(t => t.id === task.tokenId) || null;
        if (!token) {
            const [row] = await db.execute(drizzleSql`
                SELECT id, key, name, user_id AS "userId", models, status,
                       remain_quota AS "remainQuota", used_quota AS "usedQuota",
                       expired_at AS "expiredAt"
                FROM tokens WHERE id = ${task.tokenId} AND status = 1
            `) as any[];
            token = row as TokenRecord || null;
        }

        if (!user || !token) {
            throw new Error(`User (id=${task.userId}) or token (id=${task.tokenId}) not found in DB`);
        }

        let taskBody = task.requestBody || {};
        if (typeof taskBody === 'string') {
            try { taskBody = JSON.parse(taskBody); } catch { /* use as-is */ }
        }

        const result = await dispatch({
            model: task.model,
            body: taskBody,
            user: user as UserRecord,
            token: token as TokenRecord,
            endpointType: (task.type === 'image' ? 'images' : task.type) as 'video' | 'images',
            skipTransform: false,
        });

        const resultObj = typeof result === 'object' ? result : { data: result };
        await updateTask(task.id, {
            status: 'completed',
            result: resultObj as Record<string, any>,
            progress: 100,
        });
        log.info(`[TaskWorker] Task ${task.id} completed successfully`);

    } catch (err: any) {
        const errorMsg = err?.message || String(err);
        await updateTask(task.id, {
            status: 'failed',
            error: errorMsg,
        });
        log.error(`[TaskWorker] Task ${task.id} failed: ${errorMsg}`);
    }
}

export async function processTaskById(taskId: string) {
    const task = await getTask(taskId);
    if (!task || task.status !== 'pending') return;
    await processTask(task);
}

async function scanPendingTasks() {
    try {
        const stuckTasks = await db.execute(drizzleSql`
            SELECT id FROM tasks 
            WHERE status = 'pending' 
            AND created_at < NOW() - INTERVAL '10 seconds'
            ORDER BY created_at ASC
            LIMIT 5
        `) as any[];
        let enqueued = 0;
        for (const row of stuckTasks) {
            try {
                const jobId = await enqueueLongTask(row.id);
                if (jobId) enqueued++;
            } catch (err: any) {
                log.error(`[TaskWorker] Failed to enqueue pending task ${row.id}: ${err?.message || String(err)}`);
            }
        }
        if (enqueued > 0) {
            log.info(`[TaskWorker] Enqueued ${enqueued} pending tasks via pg-boss`);
        }
    } catch (err: any) {
        log.error(`[TaskWorker] Scan error: ${err.message}`);
    }
}

async function cleanupTasks() {
    try {
        const deleted = await db.execute(drizzleSql`
            DELETE FROM tasks
            WHERE (status = 'completed' AND created_at < NOW() - INTERVAL '30 days')
               OR (status = 'failed' AND created_at < NOW() - INTERVAL '7 days')
               OR (status = 'cancelled' AND created_at < NOW() - INTERVAL '7 days')
            RETURNING id
        `) as any[];

        const stuck = await db.execute(drizzleSql`
            UPDATE tasks SET status = 'failed', error = 'Timed out (stuck processing > 10min)', updated_at = NOW()
            WHERE status = 'processing'
            AND updated_at < NOW() - INTERVAL '10 minutes'
            RETURNING id
        `) as any[];

        if (deleted.length > 0 || stuck.length > 0) {
            log.info(`[TaskCleanup] Deleted ${deleted.length} old tasks, marked ${stuck.length} stuck tasks as failed`);
        }
    } catch (err: any) {
        log.error(`[TaskCleanup] Error: ${err.message}`);
    }
}

let workerStarted = false;

export async function startTaskWorker() {
    if (workerStarted) return;
    workerStarted = true;

    log.info('[TaskWorker] Starting background task worker...');

    setInterval(scanPendingTasks, 30_000);

    setInterval(cleanupTasks, 30 * 60 * 1000);
    await cleanupTasks();

    await scanPendingTasks();
    log.info('[TaskWorker] Maintenance started (pg-boss enqueue scan 30s + cleanup 30min)');
}
