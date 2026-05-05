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
            SELECT t.id, t.name, t.key, t.status, t.remain_quota, t.used_quota, t.created_at, t.updated_at, t.models,
                   t.subnet, t.allow_ips, t.rate_limit, t.expired_at, t.unlimited_quota, t.model_limits_enabled,
                   t.token_group, t.cross_group_retry, t.accessed_at, t.user_id, u.username as creator_name
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
            subnet: t.subnet,
            allowIps: t.allow_ips,
            rateLimit: t.rate_limit,
            expiredAt: t.expired_at,
            unlimitedQuota: t.unlimited_quota,
            modelLimitsEnabled: t.model_limits_enabled,
            tokenGroup: t.token_group,
            crossGroupRetry: t.cross_group_retry,
            accessedAt: t.accessed_at,
            createdAt: t.created_at,
            updatedAt: t.updated_at,
            userId: t.user_id,
            creatorName: t.creator_name
        }));
    })

    .get('/tokens/:id', async ({ params: { id }, set }: ElysiaCtx) => {
        const [token] = await sql`
            SELECT t.id, t.name, t.key, t.status, t.remain_quota, t.used_quota, t.created_at, t.updated_at, t.models,
                   t.subnet, t.allow_ips, t.rate_limit, t.expired_at, t.unlimited_quota, t.model_limits_enabled,
                   t.token_group, t.cross_group_retry, t.accessed_at, t.user_id, u.username as creator_name
            FROM tokens t
            LEFT JOIN users u ON t.user_id = u.id
            WHERE t.id = ${Number(id)}
            LIMIT 1
        `;
        if (!token) {
            set.status = 404;
            return { success: false, message: 'Token not found' };
        }
        return {
            id: token.id,
            name: token.name,
            key: token.key,
            status: token.status,
            remainQuota: token.remain_quota,
            usedQuota: token.used_quota,
            models: token.models,
            subnet: token.subnet,
            allowIps: token.allow_ips,
            rateLimit: token.rate_limit,
            expiredAt: token.expired_at,
            unlimitedQuota: token.unlimited_quota,
            modelLimitsEnabled: token.model_limits_enabled,
            tokenGroup: token.token_group,
            crossGroupRetry: token.cross_group_retry,
            accessedAt: token.accessed_at,
            createdAt: token.created_at,
            updatedAt: token.updated_at,
            userId: token.user_id,
            creatorName: token.creator_name
        };
    })

    .post('/tokens', async ({ body, user, set }: ElysiaCtx) => {
        try {
            const b = body as Record<string, any>;
            const newKey = `sk-${Bun.randomUUIDv7('hex')}`;
            const [result] = await sql`
                INSERT INTO tokens (
                    user_id, name, key, status, remain_quota, models, subnet, allow_ips, rate_limit, expired_at,
                    unlimited_quota, model_limits_enabled, token_group, cross_group_retry
                )
                VALUES (
                    ${b.userId || user.id}, ${b.name}, ${newKey}, ${b.status || 1}, ${b.remainQuota ?? -1},
                    ${Array.isArray(b.models) ? JSON.stringify(b.models) : JSON.stringify(b.models || [])},
                    ${b.subnet || b.allowIps || null}, ${b.allowIps || b.subnet || null}, ${b.rateLimit || 0}, ${b.expiredAt || null},
                    ${Boolean(b.unlimitedQuota)}, ${Boolean(b.modelLimitsEnabled)}, ${b.tokenGroup || null}, ${Boolean(b.crossGroupRetry)}
                )
                RETURNING *
            `;
            return result;
        } catch (e: unknown) {
            set.status = 500;
            return { success: false, message: getErrorMessage(e) };
        }
    })

    .put('/tokens/:id', async ({ params: { id }, body, set }: ElysiaCtx) => {
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
                    models = ${finalModels},
                    subnet = ${b.subnet ?? oldToken.subnet},
                    allow_ips = ${b.allowIps ?? oldToken.allow_ips},
                    rate_limit = ${b.rateLimit ?? oldToken.rate_limit},
                    expired_at = ${b.expiredAt ?? oldToken.expired_at},
                    unlimited_quota = ${b.unlimitedQuota ?? oldToken.unlimited_quota},
                    model_limits_enabled = ${b.modelLimitsEnabled ?? oldToken.model_limits_enabled},
                    token_group = ${b.tokenGroup ?? oldToken.token_group},
                    cross_group_retry = ${b.crossGroupRetry ?? oldToken.cross_group_retry},
                    updated_at = NOW()
                WHERE id = ${Number(id)}
                RETURNING *
            `;
            return result;
        } catch (e: unknown) {
            set.status = 500;
            return { success: false, message: getErrorMessage(e) };
        }
    })

    .post('/tokens/:id/regenerate', async ({ params: { id }, set }: ElysiaCtx) => {
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

    .delete('/tokens/:id', async ({ params: { id }, set }: ElysiaCtx) => {
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

    .get('/users/:id', async ({ params: { id }, set }: ElysiaCtx) => {
        const [user] = await sql`
            SELECT id, username, role, quota, used_quota as "usedQuota", status, created_at, updated_at
            FROM users 
            WHERE id = ${Number(id)}
            LIMIT 1
        `;
        if (!user) {
            set.status = 404;
            return { success: false, message: 'User not found' };
        }
        return user;
    })

    .post('/users', async ({ body, set }: ElysiaCtx) => {
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

    .put('/users/:id', async ({ params: { id }, body, set }: ElysiaCtx) => {
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

    .delete('/users/:id', async ({ params: { id }, user, set, request }: ElysiaCtx) => {
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
