import type { ElysiaCtx } from '../types';
import { Elysia } from 'elysia';
import { db, sql } from '@elygate/db';
import { apiFiles } from '@elygate/db/schema';
import { eq, and, desc } from 'drizzle-orm';

function createId(prefix: string): string {
    return `${prefix}_${crypto.randomUUID().replace(/-/g, '')}`;
}

function serializeFile(row: Record<string, any>) {
    return {
        id: row.id,
        object: row.object || 'file',
        bytes: Number(row.bytes || 0),
        created_at: Math.floor(new Date(row.createdAt || Date.now()).getTime() / 1000),
        filename: row.filename,
        purpose: row.purpose,
        status: row.status || 'processed',
        status_details: row.statusDetails || row.status_details || null
    };
}

export const filesRouter = new Elysia()
    .get('/files', async ({ user, query }: ElysiaCtx) => {
        const purpose = query?.purpose;
        const conditions = [eq(apiFiles.userId, user.id)];
        if (purpose) conditions.push(eq(apiFiles.purpose, purpose));

        const rows = await db.select()
            .from(apiFiles)
            .where(and(...conditions))
            .orderBy(desc(apiFiles.createdAt))
            .limit(100);
        return { object: 'list', data: rows.map(serializeFile) };
    })
    .post('/files', async ({ body, user, token }: ElysiaCtx) => {
        const payload = body || {};
        const uploaded = payload.file || payload.upload;
        const filename = payload.filename || uploaded?.name || 'uploaded.jsonl';
        const bytes = Number(payload.bytes ?? uploaded?.size ?? 0);
        const purpose = payload.purpose || 'assistants';
        const id = createId('file');

        const [row] = await db.insert(apiFiles).values({
            id,
            userId: user.id,
            tokenId: token?.id || null,
            bytes,
            filename,
            purpose,
            metadata: payload.metadata || {},
        }).returning();
        return serializeFile(row);
    })
    .get('/files/:file_id', async ({ params, user, set }: ElysiaCtx) => {
        const [row] = await db.select()
            .from(apiFiles)
            .where(and(eq(apiFiles.id, params.file_id), eq(apiFiles.userId, user.id)))
            .limit(1);
        if (row) return serializeFile(row);
        set.status = 404;
        return { error: { message: 'File not found', type: 'not_found' } };
    })
    .delete('/files/:file_id', async ({ params, user, set }: ElysiaCtx) => {
        const [row] = await db.delete(apiFiles)
            .where(and(eq(apiFiles.id, params.file_id), eq(apiFiles.userId, user.id)))
            .returning({ id: apiFiles.id });
        if (row) return { id: row.id, object: 'file', deleted: true };
        set.status = 404;
        return { error: { message: 'File not found', type: 'not_found' } };
    })
    .get('/files/:file_id/content', async ({ params, user, set }: ElysiaCtx) => {
        const [row] = await db.select({ id: apiFiles.id })
            .from(apiFiles)
            .where(and(eq(apiFiles.id, params.file_id), eq(apiFiles.userId, user.id)))
            .limit(1);
        if (row) {
            set.status = 501;
            return { error: { message: 'File metadata is stored, but binary file content storage is not enabled.', type: 'not_implemented' } };
        }
        set.status = 404;
        return { error: { message: 'File not found', type: 'not_found' } };
    });
