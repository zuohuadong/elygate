import type { ElysiaCtx, TokenRecord, UserRecord } from '../types';
import type { TaskRecord } from '../services/task-service';
import { Elysia } from 'elysia';
import { authPlugin, assertModelAccess } from '../middleware/auth';
import * as taskService from '../services/task-service';

function taskModel(body: Record<string, any>, fallback: string): string {
    return String(body.model || body.model_name || body.modelName || fallback);
}

function taskPrompt(body: Record<string, any>): string {
    return String(body.prompt || body.text || body.input || body.query || '');
}

export async function createCompatTask(
    { body, token, user, set }: ElysiaCtx,
    options: { readonly type: string; readonly defaultModel: string; readonly action: string; readonly requirePrompt?: boolean }
) {
    const b = body as Record<string, any>;
    const model = taskModel(b, options.defaultModel);
    const prompt = taskPrompt(b);
    if (options.requirePrompt !== false && !prompt) {
        set.status = 400;
        return { error: { message: "Missing 'prompt' field", type: 'invalid_request' } };
    }

    const u = user as UserRecord;
    const t = token as TokenRecord;
    assertModelAccess(u, t, model, set);

    const id = await taskService.createTask({
        userId: u.id,
        tokenId: t.id,
        model,
        type: options.type,
        requestBody: { ...b, prompt, action: options.action, newApiCompat: true },
    });

    set.status = 202;
    return {
        id,
        task_id: id,
        object: 'task',
        status: 'pending',
        action: options.action,
        model,
    };
}

export async function createMidjourneyCompatTask(ctx: ElysiaCtx, action: string) {
    const response = await createCompatTask(ctx, {
        type: 'image',
        defaultModel: 'mj-chat',
        action: `mj_${action}`,
        requirePrompt: false,
    }) as Record<string, any>;

    if ('error' in response) return response;
    return {
        code: 1,
        description: 'success',
        result: response.task_id,
        properties: {
            action,
            status: response.status,
        },
    };
}

function taskResponse(task: TaskRecord | null) {
    if (!task) return null;
    return {
        id: task.id,
        task_id: task.id,
        object: 'task',
        model: task.model,
        type: task.type,
        status: task.status,
        progress: task.progress,
        result: task.result || null,
        error: task.error ? { message: task.error, type: 'generation_failed' } : null,
        created_at: Math.floor(new Date(task.createdAt).getTime() / 1000),
        updated_at: Math.floor(new Date(task.updatedAt).getTime() / 1000),
    };
}

export async function getCompatTask({ params, user, set }: ElysiaCtx, idParam = 'task_id') {
    const taskId = params[idParam] || params.id || params.taskId;
    const task = await taskService.getTask(String(taskId), user?.id);
    const response = taskResponse(task);
    if (!response) {
        set.status = 404;
        return { error: { message: 'Task not found', type: 'not_found' } };
    }
    return response;
}

