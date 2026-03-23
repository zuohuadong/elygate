import { sql } from '@elygate/db';
import { log } from './logger';
import { memoryCache } from './cache';
import { dispatch } from './dispatcher';
import type { UserRecord, TokenRecord } from '../types';

/**
 * Async Task Service — manages async generation tasks (video, etc.)
 * 
 * Architecture (referencing New-API TaskAdaptor pattern):
 *   1. HTTP request → create task in DB → return taskId immediately
 *   2. Background worker picks up pending tasks → submits to provider → polls for result
 *   3. On completion → UPDATE task → pg_notify('task_complete', taskId)
 *   4. Client polls GET /v1/tasks/:id or receives notification
 * 
 * Uses PostgreSQL LISTEN/NOTIFY for event-driven processing:
 *   - LISTEN task_created → worker immediately starts processing
 *   - Fallback: periodic scan for stuck 'pending' tasks (belt + suspenders)
 */

export interface TaskRecord {
    id: string;
    userId: number;
    tokenId: number;
    channelId?: number;
    model: string;
    type: string;
    status: 'pending' | 'processing' | 'completed' | 'failed';
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

// ── Task CRUD ──────────────────────────────────────────────────

export async function createTask(opts: {
    userId: number;
    tokenId: number;
    model: string;
    type: string;
    requestBody: Record<string, any>;
}): Promise<string> {
    const id = generateTaskId();
    await sql`
        INSERT INTO tasks (id, user_id, token_id, model, type, status, request_body)
        VALUES (${id}, ${opts.userId}, ${opts.tokenId}, ${opts.model}, ${opts.type}, 'pending', ${JSON.stringify(opts.requestBody)})
    `;
    // Notify background worker
    await sql`SELECT pg_notify('task_created', ${id})`;
    log.info(`[Task] Created task ${id} for model ${opts.model}`);
    return id;
}

export async function getTask(taskId: string, userId?: number): Promise<TaskRecord | null> {
    const rows = userId
        ? await sql`
            SELECT id, user_id AS "userId", token_id AS "tokenId", channel_id AS "channelId",
                   model, type, status, provider_task_id AS "providerTaskId",
                   request_body AS "requestBody", result, error, progress,
                   created_at AS "createdAt", updated_at AS "updatedAt"
            FROM tasks WHERE id = ${taskId} AND user_id = ${userId}
          `
        : await sql`
            SELECT id, user_id AS "userId", token_id AS "tokenId", channel_id AS "channelId",
                   model, type, status, provider_task_id AS "providerTaskId",
                   request_body AS "requestBody", result, error, progress,
                   created_at AS "createdAt", updated_at AS "updatedAt"
            FROM tasks WHERE id = ${taskId}
          `;
    return (rows[0] as TaskRecord) || null;
}

async function updateTask(taskId: string, updates: Partial<Pick<TaskRecord, 'status' | 'providerTaskId' | 'channelId' | 'result' | 'error' | 'progress'>>) {
    const parts: string[] = ['updated_at = NOW()'];
    if (updates.status) parts.push(`status = '${updates.status}'`);
    if (updates.providerTaskId) parts.push(`provider_task_id = '${updates.providerTaskId}'`);
    if (updates.channelId) parts.push(`channel_id = ${updates.channelId}`);
    if (updates.result) parts.push(`result = '${JSON.stringify(updates.result)}'::jsonb`);
    if (updates.error) parts.push(`error = '${updates.error.replace(/'/g, "''")}'`);
    if (updates.progress !== undefined) parts.push(`progress = ${updates.progress}`);

    await sql.unsafe(`UPDATE tasks SET ${parts.join(', ')} WHERE id = '${taskId}'`);

    // Notify on completion/failure
    if (updates.status === 'completed' || updates.status === 'failed') {
        await sql`SELECT pg_notify('task_complete', ${taskId})`;
    }
}

// ── Background Task Worker ────────────────────────────────────

async function processTask(task: TaskRecord) {
    log.info(`[TaskWorker] Processing task ${task.id} (model: ${task.model})`);

    await updateTask(task.id, { status: 'processing', progress: 0 });

    try {
        // Find user and token from cache
        const user = memoryCache.users.get(task.userId);
        const token = Array.from(memoryCache.tokens.values()).find(t => t.id === task.tokenId);

        if (!user || !token) {
            throw new Error(`User or token not found for task ${task.id}`);
        }

        // Dispatch to provider (this includes the sync polling internally)
        const result = await dispatch({
            model: task.model,
            body: task.requestBody || {},
            user: user as UserRecord,
            token: token as TokenRecord,
            endpointType: 'video',
            skipTransform: false,
        });

        // Store result
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

/** Process a single task by ID (triggered by LISTEN) */
async function processTaskById(taskId: string) {
    const task = await getTask(taskId);
    if (!task || task.status !== 'pending') return;
    await processTask(task);
}

/** Scan for stuck pending tasks (fallback, every 30s) */
async function scanPendingTasks() {
    try {
        const stuckTasks = await sql`
            SELECT id FROM tasks 
            WHERE status = 'pending' 
            AND created_at < NOW() - INTERVAL '10 seconds'
            ORDER BY created_at ASC
            LIMIT 5
        `;
        for (const row of stuckTasks) {
            await processTaskById(row.id);
        }
    } catch (err: any) {
        log.error(`[TaskWorker] Scan error: ${err.message}`);
    }
}

// ── Worker Startup (LISTEN/NOTIFY via @elygate/pg-listen) ────

let workerStarted = false;

export async function startTaskWorker() {
    if (workerStarted) return;
    workerStarted = true;

    log.info('[TaskWorker] Starting background task worker...');

    // Use @elygate/pg-listen (Bun.connect TCP, zero-dependency)
    try {
        const { createPgListener } = await import('@elygate/pg-listen');
        const databaseUrl = process.env.DATABASE_URL;
        if (!databaseUrl) {
            throw new Error('DATABASE_URL not set');
        }

        createPgListener(databaseUrl, ['task_created'], (_channel, payload) => {
            log.info(`[TaskWorker] LISTEN: received task_created → ${payload}`);
            processTaskById(payload).catch(err => {
                log.error(`[TaskWorker] Error processing task ${payload}: ${err.message}`);
            });
        });
        log.info('[TaskWorker] LISTEN task_created registered via pg-listen (Bun TCP)');
    } catch (err: any) {
        log.error(`[TaskWorker] Failed to set up LISTEN: ${err.message}, falling back to scan-only`);
    }

    // Fallback: periodic scan every 30s for stuck tasks (belt + suspenders)
    setInterval(scanPendingTasks, 30_000);

    // Initial scan
    await scanPendingTasks();
    log.info('[TaskWorker] Worker started (LISTEN + fallback scan 30s)');
}
