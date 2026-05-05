import type { ElysiaCtx } from '../../types';
import { Elysia, t } from 'elysia';
import { sql } from '@elygate/db';
import { getErrorMessage } from '../../utils/error';
import { refreshAllCaches } from './index';

export const modelsAdminRouter = new Elysia()
    // --- List All Model Metadata ---
    .get('/models-meta', async ({ query }: ElysiaCtx) => {
        const search = (query?.keyword || '').trim();
        const type = query?.type;
        const rows = await sql`
            SELECT id, model_name, type, endpoint, display_name, tags, created_at, updated_at
            FROM model_metadata
            WHERE (${search || null} IS NULL OR model_name ILIKE ${'%' + search + '%'})
              AND (${type || null} IS NULL OR type = ${type})
            ORDER BY model_name LIMIT 500
        `;
        return rows;
    })

    // --- Get Single Model Metadata ---
    .get('/models-meta/:id', async ({ params: { id }, set }: ElysiaCtx) => {
        const [row] = await sql`SELECT * FROM model_metadata WHERE id = ${Number(id)} LIMIT 1`;
        if (!row) { set.status = 404; return { success: false, message: 'Not found' }; }
        return row;
    })

    // --- Create Model Metadata ---
    .post('/models-meta', async ({ body, set }: ElysiaCtx) => {
        const b = body as Record<string, any>;
        try {
            const [result] = await sql`
                INSERT INTO model_metadata (model_name, type, endpoint, display_name, tags)
                VALUES (${b.modelName}, ${b.type || 'chat'}, ${b.endpoint || null}, ${b.displayName || null}, ${b.tags || []})
                RETURNING *
            `;
            return result;
        } catch (e: unknown) {
            set.status = 500;
            return { success: false, message: getErrorMessage(e) };
        }
    }, { body: t.Object({ modelName: t.String(), type: t.Optional(t.String()), endpoint: t.Optional(t.String()), displayName: t.Optional(t.String()), tags: t.Optional(t.Array(t.String())) }) })

    // --- Update Model Metadata ---
    .put('/models-meta/:id', async ({ params: { id }, body, set }: ElysiaCtx) => {
        const b = body as Record<string, any>;
        try {
            const [result] = await sql`
                UPDATE model_metadata
                SET model_name = COALESCE(${b.modelName}, model_name),
                    type = COALESCE(${b.type}, type),
                    endpoint = COALESCE(${b.endpoint}, endpoint),
                    display_name = COALESCE(${b.displayName}, display_name),
                    tags = COALESCE(${b.tags}, tags),
                    updated_at = NOW()
                WHERE id = ${Number(id)}
                RETURNING *
            `;
            if (!result) { set.status = 404; return { success: false, message: 'Not found' }; }
            await refreshAllCaches();
            return result;
        } catch (e: unknown) {
            set.status = 500;
            return { success: false, message: getErrorMessage(e) };
        }
    })

    // --- Delete Model Metadata ---
    .delete('/models-meta/:id', async ({ params: { id }, set }: ElysiaCtx) => {
        const [result] = await sql`DELETE FROM model_metadata WHERE id = ${Number(id)} RETURNING id`;
        if (!result) { set.status = 404; return { success: false, message: 'Not found' }; }
        await refreshAllCaches();
        return { success: true };
    })

    // --- Missing Models Detection ---
    .get('/models-meta/missing', async () => {
        const rows = await sql`
            SELECT DISTINCT model_name FROM (
                SELECT model_name FROM logs
                WHERE created_at > NOW() - INTERVAL '7 days'
                EXCEPT
                SELECT model_name FROM model_metadata
            ) sub
            ORDER BY model_name
        `;
        return { success: true, missing: rows.map((r: any) => r.model_name), count: rows.length };
    })

    // --- Ratio Sync: Preview upstream ratios ---
    .get('/ratio-sync/preview', async ({ query }: ElysiaCtx) => {
        // Show current model ratios from option cache
        const { optionCache } = await import('../../services/optionCache');
        const modelRatio = optionCache.get('ModelRatio', {}) as Record<string, number>;
        const completionRatio = optionCache.get('CompletionRatio', {}) as Record<string, number>;
        const groupRatio = optionCache.get('GroupRatio', {}) as Record<string, number>;

        return {
            success: true,
            modelRatio,
            completionRatio,
            groupRatio,
            modelCount: Object.keys(modelRatio).length,
            groupCount: Object.keys(groupRatio).length
        };
    })

    // --- Ratio Sync: Update model ratio ---
    .post('/ratio-sync/update', async ({ body, set }: ElysiaCtx) => {
        const b = body as Record<string, any>;
        try {
            if (b.modelRatio) {
                await sql`INSERT INTO options (key, value) VALUES ('ModelRatio', ${JSON.stringify(b.modelRatio)}) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`;
            }
            if (b.completionRatio) {
                await sql`INSERT INTO options (key, value) VALUES ('CompletionRatio', ${JSON.stringify(b.completionRatio)}) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`;
            }
            if (b.groupRatio) {
                await sql`INSERT INTO options (key, value) VALUES ('GroupRatio', ${JSON.stringify(b.groupRatio)}) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`;
            }
            await refreshAllCaches();
            return { success: true };
        } catch (e: unknown) {
            set.status = 500;
            return { success: false, message: getErrorMessage(e) };
        }
    });
