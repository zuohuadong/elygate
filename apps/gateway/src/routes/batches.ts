import type { ElysiaCtx } from '../types';
import { Elysia } from 'elysia';
import { sql } from '@elygate/db';

function createId(prefix: string): string {
    return `${prefix}_${crypto.randomUUID().replace(/-/g, '')}`;
}

function ts(value: unknown): number | null {
    if (!value) return null;
    return Math.floor(new Date(value as string).getTime() / 1000);
}

function serializeBatch(row: Record<string, any>) {
    return {
        id: row.id,
        object: row.object || 'batch',
        endpoint: row.endpoint,
        input_file_id: row.input_file_id || row.inputFileId,
        completion_window: row.completion_window || row.completionWindow || '24h',
        status: row.status,
        output_file_id: row.output_file_id || row.outputFileId || null,
        error_file_id: row.error_file_id || row.errorFileId || null,
        created_at: ts(row.created_at),
        in_progress_at: ts(row.in_progress_at),
        expires_at: ts(row.expired_at),
        finalizing_at: ts(row.finalizing_at),
        completed_at: ts(row.completed_at),
        failed_at: ts(row.failed_at),
        cancelling_at: ts(row.cancelling_at),
        cancelled_at: ts(row.cancelled_at),
        request_counts: row.request_counts || row.requestCounts || { total: 0, completed: 0, failed: 0 },
        metadata: row.metadata || {},
        errors: row.errors || null
    };
}

export const batchesRouter = new Elysia()
    .get('/batches', async ({ user, query }: ElysiaCtx) => {
        const limit = Math.min(Number(query?.limit || 20), 100);
        const rows = await sql`
            SELECT *
            FROM api_batches
            WHERE user_id = ${user.id}
            ORDER BY created_at DESC
            LIMIT ${limit}
        `;
        return { object: 'list', data: rows.map(serializeBatch), first_id: rows[0]?.id || null, last_id: rows.length ? rows[rows.length - 1].id : null, has_more: false };
    })
    .post('/batches', async ({ body, user, token, set }: ElysiaCtx) => {
        const payload = body || {};
        if (!payload.input_file_id || !payload.endpoint) {
            set.status = 400;
            return { error: { message: 'input_file_id and endpoint are required', type: 'invalid_request_error' } };
        }

        const [file] = await sql`
            SELECT id FROM api_files
            WHERE id = ${payload.input_file_id} AND user_id = ${user.id}
            LIMIT 1
        `;
        if (!file) {
            set.status = 404;
            return { error: { message: 'Input file not found', type: 'not_found' } };
        }

        const id = createId('batch');
        const [row] = await sql`
            INSERT INTO api_batches (
                id, user_id, token_id, endpoint, input_file_id, completion_window,
                status, metadata, expired_at
            )
            VALUES (
                ${id},
                ${user.id},
                ${token?.id || null},
                ${payload.endpoint},
                ${payload.input_file_id},
                ${payload.completion_window || '24h'},
                'validating',
                ${payload.metadata || {}},
                NOW() + INTERVAL '24 hours'
            )
            RETURNING *
        `;
        return serializeBatch(row);
    })
    .get('/batches/:batch_id', async ({ params, user, set }: ElysiaCtx) => {
        const [row] = await sql`
            SELECT * FROM api_batches
            WHERE id = ${params.batch_id} AND user_id = ${user.id}
            LIMIT 1
        `;
        if (row) return serializeBatch(row);
        set.status = 404;
        return { error: { message: 'Batch not found', type: 'not_found' } };
    })
    .post('/batches/:batch_id/cancel', async ({ params, user, set }: ElysiaCtx) => {
        const [row] = await sql`
            UPDATE api_batches
            SET status = 'cancelled',
                cancelling_at = COALESCE(cancelling_at, NOW()),
                cancelled_at = NOW()
            WHERE id = ${params.batch_id}
              AND user_id = ${user.id}
              AND status NOT IN ('completed', 'failed', 'expired', 'cancelled')
            RETURNING *
        `;
        if (row) return serializeBatch(row);
        set.status = 404;
        return { error: { message: 'Batch not found', type: 'not_found' } };
    });
