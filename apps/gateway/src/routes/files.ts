import type { ElysiaCtx } from '../types';
import { Elysia } from 'elysia';
import { sql } from '@elygate/db';

function createId(prefix: string): string {
    return `${prefix}_${crypto.randomUUID().replace(/-/g, '')}`;
}

function serializeFile(row: Record<string, any>) {
    return {
        id: row.id,
        object: row.object || 'file',
        bytes: Number(row.bytes || 0),
        created_at: Math.floor(new Date(row.created_at || Date.now()).getTime() / 1000),
        filename: row.filename,
        purpose: row.purpose,
        status: row.status || 'processed',
        status_details: row.status_details || row.statusDetails || null
    };
}

export const filesRouter = new Elysia()
    .get('/files', async ({ user, query }: ElysiaCtx) => {
        const purpose = query?.purpose;
        const rows = purpose
            ? await sql`
                SELECT id, object, bytes, created_at, filename, purpose, status, status_details
                FROM api_files
                WHERE user_id = ${user.id} AND purpose = ${purpose}
                ORDER BY created_at DESC
                LIMIT 100
            `
            : await sql`
                SELECT id, object, bytes, created_at, filename, purpose, status, status_details
                FROM api_files
                WHERE user_id = ${user.id}
                ORDER BY created_at DESC
                LIMIT 100
            `;
        return { object: 'list', data: rows.map(serializeFile) };
    })
    .post('/files', async ({ body, user, token }: ElysiaCtx) => {
        const payload = body || {};
        const uploaded = payload.file || payload.upload;
        const filename = payload.filename || uploaded?.name || 'uploaded.jsonl';
        const bytes = Number(payload.bytes ?? uploaded?.size ?? 0);
        const purpose = payload.purpose || 'assistants';
        const id = createId('file');

        const [row] = await sql`
            INSERT INTO api_files (id, user_id, token_id, bytes, filename, purpose, metadata)
            VALUES (
                ${id},
                ${user.id},
                ${token?.id || null},
                ${bytes},
                ${filename},
                ${purpose},
                ${payload.metadata || {}}
            )
            RETURNING id, object, bytes, created_at, filename, purpose, status, status_details
        `;
        return serializeFile(row);
    })
    .get('/files/:file_id', async ({ params, user, set }: ElysiaCtx) => {
        const [row] = await sql`
            SELECT id, object, bytes, created_at, filename, purpose, status, status_details
            FROM api_files
            WHERE id = ${params.file_id} AND user_id = ${user.id}
            LIMIT 1
        `;
        if (row) return serializeFile(row);
        set.status = 404;
        return { error: { message: 'File not found', type: 'not_found' } };
    })
    .delete('/files/:file_id', async ({ params, user, set }: ElysiaCtx) => {
        const [row] = await sql`
            DELETE FROM api_files
            WHERE id = ${params.file_id} AND user_id = ${user.id}
            RETURNING id
        `;
        if (row) return { id: row.id, object: 'file', deleted: true };
        set.status = 404;
        return { error: { message: 'File not found', type: 'not_found' } };
    })
    .get('/files/:file_id/content', async ({ params, user, set }: ElysiaCtx) => {
        const [row] = await sql`
            SELECT id FROM api_files
            WHERE id = ${params.file_id} AND user_id = ${user.id}
            LIMIT 1
        `;
        if (row) {
            set.status = 501;
            return { error: { message: 'File metadata is stored, but binary file content storage is not enabled.', type: 'not_implemented' } };
        }
        set.status = 404;
        return { error: { message: 'File not found', type: 'not_found' } };
    });
