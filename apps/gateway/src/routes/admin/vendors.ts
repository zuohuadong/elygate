import type { ElysiaCtx } from '../../types';
import { Elysia, t } from 'elysia';
import { db } from '@elygate/db';
import { vendors } from '@elygate/db/schema';
import { eq, sql as drizzleSql, asc } from 'drizzle-orm';
import { getErrorMessage } from '../../utils/error';

async function updateVendor(id: number, body: Record<string, any>, set: ElysiaCtx['set']) {
    if (!Number.isInteger(id) || id <= 0) {
        set.status = 400;
        return { success: false, message: 'valid id is required' };
    }
    const [existing] = await db.select().from(vendors).where(eq(vendors.id, id)).limit(1);
    if (!existing) {
        set.status = 404;
        return { success: false, message: 'Vendor not found' };
    }
    const [result] = await db.update(vendors).set({
        name: body.name ?? existing.name,
        type: body.type ?? existing.type,
        baseUrl: body.baseUrl ?? existing.baseUrl,
        logoUrl: body.logoUrl ?? existing.logoUrl,
        description: body.description ?? existing.description,
        config: body.config ?? existing.config,
        updatedAt: new Date(),
    }).where(eq(vendors.id, id)).returning();
    return result;
}

export const vendorsRouter = new Elysia()
    .get('/vendors', async () => {
        return await db.select().from(vendors).orderBy(asc(vendors.name));
    })
    .get('/vendors/search', async ({ query }: ElysiaCtx) => {
        const keyword = (query?.keyword || '').trim();
        if (!keyword) return [];
        return await db.select({
            id: vendors.id,
            name: vendors.name,
            type: vendors.type,
            baseUrl: vendors.baseUrl,
            logoUrl: vendors.logoUrl,
            description: vendors.description,
        }).from(vendors)
            .where(drizzleSql`${vendors.name} ILIKE ${'%' + keyword + '%'} OR ${vendors.type}::text ILIKE ${'%' + keyword + '%'}`)
            .orderBy(asc(vendors.name))
            .limit(50);
    })
    .get('/vendors/:id', async ({ params: { id }, set }: ElysiaCtx) => {
        const [row] = await db.select().from(vendors).where(eq(vendors.id, Number(id))).limit(1);
        if (!row) {
            set.status = 404;
            return { success: false, message: 'Vendor not found' };
        }
        return row;
    })
    .post('/vendors', async ({ body, set }: ElysiaCtx) => {
        try {
            const b = body as Record<string, any>;
            const [result] = await db.insert(vendors).values({
                name: b.name,
                type: b.type || 0,
                baseUrl: b.baseUrl || '',
                logoUrl: b.logoUrl || '',
                description: b.description || '',
                config: b.config || {},
            }).returning();
            return result;
        } catch (e: unknown) {
            set.status = 500;
            return { success: false, message: getErrorMessage(e) };
        }
    }, {
        body: t.Object({
            name: t.String(),
            type: t.Optional(t.Number()),
            baseUrl: t.Optional(t.String()),
            logoUrl: t.Optional(t.String()),
            description: t.Optional(t.String()),
            config: t.Optional(t.Any()),
        })
    })
    .put('/vendors/:id', async ({ params: { id }, body, set }: ElysiaCtx) => {
        try {
            return await updateVendor(Number(id), body as Record<string, any>, set);
        } catch (e: unknown) {
            set.status = 500;
            return { success: false, message: getErrorMessage(e) };
        }
    }, {
        body: t.Object({
            name: t.Optional(t.String()),
            type: t.Optional(t.Number()),
            baseUrl: t.Optional(t.String()),
            logoUrl: t.Optional(t.String()),
            description: t.Optional(t.String()),
            config: t.Optional(t.Any()),
        })
    })
    .put('/vendors', async ({ body, set }: ElysiaCtx) => {
        try {
            const b = body as Record<string, any>;
            return await updateVendor(Number(b.id), b, set);
        } catch (e: unknown) {
            set.status = 500;
            return { success: false, message: getErrorMessage(e) };
        }
    }, {
        body: t.Object({
            id: t.Number(),
            name: t.Optional(t.String()),
            type: t.Optional(t.Number()),
            baseUrl: t.Optional(t.String()),
            logoUrl: t.Optional(t.String()),
            description: t.Optional(t.String()),
            config: t.Optional(t.Any()),
        })
    })
    .delete('/vendors/:id', async ({ params: { id }, set }: ElysiaCtx) => {
        try {
            await db.delete(vendors).where(eq(vendors.id, Number(id)));
            return { success: true };
        } catch (e: unknown) {
            set.status = 500;
            return { success: false, message: getErrorMessage(e) };
        }
    });