function firstString(...values: unknown[]): string | null {
    for (const value of values) {
        if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return null;
}

export const newApiRelayCompatRouter = new Elysia()
    .use(authPlugin)
    .get('/mj/image/:id', async ({ params }: ElysiaCtx) => ({
        code: 1,
        description: 'success',
        result: params.id,
    }))
    .get('/:mode/mj/image/:id', async ({ params }: ElysiaCtx) => ({
        code: 1,
        description: 'success',
        result: params.id,
        mode: params.mode,
    }))
    .post('/mj/submit/shorten', async (ctx: ElysiaCtx) => createMidjourneyCompatTask(ctx, 'shorten'))
    .post('/mj/submit/modal', async (ctx: ElysiaCtx) => createMidjourneyCompatTask(ctx, 'modal'))
    .post('/mj/submit/change', async (ctx: ElysiaCtx) => createMidjourneyCompatTask(ctx, 'change'))
    .post('/mj/submit/simple-change', async (ctx: ElysiaCtx) => createMidjourneyCompatTask(ctx, 'simple-change'))
    .post('/mj/submit/describe', async (ctx: ElysiaCtx) => createMidjourneyCompatTask(ctx, 'describe'))
    .post('/mj/submit/blend', async (ctx: ElysiaCtx) => createMidjourneyCompatTask(ctx, 'blend'))
    .post('/mj/submit/edits', async (ctx: ElysiaCtx) => createMidjourneyCompatTask(ctx, 'edits'))
    .post('/mj/submit/video', async (ctx: ElysiaCtx) => createMidjourneyCompatTask(ctx, 'video'))
    .post('/mj/submit/upload-discord-images', async (ctx: ElysiaCtx) => createMidjourneyCompatTask(ctx, 'upload-discord-images'))
    .get('/mj/task/:id/image-seed', async ({ params }: ElysiaCtx) => ({
        code: 1,
        description: 'success',
        result: { id: params.id, seed: null },
    }))
    .post('/mj/task/list-by-condition', async ({ user }: ElysiaCtx) => ({
        code: 1,
        description: 'success',
        result: [],
        user_id: user?.id,
    }))
    .post('/mj/insight-face/swap', async (ctx: ElysiaCtx) => createMidjourneyCompatTask(ctx, 'insight-face-swap'))
    .post('/:mode/mj/submit/action', async (ctx: ElysiaCtx) => createMidjourneyCompatTask(ctx, `${ctx.params.mode}_action`))
    .post('/:mode/mj/submit/shorten', async (ctx: ElysiaCtx) => createMidjourneyCompatTask(ctx, `${ctx.params.mode}_shorten`))
    .post('/:mode/mj/submit/modal', async (ctx: ElysiaCtx) => createMidjourneyCompatTask(ctx, `${ctx.params.mode}_modal`))
    .post('/:mode/mj/submit/imagine', async (ctx: ElysiaCtx) => createMidjourneyCompatTask(ctx, `${ctx.params.mode}_imagine`))
    .post('/:mode/mj/submit/change', async (ctx: ElysiaCtx) => createMidjourneyCompatTask(ctx, `${ctx.params.mode}_change`))
    .post('/:mode/mj/submit/simple-change', async (ctx: ElysiaCtx) => createMidjourneyCompatTask(ctx, `${ctx.params.mode}_simple-change`))
    .post('/:mode/mj/submit/describe', async (ctx: ElysiaCtx) => createMidjourneyCompatTask(ctx, `${ctx.params.mode}_describe`))
    .post('/:mode/mj/submit/blend', async (ctx: ElysiaCtx) => createMidjourneyCompatTask(ctx, `${ctx.params.mode}_blend`))
    .post('/:mode/mj/submit/edits', async (ctx: ElysiaCtx) => createMidjourneyCompatTask(ctx, `${ctx.params.mode}_edits`))
    .post('/:mode/mj/submit/video', async (ctx: ElysiaCtx) => createMidjourneyCompatTask(ctx, `${ctx.params.mode}_video`))
    .get('/:mode/mj/task/:id/fetch', async (ctx: ElysiaCtx) => getCompatTask(ctx, 'id'))
    .get('/:mode/mj/task/:id/image-seed', async ({ params }: ElysiaCtx) => ({
        code: 1,
        description: 'success',
        result: { id: params.id, mode: params.mode, seed: null },
    }))
    .post('/:mode/mj/task/list-by-condition', async ({ params, user }: ElysiaCtx) => ({
        code: 1,
        description: 'success',
        result: [],
        mode: params.mode,
        user_id: user?.id,
    }))
    .post('/:mode/mj/insight-face/swap', async (ctx: ElysiaCtx) => createMidjourneyCompatTask(ctx, `${ctx.params.mode}_insight-face-swap`))
    .post('/:mode/mj/submit/upload-discord-images', async (ctx: ElysiaCtx) => createMidjourneyCompatTask(ctx, `${ctx.params.mode}_upload-discord-images`))
    .get('/v1/videos/:taskId/content', async (ctx: ElysiaCtx) => {
        const task = await taskService.getTask(String(ctx.params.taskId), ctx.user?.id);
        if (!task) {
            ctx.set.status = 404;
            return { error: { message: 'Task not found', type: 'not_found' } };
        }
        if (task.status !== 'completed') {
            ctx.set.status = 409;
            return { error: { message: `Task is ${task.status}`, type: 'task_not_ready' } };
        }

        const result = task.result || {};
        const contentUrl = firstString(
            result.url,
            result.video_url,
            result.videoUrl,
            result.output_url,
            result.outputUrl,
            Array.isArray(result.data) ? result.data[0]?.url : null
        );
        if (contentUrl) {
            return Response.redirect(contentUrl, 302);
        }

        const base64 = firstString(result.b64_json, result.base64, result.content);
        if (base64) {
            return new Response(Buffer.from(base64, 'base64'), {
                headers: { 'Content-Type': 'video/mp4' },
            });
        }

        ctx.set.status = 404;
        return { error: { message: 'Task result does not include downloadable video content', type: 'content_not_found' } };
    })
    .post('/kling/v1/videos/text2video', async (ctx: ElysiaCtx) =>
        createCompatTask(ctx, { type: 'video', defaultModel: 'kling-v1', action: 'kling_text2video' }))
    .post('/kling/v1/videos/image2video', async (ctx: ElysiaCtx) =>
        createCompatTask(ctx, { type: 'video', defaultModel: 'kling-v1', action: 'kling_image2video', requirePrompt: false }))
    .get('/kling/v1/videos/text2video/:task_id', async (ctx: ElysiaCtx) => getCompatTask(ctx))
    .get('/kling/v1/videos/image2video/:task_id', async (ctx: ElysiaCtx) => getCompatTask(ctx))
    .post('/jimeng', async (ctx: ElysiaCtx) =>
        createCompatTask(ctx, { type: 'video', defaultModel: 'jimeng', action: 'jimeng_official', requirePrompt: false }))
    .post('/suno/submit/:action', async (ctx: ElysiaCtx) =>
        createCompatTask(ctx, { type: 'audio', defaultModel: 'suno', action: `suno_${ctx.params.action}`, requirePrompt: false }))
    .post('/suno/fetch', async (ctx: ElysiaCtx) => getCompatTask(ctx, 'id'))
    .get('/suno/fetch/:id', async (ctx: ElysiaCtx) => getCompatTask(ctx, 'id'));
