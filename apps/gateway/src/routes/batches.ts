import type { ElysiaCtx } from '../types';
import { Elysia } from 'elysia';
import { db, sql } from '@elygate/db';
import { apiBatches, apiFiles } from '@elygate/db/schema';
import { eq, and, desc, notInArray, sql as drizzleSql } from 'drizzle-orm';
import { serializeBatch } from './protocolShapes';

function createId(prefix: string): string {
    return `${prefix}_${crypto.randomUUID().replace(/-/g, '')}`;
}

export const batchesRouter = new Elysia()
    .get('/batches', async ({ user, query }: ElysiaCtx) => {
        const limit = Math.min(Number(query?.limit || 20), 100);
        const rows = await db.select()
            .from(apiBatches)
            .where(eq(apiBatches.userId, user.id))
            .orderBy(desc(apiBatches.createdAt))
            .limit(limit);
        return { object: 'list', data: rows.map(serializeBatch), first_id: rows[0]?.id || null, last_id: rows.length ? rows[rows.length - 1].id : null, has_more: false };
    })
    .post('/batches', async ({ body, user, token, set }: ElysiaCtx) => {
        const payload = body || {};
        if (!payload.input_file_id || !payload.endpoint) {
            set.status = 400;
            return { error: { message: 'input_file_id and endpoint are required', type: 'invalid_request_error' } };
        }

        const [file] = await db.select({ id: apiFiles.id })
            .from(apiFiles)
            .where(and(eq(apiFiles.id, payload.input_file_id), eq(apiFiles.userId, user.id)))
            .limit(1);
        if (!file) {
            set.status = 404;
            return { error: { message: 'Input file not found', type: 'not_found' } };
        }

        const id = createId('batch');
        const [row] = await db.insert(apiBatches).values({
            id,
            userId: user.id,
            tokenId: token?.id || null,
            endpoint: payload.endpoint,
            inputFileId: payload.input_file_id,
            completionWindow: payload.completion_window || '24h',
            status: 'validating',
            metadata: payload.metadata || {},
            expiredAt: drizzleSql`NOW() + INTERVAL '24 hours'`,
        }).returning();
        return serializeBatch(row);
    })
    .get('/batches/:batch_id', async ({ params, user, set }: ElysiaCtx) => {
        const [row] = await db.select()
            .from(apiBatches)
            .where(and(eq(apiBatches.id, params.batch_id), eq(apiBatches.userId, user.id)))
            .limit(1);
        if (row) return serializeBatch(row);
        set.status = 404;
        return { error: { message: 'Batch not found', type: 'not_found' } };
    })
    .post('/batches/:batch_id/cancel', async ({ params, user, set }: ElysiaCtx) => {
        // The WHERE status NOT IN (...) requires raw SQL for the array check
        const [row] = await db.update(apiBatches)
            .set({
                status: 'cancelled',
                cancellingAt: drizzleSql`COALESCE(${apiBatches.cancellingAt}, NOW())`,
                cancelledAt: new Date(),
            })
            .where(and(
                eq(apiBatches.id, params.batch_id),
                eq(apiBatches.userId, user.id),
                drizzleSql`${apiBatches.status} NOT IN ('completed', 'failed', 'expired', 'cancelled')`,
            ))
            .returning();
        if (row) return serializeBatch(row);
        set.status = 404;
        return { error: { message: 'Batch not found', type: 'not_found' } };
    });
