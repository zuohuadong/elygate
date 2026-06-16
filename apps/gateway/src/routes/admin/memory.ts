import type { ElysiaCtx } from '../../types';
import { Elysia } from 'elysia';
import { cleanupExpiredMemories, getMemoryStats, isMemoryKind, isMemoryScope, listMemories, purgeDeletedMemories, softDeleteMemory } from '../../services/memory';
import { getErrorMessage } from '../../utils/error';

function asNumber(value: unknown, fallback: number, options: { min?: number; max?: number } = {}): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    const min = options.min ?? Number.NEGATIVE_INFINITY;
    const max = options.max ?? Number.POSITIVE_INFINITY;
    return Math.max(min, Math.min(Math.trunc(parsed), max));
}

export const memoryAdminRouter = new Elysia()
    .get('/memory/stats', async ({ set }: ElysiaCtx) => {
        try {
            return { success: true, data: await getMemoryStats() };
        } catch (error: unknown) {
            set.status = 500;
            return { success: false, message: getErrorMessage(error) };
        }
    })
    .get('/memory', async ({ query, set }: ElysiaCtx) => {
        try {
            const q = query as Record<string, string | undefined>;
            const userId = q.userId ? asNumber(q.userId, 0, { min: 1 }) : undefined;
            const scope = isMemoryScope(q.scope) ? q.scope : undefined;
            const kind = isMemoryKind(q.kind) ? q.kind : undefined;
            const result = await listMemories({
                limit: asNumber(q.limit, 50, { min: 1, max: 200 }),
                offset: asNumber(q.offset, 0, { min: 0 }),
                query: q.query || undefined,
                userId,
                scope,
                kind,
                includeDeleted: q.includeDeleted === 'true'
            });
            return { success: true, ...result };
        } catch (error: unknown) {
            set.status = 500;
            return { success: false, message: getErrorMessage(error) };
        }
    })
    .post('/memory/cleanup-expired', async ({ set }: ElysiaCtx) => {
        try {
            return { success: true, count: await cleanupExpiredMemories() };
        } catch (error: unknown) {
            set.status = 500;
            return { success: false, message: getErrorMessage(error) };
        }
    })
    .delete('/memory/deleted', async ({ set }: ElysiaCtx) => {
        try {
            return { success: true, count: await purgeDeletedMemories() };
        } catch (error: unknown) {
            set.status = 500;
            return { success: false, message: getErrorMessage(error) };
        }
    })
    .delete('/memory/:id', async ({ params, set }: ElysiaCtx) => {
        try {
            const deleted = await softDeleteMemory(params.id);
            if (!deleted) {
                set.status = 404;
                return { success: false, message: 'Memory not found' };
            }
            return { success: true };
        } catch (error: unknown) {
            set.status = 500;
            return { success: false, message: getErrorMessage(error) };
        }
    });
