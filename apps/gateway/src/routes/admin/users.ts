import type { ElysiaCtx } from '../../types';
import { Elysia } from 'elysia';
import { getErrorMessage } from '../../utils/error';
import { sql } from '@elygate/db';
import { optionCache } from '../../services/optionCache';
import { getLangFromHeader } from '../../utils/i18n';

export const usersRouter = new Elysia()
    // --- Token Management ---
    .get('/tokens', async () => {
        const tokens = await sql`
            SELECT t.id, t.name, t.key, t.status, t.remain_quota, t.used_quota, t.created_at, t.models, t.user_id, u.username as creator_name
            FROM tokens t
            LEFT JOIN users u ON t.user_id = u.id
            ORDER BY t.id DESC
        `;
        return tokens.map((t: Record<string, any>) => ({
            id: t.id,
            name: t.name,
            key: t.key,
            status: t.status,
            remainQuota: t.remain_quota,
            usedQuota: t.used_quota,
            models: t.models,
            createdAt: t.created_at,
            userId: t.user_id,
            creatorName: t.creator_name
        }));
    })

    .post('/tokens', async ({ body, user, set }: any) => {
        try {
            const b = body as Record<string, any>;
            const newKey = `sk-${Bun.randomUUIDv7('hex')}`;
            const [result] = await sql`
                INSERT INTO tokens (user_id, name, key, status, remain_quota, models)
                VALUES (${b.userId || user.id}, ${b.name}, ${newKey}, 1, ${b.remainQuota || -1}, ${Array.isArray(b.models) ? JSON.stringify(b.models) : JSON.stringify(b.models || [])})
                RETURNING *
            `;
            return result;
        } catch (e: unknown) {
            set.status = 500;
            return { success: false, message: getErrorMessage(e) };
        }
    })

    .put('/tokens/:id', async ({ params: { id }, body, set }: any) => {
        try {
            const b = body as Record<string, any>;
            const [oldToken] = await sql`SELECT * FROM tokens WHERE id = ${Number(id)} LIMIT 1`;
            if (!oldToken) {
                set.status = 404;
                return { success: false, message: 'Token not found' };
            }

            let finalModels = oldToken.models;
            if (b.models !== undefined) {
                finalModels = Array.isArray(b.models) ? JSON.stringify(b.models) : b.models;
            }

            const [result] = await sql`
                UPDATE tokens 
                SET name = ${b.name ?? oldToken.name},
                    status = ${b.status ?? oldToken.status},
                    remain_quota = ${b.remainQuota ?? oldToken.remain_quota},
                    models = ${finalModels}
                WHERE id = ${Number(id)}
                RETURNING *
            `;
            return result;
        } catch (e: unknown) {
            set.status = 500;
            return { success: false, message: getErrorMessage(e) };
        }
    })

    .post('/tokens/:id/regenerate', async ({ params: { id }, set }: any) => {
        try {
            const [oldToken] = await sql`SELECT * FROM tokens WHERE id = ${Number(id)} LIMIT 1`;
            if (!oldToken) {
                set.status = 404;
                return { success: false, message: 'Token not found' };
            }

            const newKey = `sk-${Bun.randomUUIDv7('hex')}`;
            const [result] = await sql`
                UPDATE tokens 
                SET key = ${newKey},
                    updated_at = NOW()
                WHERE id = ${Number(id)}
                RETURNING *
            `;

            return { success: true, message: 'Token key regenerated successfully', token: result };
        } catch (e: unknown) {
            set.status = 500;
            return { success: false, message: getErrorMessage(e) };
        }
    })

    .delete('/tokens/:id', async ({ params: { id }, set }: any) => {
        try {
            await sql`DELETE FROM tokens WHERE id = ${Number(id)}`;
            return { success: true };
        } catch (e: unknown) {
            set.status = 500;
            return { success: false, message: getErrorMessage(e) };
        }
    })

    // --- User Management ---
    .get('/users', async () => {
        const users = await sql`
            SELECT id, username, role, quota, used_quota as "usedQuota", status, created_at, updated_at
            FROM users 
            ORDER BY id DESC
        `;
        return users;
    })

    .post('/users', async ({ body, set }: any) => {
        try {
            const b = body as Record<string, any>;
            const passwordHash = await Bun.password.hash(b.password);
            const defaultCurrency = optionCache.get('CurrencyName', 'USD');
            const [result] = await sql`
                INSERT INTO users (username, password_hash, role, quota, status, currency)
                VALUES (${b.username}, ${passwordHash}, ${b.role || 1}, ${b.quota || 0}, 1, ${defaultCurrency})
                RETURNING id, username, role, quota, status, currency
            `;
            return result;
        } catch (e: unknown) {
            set.status = 500;
            return { success: false, message: getErrorMessage(e) };
        }
    })

    .put('/users/:id', async ({ params: { id }, body, set }: any) => {
        try {
            const b = body as Record<string, any>;
            let passwordClause = sql``;
            if (b.password) {
                const hash = await Bun.password.hash(b.password);
                passwordClause = sql`, password_hash = ${hash}`;
            }

            const [result] = await sql`
                UPDATE users 
                SET username = COALESCE(${b.username}, username),
                    role = COALESCE(${b.role}, role),
                    quota = COALESCE(${b.quota}, quota),
                    currency = COALESCE(${b.currency}, currency),
                    status = COALESCE(${b.status}, status),
                    updated_at = NOW()
                    ${passwordClause}
                WHERE id = ${Number(id)}
                RETURNING id, username, role, quota, currency, status
            `;

            // Notify auth cache to flush tokens for this user
            const tokens = await sql`SELECT key FROM tokens WHERE user_id = ${Number(id)}`;
            for (const t of tokens) {
                await sql`SELECT pg_notify('auth_update', ${t.key})`;
            }

            return result;
        } catch (e: unknown) {
            set.status = 500;
            return { success: false, message: getErrorMessage(e) };
        }
    })

    .delete('/users/:id', async ({ params: { id }, user, set, request }: any) => {
        const lang = getLangFromHeader(request.headers.get('accept-language'));

        if (Number(id) === user.id) {
            set.status = 400;
            return { success: false, message: lang === 'zh' ? '不能删除自己的账户' : 'Cannot delete your own account' };
        }

        const [adminCount] = await sql`SELECT COUNT(*) as count FROM users WHERE role >= 10 AND status = 1`;
        const [targetUser] = await sql`SELECT role FROM users WHERE id = ${Number(id)}`;

        if (targetUser && targetUser.role >= 10 && Number(adminCount.count) <= 1) {
            set.status = 400;
            return { success: false, message: lang === 'zh' ? '不能删除最后一个管理员账户' : 'Cannot delete the last admin account' };
        }

        await sql`DELETE FROM users WHERE id = ${Number(id)}`;
        return { success: true, message: lang === 'zh' ? '删除成功' : 'Deleted successfully' };
    });
