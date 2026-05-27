import type { ElysiaCtx } from '../types';
import { Elysia } from 'elysia';
import { log } from '../services/logger';
import { assertModelAccess } from '../middleware/auth';
import { createTask, getTask } from '../services/task-service';
import type { UserRecord, TokenRecord } from '../types';

/**
 * /v1/video/generations — async video generation endpoint.
 * 
 * Instead of holding the HTTP connection for 2-10 minutes while polling
 * the provider, this immediately creates a task and returns a taskId.
 * The background worker (task-service) handles provider submission + polling.
 * 
 * Client flow:
 *   POST /v1/video/generations → { id: "task_...", status: "pending" }
 *   GET  /v1/tasks/task_...    → { status: "processing", progress: 50 }
 *   GET  /v1/tasks/task_...    → { status: "completed", result: {...} }
 */
export const videoRouter = new Elysia()
    .post('/video/generations', async (ctx: ElysiaCtx) => {
        return await createVideoTaskResponse(ctx);
    })
    .get('/video/generations/:taskId', async (ctx: ElysiaCtx) => {
        return await getVideoTaskResponse(ctx);
    })
    .post('/videos', async (ctx: ElysiaCtx) => {
        return await createVideoTaskResponse(ctx);
    })
    .get('/videos/:taskId', async (ctx: ElysiaCtx) => {
        return await getVideoTaskResponse(ctx);
    })
    .post('/videos/:videoId/remix', async (ctx: ElysiaCtx) => {
        return await createVideoTaskResponse(ctx, { sourceVideoId: ctx.params?.videoId, action: 'remix' });
    });

async function createVideoTaskResponse({ body, token, user, set }: ElysiaCtx, metadata: Record<string, unknown> = {}) {
        const model = (body.model) as string;

        if (!model) {
            set.status = 400;
            return { error: { message: "Missing 'model' field", type: 'invalid_request' } };
        }

        if (!body.prompt) {
            set.status = 400;
            return { error: { message: "Missing 'prompt' field", type: 'invalid_request' } };
        }

        const u = user as UserRecord;
        const t = token as TokenRecord;

        assertModelAccess(u, t, model, set);

        log.info(`[VIDEO] UserID: ${u.id}, Token: ${t.name}, Model: ${model}`);

        // Create async task — returns immediately
        const taskId = await createTask({
            userId: u.id,
            tokenId: t.id,
            model,
            type: 'video',
            requestBody: { ...body, ...metadata },
        });

        set.status = 202; // Accepted
        return {
            id: taskId,
            object: 'task',
            model,
            status: 'pending',
            message: 'Video generation task created. Poll GET /v1/tasks/{id} for status.',
        };
}

async function getVideoTaskResponse({ params, user, set }: ElysiaCtx) {
    if (!user) {
        set.status = 401;
        return { success: false, message: 'Unauthorized' };
    }

    const u = user as UserRecord;
    const task = await getTask(params.taskId, u.id);
    if (!task) {
        set.status = 404;
        return { error: { message: 'Task not found', type: 'not_found' } };
    }

    const response: Record<string, any> = {
        id: task.id,
        object: 'video',
        model: task.model,
        status: task.status,
        progress: task.progress,
        created_at: Math.floor(new Date(task.createdAt).getTime() / 1000),
        updated_at: Math.floor(new Date(task.updatedAt).getTime() / 1000),
    };
    if (task.status === 'completed' && task.result) response.result = task.result;
    if (task.status === 'failed' && task.error) response.error = { message: task.error, type: 'generation_failed' };
    return response;
}
