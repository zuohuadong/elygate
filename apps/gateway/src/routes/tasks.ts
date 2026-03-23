import { Elysia } from 'elysia';
import { getTask } from '../services/task-service';
import type { UserRecord, TokenRecord } from '../types';

/**
 * /v1/tasks endpoint — query async task status and results
 */
export const tasksRouter = new Elysia()
    .get('/tasks/:taskId', async ({ params, user, set }: any) => {
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
    });
