import type { ElysiaCtx } from '../../types';
import { Elysia } from 'elysia';
import { sql } from '@elygate/db';
import { adminGuard, authPlugin } from '../../middleware/auth';
import { optionCache } from '../../services/optionCache';
import { ChannelType } from '../../types';

/**
 * New API compatible user/subscription/announcement/ollama routes.
 * These are separate from the main newApiCompat to keep the chain intact.
 */

export const newApiUserAdminRouter = new Elysia()
    .use(adminGuard)

    // User management (New API: /api/user)
    .get('/user', async () => {
        return await sql`SELECT id, username, email, role, quota, used_quota AS "usedQuota", "group", status, currency, created_at AS "createdAt" FROM users ORDER BY id DESC`;
    })
    .get('/user/:id', async ({ params: { id }, set }: ElysiaCtx) => {
        const [row] = await sql`SELECT id, username, email, role, quota, used_quota AS "usedQuota", "group", status, currency, created_at AS "createdAt" FROM users WHERE id = ${Number(id)} LIMIT 1`;
        if (!row) { set.status = 404; return { success: false, message: 'User not found' }; }
        return { success: true, data: row };
    })
    .post('/user', async ({ body, set }: ElysiaCtx) => {
        const b = body as Record<string, any>;
        if (!b.username) { set.status = 400; return { success: false, message: 'username is required' }; }
        const password = b.password || Bun.randomUUIDv7('hex').substring(0, 12);
        const hash = await Bun.password.hash(password);
        const quota = Number(b.quota ?? 0);
        try {
            const [row] = await sql`
                INSERT INTO users (username, email, password_hash, role, quota, "group", status, currency)
                VALUES (${b.username}, ${b.email || null}, ${hash}, ${Number(b.role || 1)}, ${quota}, ${b.group || 'default'}, ${Number(b.status || 1)}, ${b.currency || 'USD'})
                RETURNING id, username, email, role, quota, "group", status, currency, created_at AS "createdAt"
            `;
            return { success: true, data: row, password };
        } catch (e: unknown) {
            set.status = 500;
            return { success: false, message: e instanceof Error ? e.message : String(e) };
        }
    })
    .put('/user', async ({ body, set }: ElysiaCtx) => {
        const b = body as Record<string, any>;
        const id = Number(b.id);
        if (!id) { set.status = 400; return { success: false, message: 'id is required' }; }
        const [old] = await sql`SELECT * FROM users WHERE id = ${id} LIMIT 1`;
        if (!old) { set.status = 404; return { success: false, message: 'User not found' }; }
        const passwordHash = b.password ? await Bun.password.hash(String(b.password)) : old.password_hash;
        const [row] = await sql`
            UPDATE users SET
                email = ${b.email ?? old.email},
                password_hash = ${passwordHash},
                role = ${Number(b.role ?? old.role)},
                quota = ${Number(b.quota ?? old.quota)},
                "group" = ${b.group ?? old.group},
                status = ${Number(b.status ?? old.status)},
                currency = ${b.currency ?? old.currency},
                updated_at = NOW()
            WHERE id = ${id}
            RETURNING id, username, email, role, quota, "group", status, currency, updated_at AS "updatedAt"
        `;
        return { success: true, data: row };
    })
    .delete('/user/:id', async ({ params: { id }, set }: ElysiaCtx) => {
        const [row] = await sql`DELETE FROM users WHERE id = ${Number(id)} AND role != 10 RETURNING id`;
        if (!row) { set.status = 403; return { success: false, message: 'Cannot delete admin user or user not found' }; }
        return { success: true, deleted: row.id };
    })
    .get('/user/search', async ({ query }: ElysiaCtx) => {
        const keyword = (query?.keyword || '').trim();
        return await sql`
            SELECT id, username, email, role, quota, used_quota AS "usedQuota", "group", status, currency, created_at AS "createdAt"
            FROM users
            WHERE username ILIKE ${'%' + keyword + '%'} OR email ILIKE ${'%' + keyword + '%'} OR CAST(id AS TEXT) ILIKE ${'%' + keyword + '%'}
            ORDER BY id DESC LIMIT 100
        `;
    })

    // Subscription management (New API: /api/subscription)
    .get('/subscription', async () => {
        const rows = await sql`
            SELECT us.id, us.user_id AS "userId", us.package_id AS "packageId", us.start_time AS "startTime", us.end_time AS "endTime",
                   us.status, us.quota_granted AS "quotaGranted", us.quota_used AS "quotaUsed", us.last_reset_at AS "lastResetAt",
                   p.name AS "packageName", u.username
            FROM user_subscriptions us
            LEFT JOIN packages p ON us.package_id = p.id
            LEFT JOIN users u ON us.user_id = u.id
            ORDER BY us.id DESC LIMIT 200
        `;
        return rows;
    })
    .post('/subscription/bind', async ({ body, set }: ElysiaCtx) => {
        const b = body as Record<string, any>;
        const userId = Number(b.userId || b.user_id);
        const packageId = Number(b.packageId || b.package_id);
        if (!userId || !packageId) { set.status = 400; return { success: false, message: 'userId and packageId required' }; }
        const [pkg] = await sql`SELECT * FROM packages WHERE id = ${packageId} LIMIT 1`;
        if (!pkg) { set.status = 404; return { success: false, message: 'Package not found' }; }
        const startTime = new Date();
        const endTime = new Date(Date.now() + (pkg.duration_days || 30) * 86400000);
        const [row] = await sql`
            INSERT INTO user_subscriptions (user_id, package_id, start_time, end_time, status, quota_granted)
            VALUES (${userId}, ${packageId}, ${startTime}, ${endTime}, 1, ${pkg.cycle_quota || pkg.price || 0})
            RETURNING id, user_id, package_id, start_time, end_time, status
        `;
        if (pkg.cycle_quota) {
            await sql`UPDATE users SET quota = quota + ${pkg.cycle_quota} WHERE id = ${userId}`;
        }
        return { success: true, data: row };
    })

    // Announcement management (New API: /api/announcement)
    .get('/announcement', async () => {
        const rows = await sql`SELECT id, title, content, tag, created_at AS "createdAt", updated_at AS "updatedAt" FROM announcements ORDER BY id DESC LIMIT 100`;
        return rows;
    })
    .post('/announcement', async ({ body, set }: ElysiaCtx) => {
        const b = body as Record<string, any>;
        if (!b.title) { set.status = 400; return { success: false, message: 'title is required' }; }
        const [row] = await sql`
            INSERT INTO announcements (title, content, tag) VALUES (${b.title}, ${b.content || ''}, ${b.tag || null})
            RETURNING id, title, content, tag, created_at AS "createdAt"
        `;
        return { success: true, data: row };
    })
    .put('/announcement', async ({ body, set }: ElysiaCtx) => {
        const b = body as Record<string, any>;
        const id = Number(b.id);
        if (!id) { set.status = 400; return { success: false, message: 'id is required' }; }
        const [old] = await sql`SELECT * FROM announcements WHERE id = ${id} LIMIT 1`;
        if (!old) { set.status = 404; return { success: false, message: 'Announcement not found' }; }
        const [row] = await sql`
            UPDATE announcements SET title = ${b.title ?? old.title}, content = ${b.content ?? old.content}, tag = ${b.tag ?? old.tag}, updated_at = NOW()
            WHERE id = ${id} RETURNING id, title, content, tag, updated_at AS "updatedAt"
        `;
        return { success: true, data: row };
    })
    .delete('/announcement/:id', async ({ params: { id }, set }: ElysiaCtx) => {
        const [row] = await sql`DELETE FROM announcements WHERE id = ${Number(id)} RETURNING id`;
        if (!row) { set.status = 404; return { success: false, message: 'Not found' }; }
        return { success: true, deleted: row.id };
    })

    // Log cleanup (New API: /api/log/clean)
    .delete('/log/clean', async ({ query, set }: ElysiaCtx) => {
        const retentionDays = Number(query?.retention_days || query?.retentionDays) || Number(optionCache.get('LogRetentionDays', 7));
        const cutoff = new Date(Date.now() - retentionDays * 86400000);
        const result = await sql`DELETE FROM logs WHERE created_at < ${cutoff}`;
        return { success: true, deleted: result.count || 0, retentionDays };
    })

    // Ollama pull/delete proxy
    .post('/channel/:id/ollama/pull', async ({ params: { id }, body, set }: ElysiaCtx) => {
        const [channel] = await sql`SELECT id, name, type, base_url, key FROM channels WHERE id = ${Number(id)} LIMIT 1`;
        if (!channel) { set.status = 404; return { success: false, message: 'Channel not found' }; }
        if (Number(channel.type) !== ChannelType.OLLAMA) { set.status = 400; return { success: false, message: 'Not an Ollama channel' }; }
        const b = body as Record<string, any>;
        const modelName = b.model || b.name;
        if (!modelName) { set.status = 400; return { success: false, message: 'model name required' }; }
        const baseUrl = String(channel.base_url || '').replace(/\/+$/, '');
        try {
            const res = await fetch(`${baseUrl}/api/pull`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: modelName, stream: false }),
            });
            const data = await res.json();
            return { success: res.ok, data };
        } catch (e: unknown) {
            set.status = 502;
            return { success: false, message: e instanceof Error ? e.message : String(e) };
        }
    })
    .delete('/channel/:id/ollama/:model', async ({ params: { id, model: modelName }, set }: ElysiaCtx) => {
        const [channel] = await sql`SELECT id, type, base_url FROM channels WHERE id = ${Number(id)} LIMIT 1`;
        if (!channel) { set.status = 404; return { success: false, message: 'Channel not found' }; }
        if (Number(channel.type) !== ChannelType.OLLAMA) { set.status = 400; return { success: false, message: 'Not an Ollama channel' }; }
        const baseUrl = String(channel.base_url || '').replace(/\/+$/, '');
        try {
            const res = await fetch(`${baseUrl}/api/delete`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: modelName }),
            });
            return { success: res.ok, status: res.status };
        } catch (e: unknown) {
            set.status = 502;
            return { success: false, message: e instanceof Error ? e.message : String(e) };
        }
    });

export const newApiUserSelfRouter = new Elysia()
    .use(authPlugin)
    // User self-service announcements (public readable)
    .get('/announcement/public', async () => {
        const rows = await sql`SELECT id, title, content, tag, created_at AS "createdAt" FROM announcements ORDER BY id DESC LIMIT 20`;
        return { success: true, data: rows };
    });
