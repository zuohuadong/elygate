import type { ElysiaCtx } from '../../types';
import { Elysia, t } from 'elysia';
import { sql } from '@elygate/db';
import { log } from '../../services/logger';
import { getErrorMessage } from '../../utils/error';
import { refreshAllCaches } from './index';

/**
 * Vendor metadata management.
 * Vendors are provider-level metadata entries (name, type, base_url, logo, description)
 * used for display and organization in admin UI.
 */
export const vendorsRouter = new Elysia()
    .get('/vendors', async () => {
        const rows = await sql`
            SELECT id, name, type, base_url, logo_url, description, config, created_at, updated_at
            FROM vendors
            ORDER BY name ASC
        `;
        return rows;
    })
    .get('/vendors/search', async ({ query }: ElysiaCtx) => {
        const keyword = (query?.keyword || '').trim();
        if (!keyword) return [];
        return await sql`
            SELECT id, name, type, base_url, logo_url, description
            FROM vendors
            WHERE name ILIKE ${'%' + keyword + '%'} OR type::text ILIKE ${'%' + keyword + '%'}
            ORDER BY name ASC LIMIT 50
        `;
    })
    .get('/vendors/:id', async ({ params: { id }, set }: ElysiaCtx) => {
        const [row] = await sql`
            SELECT * FROM vendors WHERE id = ${Number(id)} LIMIT 1
        `;
        if (!row) {
            set.status = 404;
            return { success: false, message: 'Vendor not found' };
        }
        return row;
    })
    .post('/vendors', async ({ body, set }: ElysiaCtx) => {
        try {
            const b = body as Record<string, any>;
            const [result] = await sql`
                INSERT INTO vendors (name, type, base_url, logo_url, description, config)
                VALUES (${b.name}, ${b.type || 0}, ${b.baseUrl || ''}, ${b.logoUrl || ''}, ${b.description || ''}, ${b.config || '{}'})
                RETURNING *
            `;
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
    .put('/vendors', async ({ body, set }: ElysiaCtx) => {
        try {
            const b = body as Record<string, any>;
            if (!b.id) {
                set.status = 400;
                return { success: false, message: 'id is required' };
            }
            const [existing] = await sql`SELECT * FROM vendors WHERE id = ${Number(b.id)} LIMIT 1`;
            if (!existing) {
                set.status = 404;
                return { success: false, message: 'Vendor not found' };
            }
            const [result] = await sql`
                UPDATE vendors
                SET name = ${b.name ?? existing.name},
                    type = ${b.type ?? existing.type},
                    base_url = ${b.baseUrl ?? existing.base_url},
                    logo_url = ${b.logoUrl ?? existing.logo_url},
                    description = ${b.description ?? existing.description},
                    config = ${b.config ?? existing.config},
                    updated_at = NOW()
                WHERE id = ${Number(b.id)}
                RETURNING *
            `;
            return result;
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
            await sql`DELETE FROM vendors WHERE id = ${Number(id)}`;
            return { success: true };
        } catch (e: unknown) {
            set.status = 500;
            return { success: false, message: getErrorMessage(e) };
        }
    });
