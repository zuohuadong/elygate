import { Elysia } from 'elysia';
import { log } from '../services/logger';
import { assertModelAccess } from '../middleware/auth';
import { createTask } from '../services/task-service';
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
    .post('/video/generations', async ({ body, token, user, set }: any) => {
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
            requestBody: body,
        });

        set.status = 202; // Accepted
        return {
            id: taskId,
            object: 'task',
            model,
            status: 'pending',
            message: 'Video generation task created. Poll GET /v1/tasks/{id} for status.',
        };
    });
