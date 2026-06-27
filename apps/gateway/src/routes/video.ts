import type { ElysiaCtx } from '../types';
import { Elysia, t } from 'elysia';
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
const videoGenerationBodySchema = t.Object({
    model: t.String(),
    prompt: t.String(),
}, { additionalProperties: true });

const taskIdParamsSchema = t.Object({
    taskId: t.String(),
});

const videoIdParamsSchema = t.Object({
    videoId: t.String(),
});

export const videoRouter = new Elysia()
    .post('/video/generations', async (ctx: ElysiaCtx) => {
        return await createVideoTaskResponse(ctx);
    }, { body: videoGenerationBodySchema })
    .get('/video/generations/:taskId', async (ctx: ElysiaCtx) => {
        return await getVideoTaskResponse(ctx);
    }, { params: taskIdParamsSchema })
    .post('/videos', async (ctx: ElysiaCtx) => {
        return await createVideoTaskResponse(ctx);
    }, { body: videoGenerationBodySchema })
    .get('/videos/:taskId/content', async (ctx: ElysiaCtx) => {
        return await getVideoContentResponse(ctx);
    }, { params: taskIdParamsSchema })
    .get('/videos/:taskId', async (ctx: ElysiaCtx) => {
        return await getVideoTaskResponse(ctx);
    }, { params: taskIdParamsSchema })
    .post('/videos/:videoId/remix', async (ctx: ElysiaCtx) => {
        return await createVideoTaskResponse(ctx, { sourceVideoId: ctx.params?.videoId, action: 'remix' });
    }, { params: videoIdParamsSchema, body: videoGenerationBodySchema });

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

async function getVideoContentResponse({ params, user, set }: ElysiaCtx) {
    if (!user) {
        set.status = 401;
        return { success: false, message: 'Unauthorized' };
    }

    const task = await getTask(params.taskId, (user as UserRecord).id);
    if (!task) {
        set.status = 404;
        return { error: { message: 'Task not found', type: 'not_found' } };
    }
    if (task.status !== 'completed') {
        set.status = 409;
        return { error: { message: `Task is ${task.status}`, type: 'task_not_ready' } };
    }

    const result = task.result || {};
    const url = result.url || result.video_url || result.videoUrl || result.output_url || result.outputUrl || (Array.isArray(result.data) ? result.data[0]?.url : null);
    if (typeof url === 'string' && url) return Response.redirect(url, 302);

    const base64 = result.b64_json || result.base64 || result.content;
    if (typeof base64 === 'string' && base64) {
        return new Response(Buffer.from(base64, 'base64'), { headers: { 'Content-Type': 'video/mp4' } });
    }

    set.status = 404;
    return { error: { message: 'Task result does not include downloadable video content', type: 'content_not_found' } };
}
