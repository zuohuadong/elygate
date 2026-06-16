import type { ElysiaCtx } from '../types';
import { Elysia } from 'elysia';
import { db, sql } from '@elygate/db';
import { apiFiles } from '@elygate/db/schema';
import { eq, and, desc } from 'drizzle-orm';

const MAX_FILE_SIZE = Number(process.env.MAX_FILE_SIZE || 50) * 1024 * 1024; // 默认 50MB

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

        const rows = await db.select({
            id: apiFiles.id,
            object: apiFiles.object,
            bytes: apiFiles.bytes,
            createdAt: apiFiles.createdAt,
            filename: apiFiles.filename,
            purpose: apiFiles.purpose,
            status: apiFiles.status,
            statusDetails: apiFiles.statusDetails,
        })
            .from(apiFiles)
            .where(and(...conditions))
            .orderBy(desc(apiFiles.createdAt))
            .limit(100);
        return { object: 'list', data: rows.map(serializeFile) };
    })
    .post('/files', async ({ body, user, token, set }: ElysiaCtx) => {
        const payload = body || {};
        const uploaded = payload.file || payload.upload;
        const filename = payload.filename || uploaded?.name || 'uploaded.jsonl';
        const purpose = payload.purpose || 'assistants';
        const id = createId('file');

        // 提取文件内容（支持 multipart form、base64、或原始 body）
        let contentBytes: Buffer | null = null;
        let bytes = 0;

        if (uploaded instanceof Blob || uploaded instanceof File) {
            const arrayBuffer = await uploaded.arrayBuffer();
            contentBytes = Buffer.from(arrayBuffer);
            bytes = contentBytes.length;
        } else if (typeof uploaded === 'string') {
            contentBytes = Buffer.from(uploaded, 'utf-8');
            bytes = contentBytes.length;
        } else if (payload.content && typeof payload.content === 'string') {
            // base64 编码
            contentBytes = Buffer.from(payload.content, 'base64');
            bytes = contentBytes.length;
        } else if (payload.body instanceof ArrayBuffer) {
            contentBytes = Buffer.from(payload.body);
            bytes = contentBytes.length;
        } else {
            bytes = Number(payload.bytes ?? uploaded?.size ?? 0);
        }

        if (bytes > MAX_FILE_SIZE) {
            set.status = 413;
            return { error: { message: `File too large. Max size is ${MAX_FILE_SIZE / 1024 / 1024}MB`, type: 'request_too_large' } };
        }

        const [row] = await db.insert(apiFiles).values({
            id,
            userId: user.id,
            tokenId: token?.id || null,
            bytes,
            filename,
            purpose,
            content: contentBytes,
            metadata: payload.metadata || {},
        }).returning({
            id: apiFiles.id,
            object: apiFiles.object,
            bytes: apiFiles.bytes,
            createdAt: apiFiles.createdAt,
            filename: apiFiles.filename,
            purpose: apiFiles.purpose,
            status: apiFiles.status,
            statusDetails: apiFiles.statusDetails,
        });
        return serializeFile(row!);
    })
    .get('/files/:file_id', async ({ params, user, set }: ElysiaCtx) => {
        const [row] = await db.select({
            id: apiFiles.id,
            object: apiFiles.object,
            bytes: apiFiles.bytes,
            createdAt: apiFiles.createdAt,
            filename: apiFiles.filename,
            purpose: apiFiles.purpose,
            status: apiFiles.status,
            statusDetails: apiFiles.statusDetails,
        })
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
        const [row] = await db.select({
            id: apiFiles.id,
            filename: apiFiles.filename,
            purpose: apiFiles.purpose,
            content: apiFiles.content,
        })
            .from(apiFiles)
            .where(and(eq(apiFiles.id, params.file_id), eq(apiFiles.userId, user.id)))
            .limit(1);
        if (!row) {
            set.status = 404;
            return { error: { message: 'File not found', type: 'not_found' } };
        }
        if (!row.content) {
            set.status = 404;
            return { error: { message: 'File content not stored', type: 'not_found' } };
        }
        // 返回二进制内容
        const buf = row.content as Buffer;
        set.headers['Content-Type'] = 'application/octet-stream';
        set.headers['Content-Disposition'] = `attachment; filename="${row.filename}"`;
        return new Response(buf as any, {
            headers: {
                'Content-Type': 'application/octet-stream',
                'Content-Disposition': `attachment; filename="${row.filename}"`,
            }
        });
    });
