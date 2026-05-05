import type { ElysiaCtx } from '../../types';
import { Elysia, t } from 'elysia';
import { db, sql } from '@elygate/db';
import { modelMetadata, options } from '@elygate/db/schema';
import { eq, asc, sql as drizzleSql } from 'drizzle-orm';
import { getErrorMessage } from '../../utils/error';
import { refreshAllCaches } from './index';

export const modelsAdminRouter = new Elysia()
    // --- List All Model Metadata ---
    .get('/models-meta', async ({ query }: ElysiaCtx) => {
        const search = (query?.keyword || '').trim();
        const type = query?.type;
        const q = db.select().from(modelMetadata).$dynamic();
        const conditions = [];
        if (search) conditions.push(drizzleSql`${modelMetadata.modelName} ILIKE ${'%' + search + '%'}`);
        if (type) conditions.push(eq(modelMetadata.type, type));
        if (conditions.length > 0) q.where(drizzleSql.join(conditions, drizzleSql` AND `));
        return await q.orderBy(asc(modelMetadata.modelName)).limit(500);
    })

    // --- Get Single Model Metadata ---
    .get('/models-meta/:id', async ({ params: { id }, set }: ElysiaCtx) => {
        const [row] = await db.select().from(modelMetadata).where(eq(modelMetadata.id, Number(id))).limit(1);
        if (!row) { set.status = 404; return { success: false, message: 'Not found' }; }
        return row;
    })

    // --- Create Model Metadata ---
    .post('/models-meta', async ({ body, set }: ElysiaCtx) => {
        const b = body as Record<string, any>;
        try {
            const [result] = await db.insert(modelMetadata).values({
                modelName: b.modelName,
                type: b.type || 'chat',
                endpoint: b.endpoint || null,
                displayName: b.displayName || null,
                tags: b.tags || [],
            }).returning();
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
            const setValues: Record<string, any> = { updatedAt: new Date() };
            if (b.modelName !== undefined) setValues.modelName = b.modelName;
            if (b.type !== undefined) setValues.type = b.type;
            if (b.endpoint !== undefined) setValues.endpoint = b.endpoint;
            if (b.displayName !== undefined) setValues.displayName = b.displayName;
            if (b.tags !== undefined) setValues.tags = b.tags;

            const [result] = await db.update(modelMetadata).set(setValues)
                .where(eq(modelMetadata.id, Number(id))).returning();
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
        const [result] = await db.delete(modelMetadata).where(eq(modelMetadata.id, Number(id))).returning();
        if (!result) { set.status = 404; return { success: false, message: 'Not found' }; }
        await refreshAllCaches();
        return { success: true };
    })

    // --- Missing Models Detection ---
    .get('/models-meta/missing', async () => {
        const rows = await db.selectDistinct({ modelName: modelMetadata.modelName })
            .from(modelMetadata)
            .where(drizzleSql`${modelMetadata.createdAt} > NOW() - INTERVAL '7 days'`);
        // EXCEPT query — Drizzle cannot express this natively
        const missingRows = await sql`
            SELECT DISTINCT model_name FROM (
                SELECT model_name FROM logs
                WHERE created_at > NOW() - INTERVAL '7 days'
                EXCEPT
                SELECT model_name FROM model_metadata
            ) sub
            ORDER BY model_name
        `;
        return { success: true, missing: missingRows.map((r: any) => r.model_name), count: missingRows.length };
    })

    // --- Ratio Sync: Preview upstream ratios ---
    .get('/ratio-sync/preview', async ({ query }: ElysiaCtx) => {
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
                await db.insert(options).values({ key: 'ModelRatio', value: JSON.stringify(b.modelRatio) })
                    .onConflictDoUpdate({ target: options.key, set: { value: JSON.stringify(b.modelRatio) } });
            }
            if (b.completionRatio) {
                await db.insert(options).values({ key: 'CompletionRatio', value: JSON.stringify(b.completionRatio) })
                    .onConflictDoUpdate({ target: options.key, set: { value: JSON.stringify(b.completionRatio) } });
            }
            if (b.groupRatio) {
                await db.insert(options).values({ key: 'GroupRatio', value: JSON.stringify(b.groupRatio) })
                    .onConflictDoUpdate({ target: options.key, set: { value: JSON.stringify(b.groupRatio) } });
            }
            await refreshAllCaches();
            return { success: true };
        } catch (e: unknown) {
            set.status = 500;
            return { success: false, message: getErrorMessage(e) };
        }
    });
