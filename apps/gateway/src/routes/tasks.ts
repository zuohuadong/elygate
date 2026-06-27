import type { ElysiaCtx } from '../types';
import { Elysia } from 'elysia';
import { cancelTask, getTask } from '../services/task-service';
import type { UserRecord } from '../types';

/**
 * /v1/tasks endpoint — query async task status and results
 */
export const tasksRouter = new Elysia()
    .get('/tasks/:taskId', async ({ params, user, set }: ElysiaCtx) => {
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

        // Public response (hide internal fields)
        const response: Record<string, any> = {
            id: task.id,
            object: 'task',
            model: task.model,
            type: task.type,
            status: task.status,
            progress: task.progress,
            created_at: Math.floor(new Date(task.createdAt).getTime() / 1000),
            updated_at: Math.floor(new Date(task.updatedAt).getTime() / 1000),
        };

        if (task.status === 'completed' && task.result) {
            response.result = task.result;
        }
        if (task.status === 'failed' && task.error) {
            response.error = { message: task.error, type: 'generation_failed' };
        }

        return response;
    })
    .post('/tasks/:taskId/cancel', async ({ params, user, set }: ElysiaCtx) => {
        if (!user) {
            set.status = 401;
            return { success: false, message: 'Unauthorized' };
        }

        const u = user as UserRecord;
        const cancelled = await cancelTask(params.taskId, u.id);
        if (cancelled) {
            return {
                id: cancelled.id,
                object: 'task',
                model: cancelled.model,
                type: cancelled.type,
                status: cancelled.status,
                progress: cancelled.progress,
                cancelled: true,
                updated_at: Math.floor(new Date(cancelled.updatedAt).getTime() / 1000),
            };
        }

        const task = await getTask(params.taskId, u.id);
        if (!task) {
            set.status = 404;
            return { error: { message: 'Task not found', type: 'not_found' } };
        }

        set.status = 409;
        return {
            error: {
                message: `Task cannot be cancelled from ${task.status}`,
                type: 'invalid_state',
            },
            status: task.status,
        };
    });
