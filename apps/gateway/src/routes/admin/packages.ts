import type { ElysiaCtx } from '../../types';
import { Elysia, t } from 'elysia';
import { getErrorMessage } from '../../utils/error';
import { sql } from '@elygate/db';
import { refreshAllCaches } from './index';
import { checkAndResetSubscriptionQuota } from '../../services/subscription';

export const packagesRouter = new Elysia()
    // --- Redemptions (CDK) ---
    .get('/redemptions', async () => {
        return await sql`SELECT * FROM redemptions ORDER BY id DESC`;
    })

    .post('/redemptions', async ({ body, set }: any) => {
        try {
            const b = body as Record<string, any>;
            const key = b.key || `cdk-${Bun.randomUUIDv7('hex')}`;
            const [result] = await sql`
                INSERT INTO redemptions (name, key, quota, count, status)
                VALUES (${b.name}, ${key}, ${b.quota}, ${b.count || 1}, 1)
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
            quota: t.Number(),
            key: t.Optional(t.String()),
            count: t.Optional(t.Number()),
            status: t.Optional(t.Number())
        })
    })

    .put('/redemptions/:id', async ({ params: { id }, body }: any) => {
        const [result] = await sql`
            UPDATE redemptions 
            SET name = COALESCE(${body.name}, name),
                key = COALESCE(${body.key}, key),
                quota = COALESCE(${body.quota}, quota),
                count = COALESCE(${body.count}, count),
                status = COALESCE(${body.status}, status)
            WHERE id = ${Number(id)}
            RETURNING *
        `;
        return result;
    })

    .delete('/redemptions/:id', async ({ params: { id } }) => {
        await sql`DELETE FROM redemptions WHERE id = ${Number(id)}`;
        return { success: true };
    })

    // --- Invite Codes ---
    .get('/invite-codes', async ({ query }: any) => {
        const page = Number(query?.page) || 1;
        const limit = Number(query?.limit) || 50;
        const offset = (page - 1) * limit;
        const status = query?.status;

        let whereClause = sql`WHERE 1=1`;
        if (status !== undefined && status !== '') {
            whereClause = sql`${whereClause} AND ic.status = ${Number(status)}`;
        }

        const [countRow] = await sql`SELECT COUNT(*) as total FROM invite_codes ic ${whereClause}`;
        const data = await sql`
            SELECT ic.*, u.username as creator_name
            FROM invite_codes ic
            LEFT JOIN users u ON ic.created_by = u.id
            ${whereClause}
            ORDER BY ic.id DESC
            LIMIT ${limit} OFFSET ${offset}
        `;

        return {
            data: data.map((c: Record<string, any>) => ({
                id: c.id,
                code: c.code,
                maxUses: c.max_uses,
                usedCount: c.used_count,
                giftQuota: c.gift_quota,
                status: c.status,
                expiresAt: c.expires_at,
                createdBy: c.created_by,
                creatorName: c.creator_name,
                createdAt: c.created_at,
                updatedAt: c.updated_at
            })),
            total: countRow.total,
            page,
            limit
        };
    })

    .post('/invite-codes', async ({ body, user, set }: any) => {
        try {
            const b = body as Record<string, any>;
            const count = b.count || 1;
            const results: Record<string, any>[] = [];

            for (let i = 0; i < count; i++) {
                const code = b.codePrefix ? `${b.codePrefix}-${Bun.randomUUIDv7('hex').substring(0, 8)}` : `inv-${Bun.randomUUIDv7('hex').substring(0, 12)}`;
                const [result] = await sql`
                    INSERT INTO invite_codes (code, max_uses, gift_quota, status, expires_at, created_by)
                    VALUES (${code}, ${b.maxUses || 1}, ${b.giftQuota || 0}, 1, ${b.expiresAt || null}, ${user.id})
                    RETURNING *
                `;
                results.push({
                    id: result.id,
                    code: result.code,
                    maxUses: result.max_uses,
                    usedCount: result.used_count,
                    giftQuota: result.gift_quota,
                    status: result.status,
                    expiresAt: result.expires_at,
                    createdAt: result.created_at
                });
            }

            return { success: true, codes: results, count: results.length };
        } catch (e: unknown) {
            set.status = 500;
            return { success: false, message: getErrorMessage(e) };
        }
    }, {
        body: t.Object({
            count: t.Optional(t.Number()),
            maxUses: t.Optional(t.Number()),
            giftQuota: t.Optional(t.Number()),
            expiresAt: t.Optional(t.String()),
            codePrefix: t.Optional(t.String())
        })
    })

    .put('/invite-codes/:id', async ({ params: { id }, body, set }: any) => {
        try {
            const b = body as Record<string, any>;
            const [oldCode] = await sql`SELECT * FROM invite_codes WHERE id = ${Number(id)} LIMIT 1`;
            if (!oldCode) {
                set.status = 404;
                return { success: false, message: 'Invite code not found' };
            }

            const [result] = await sql`
                UPDATE invite_codes 
                SET max_uses = COALESCE(${b.maxUses}, max_uses),
                    gift_quota = COALESCE(${b.giftQuota}, gift_quota),
                    status = COALESCE(${b.status}, status),
                    expires_at = ${b.expiresAt !== undefined ? b.expiresAt : oldCode.expires_at},
                    updated_at = NOW()
                WHERE id = ${Number(id)}
                RETURNING *
            `;
            return {
                success: true,
                code: {
                    id: result.id,
                    code: result.code,
                    maxUses: result.max_uses,
                    usedCount: result.used_count,
                    giftQuota: result.gift_quota,
                    status: result.status,
                    expiresAt: result.expires_at,
                    updatedAt: result.updated_at
                }
            };
        } catch (e: unknown) {
            set.status = 500;
            return { success: false, message: getErrorMessage(e) };
        }
    })

    .delete('/invite-codes/:id', async ({ params: { id }, set }: any) => {
        try {
            await sql`DELETE FROM invite_codes WHERE id = ${Number(id)}`;
            return { success: true };
        } catch (e: unknown) {
            set.status = 500;
            return { success: false, message: getErrorMessage(e) };
        }
    })

    .delete('/invite-codes/batch', async ({ body, set }: any) => {
        try {
            const ids = (body as Record<string, any>).ids as number[];
            if (!ids || ids.length === 0) {
                set.status = 400;
                return { success: false, message: 'No IDs provided' };
            }
            await sql`DELETE FROM invite_codes WHERE id IN ${sql(ids)}`;
            return { success: true, deleted: ids.length };
        } catch (e: unknown) {
            set.status = 500;
            return { success: false, message: getErrorMessage(e) };
        }
    })

    // --- Rate Limits ---
    .get('/rate-limits', async () => {
        return await sql`SELECT * FROM rate_limit_rules ORDER BY id DESC`;
    })
    .post('/rate-limits', async ({ body, set }: any) => {
        try {
            const b = body as Record<string, any>;
            const [result] = await sql`
                INSERT INTO rate_limit_rules (name, rpm, rph, concurrent)
                VALUES (${b.name}, ${b.rpm || 0}, ${b.rph || 0}, ${b.concurrent || 0})
                RETURNING *
            `;
            await refreshAllCaches();
            return { success: true, data: result };
        } catch (e: unknown) {
            set.status = 500; return { success: false, message: getErrorMessage(e) };
        }
    })
    .put('/rate-limits/:id', async ({ params: { id }, body, set }: any) => {
        try {
            const b = body as Record<string, any>;
            const [result] = await sql`
                UPDATE rate_limit_rules 
                SET name = COALESCE(${b.name}, name),
                    rpm = COALESCE(${b.rpm}, rpm),
                    rph = COALESCE(${b.rph}, rph),
                    concurrent = COALESCE(${b.concurrent}, concurrent)
                WHERE id = ${Number(id)} RETURNING *
            `;
            await refreshAllCaches();
            return { success: true, data: result };
        } catch (e: unknown) {
            set.status = 500; return { success: false, message: getErrorMessage(e) };
        }
    })
    .delete('/rate-limits/:id', async ({ params: { id }, set }: any) => {
        try {
            await sql`DELETE FROM rate_limit_rules WHERE id = ${Number(id)}`;
            await refreshAllCaches();
            return { success: true };
        } catch (e: unknown) {
            set.status = 500; return { success: false, message: getErrorMessage(e) };
        }
    })

    // --- Packages ---
    .get('/packages', async () => {
        return await sql`
            SELECT p.*, r.name as default_rate_limit_name 
            FROM packages p 
            LEFT JOIN rate_limit_rules r ON p.default_rate_limit_id = r.id 
            ORDER BY p.id DESC
        `;
    })
    .post('/packages', async ({ body, user, set }: any) => {
        try {
            const b = body as Record<string, any>;
            const [result] = await sql`
                INSERT INTO packages (name, description, price, duration_days, models, default_rate_limit_id, model_rate_limits, cycle_quota, cycle_interval, cycle_unit, cache_policy, is_public, added_by)
                VALUES (${b.name}, ${b.description || ''}, ${b.price || 0}, ${b.durationDays || 30}, ${JSON.stringify(b.models || [])}, ${b.defaultRateLimitId || null}, ${JSON.stringify(b.modelRateLimits || {})}, ${b.cycleQuota || 0}, ${b.cycleInterval || 1}, ${b.cycleUnit || 'day'}, ${JSON.stringify(b.cachePolicy || null)}, ${b.isPublic ?? true}, ${user.id})
                RETURNING *
            `;
            return { success: true, data: result };
        } catch (e: unknown) {
            set.status = 500; return { success: false, message: getErrorMessage(e) };
        }
    })
    .put('/packages/:id', async ({ params: { id }, body, set }: any) => {
        try {
            const b = body as Record<string, any>;
            const [result] = await sql`
                UPDATE packages 
                SET name = COALESCE(${b.name}, name),
                    description = COALESCE(${b.description}, description),
                    price = COALESCE(${b.price}, price),
                    duration_days = COALESCE(${b.durationDays}, duration_days),
                    models = COALESCE(${b.models ? JSON.stringify(b.models) : null}, models),
                    default_rate_limit_id = COALESCE(${b.defaultRateLimitId}, default_rate_limit_id),
                    model_rate_limits = COALESCE(${b.modelRateLimits ? JSON.stringify(b.modelRateLimits) : null}, model_rate_limits),
                    cycle_quota = COALESCE(${b.cycleQuota}, cycle_quota),
                    cycle_interval = COALESCE(${b.cycleInterval}, cycle_interval),
                    cycle_unit = COALESCE(${b.cycleUnit}, cycle_unit),
                    cache_policy = COALESCE(${b.cachePolicy ? JSON.stringify(b.cachePolicy) : null}, cache_policy),
                    is_public = COALESCE(${b.isPublic}, is_public),
                    updated_at = NOW()
                WHERE id = ${Number(id)} RETURNING *
            `;
            return { success: true, data: result };
        } catch (e: unknown) {
            set.status = 500; return { success: false, message: getErrorMessage(e) };
        }
    })
    .delete('/packages/:id', async ({ params: { id }, set }: any) => {
        try {
            await sql`DELETE FROM packages WHERE id = ${Number(id)}`;
            return { success: true };
        } catch (e: unknown) {
            set.status = 500; return { success: false, message: getErrorMessage(e) };
        }
    })

    // --- Subscription Management ---
    .get('/subscriptions', async () => {
        return await sql`
            SELECT s.*, u.username, p.name as package_name 
            FROM user_subscriptions s
            JOIN users u ON s.user_id = u.id
            JOIN packages p ON s.package_id = p.id
            ORDER BY s.id DESC LIMIT 100
        `;
    })
    .get('/users/:id/subscriptions', async ({ params: { id } }: any) => {
        return await sql`
            SELECT s.*, p.name as package_name, p.models, p.duration_days
            FROM user_subscriptions s
            JOIN packages p ON s.package_id = p.id
            WHERE s.user_id = ${Number(id)}
            ORDER BY s.id DESC
        `;
    })
    .post('/users/:id/subscriptions', async ({ params: { id }, body, set }: any) => {
        try {
            const b = body as Record<string, any>;
            const [pkg] = await sql`SELECT duration_days FROM packages WHERE id = ${b.packageId}`;
            if (!pkg) {
                set.status = 404; return { success: false, message: 'Package not found' };
            }

            const durationMs = Number(pkg.duration_days) * 24 * 60 * 60 * 1000;

            const [existingSub] = await sql`
                SELECT id, end_time 
                FROM user_subscriptions 
                WHERE user_id = ${Number(id)} 
                AND package_id = ${b.packageId}
                AND status = 1
                AND end_time > NOW()
                ORDER BY end_time DESC
                LIMIT 1
            `;

            let result;
            if (existingSub) {
                const newEndTime = new Date(existingSub.end_time.getTime() + durationMs);
                const [updated] = await sql`
                    UPDATE user_subscriptions
                    SET end_time = ${newEndTime}, updated_at = NOW()
                    WHERE id = ${existingSub.id}
                    RETURNING *
                `;
                result = updated;
            } else {
                const newEndTime = new Date(Date.now() + durationMs);
                const [inserted] = await sql`
                    INSERT INTO user_subscriptions (user_id, package_id, start_time, end_time, status)
                    VALUES (${Number(id)}, ${b.packageId}, NOW(), ${newEndTime}, 1)
                    RETURNING *
                `;
                result = inserted;
            }

            await sql`NOTIFY auth_update, ${String(id)}`;

            return { success: true, data: result };
        } catch (e: unknown) {
            set.status = 500; return { success: false, message: getErrorMessage(e) };
        }
    })
    .put('/subscriptions/:id', async ({ params: { id }, body, set }: any) => {
        try {
            const [result] = await sql`
                UPDATE user_subscriptions 
                SET status = COALESCE(${body.status}, status), updated_at = NOW() 
                WHERE id = ${Number(id)} RETURNING *
            `;
            if (result) {
                await sql`NOTIFY auth_update, ${String(result.user_id)}`;
            }
            return { success: true, data: result };
        } catch (e: unknown) {
            set.status = 500; return { success: false, message: getErrorMessage(e) };
        }
    });
