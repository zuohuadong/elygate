import type { ElysiaCtx } from '../../types';
import { Elysia, t } from 'elysia';
import { sql } from '@elygate/db';
import { authPlugin } from '../../middleware/auth';
import { optionCache } from '../../services/optionCache';
import { calculateCost } from '../../services/ratio';

/**
 * User self-service APIs (under /api/admin with authPlugin).
 * These are admin-accessible endpoints for managing user-facing features.
 */
export const userSelfServiceRouter = new Elysia()
    // --- User Self: Get own info ---
    .get('/self/info', async ({ user }: ElysiaCtx) => {
        if (!user) return { success: false, message: 'Not authenticated' };
        const [row] = await sql`
            SELECT id, username, role, quota, used_quota, "group", status, currency, created_at
            FROM users WHERE id = ${user.id}
        `;
        return { success: true, data: row };
    })

    // --- User Self: Get own tokens ---
    .get('/self/tokens', async ({ user }: ElysiaCtx) => {
        if (!user) return { success: false, message: 'Not authenticated' };
        const rows = await sql`
            SELECT id, name, key, status, remain_quota, used_quota, models, rate_limit,
                   unlimited_quota, model_limits_enabled, expired_at, created_at, accessed_at
            FROM tokens WHERE user_id = ${user.id} ORDER BY id DESC
        `;
        // Mask keys
        return {
            success: true,
            data: rows.map((r: Record<string, any>) => ({
                ...r,
                key: r.key ? r.key.substring(0, 8) + '...' + r.key.substring(r.key.length - 4) : ''
            }))
        };
    })

    // --- User Self: Create token ---
    .post('/self/tokens', async ({ user, body, set }: ElysiaCtx) => {
        if (!user) return { success: false, message: 'Not authenticated' };
        const b = body as Record<string, any>;
        const newKey = `sk-${Bun.randomUUIDv7('hex')}`;
        try {
            const [result] = await sql`
                INSERT INTO tokens (user_id, name, key, remain_quota, models, subnet, rate_limit, unlimited_quota, model_limits_enabled)
                VALUES (${user.id}, ${b.name || 'My Token'}, ${newKey}, ${b.remainQuota ?? -1},
                    ${JSON.stringify(b.models || [])}, ${b.subnet || null}, ${b.rateLimit || 0},
                    ${Boolean(b.unlimitedQuota)}, ${Boolean(b.modelLimitsEnabled)})
                RETURNING id, name, key, status, remain_quota, created_at
            `;
            return { success: true, data: result };
        } catch (e: unknown) {
            set.status = 500;
            return { success: false, message: String(e) };
        }
    }, { body: t.Object({ name: t.Optional(t.String()), remainQuota: t.Optional(t.Number()), models: t.Optional(t.Array(t.String())), rateLimit: t.Optional(t.Number()), unlimitedQuota: t.Optional(t.Boolean()), modelLimitsEnabled: t.Optional(t.Boolean()) }) })

    // --- User Self: Delete own token ---
    .delete('/self/tokens/:id', async ({ user, params: { id }, set }: ElysiaCtx) => {
        if (!user) return { success: false, message: 'Not authenticated' };
        const result = await sql`DELETE FROM tokens WHERE id = ${Number(id)} AND user_id = ${user.id}`;
        if (result.count === 0) { set.status = 404; return { success: false, message: 'Token not found' }; }
        return { success: true };
    })

    // --- User Self: Get own usage stats ---
    .get('/self/usage', async ({ user, query }: ElysiaCtx) => {
        if (!user) return { success: false, message: 'Not authenticated' };
        const days = Number(query?.days) || 30;
        const [stats] = await sql`
            SELECT
                COUNT(*) as total_requests,
                COUNT(CASE WHEN status_code < 400 THEN 1 END) as success_count,
                SUM(quota_cost) as total_cost,
                SUM(prompt_tokens + completion_tokens) as total_tokens,
                COUNT(DISTINCT model_name) as unique_models
            FROM logs WHERE user_id = ${user.id} AND created_at > NOW() - (${days}::int * INTERVAL '1 day')
        `;
        // Daily breakdown
        const daily = await sql`
            SELECT DATE(created_at) as date, COUNT(*) as requests, SUM(quota_cost) as cost
            FROM logs WHERE user_id = ${user.id} AND created_at > NOW() - (${days}::int * INTERVAL '1 day')
            GROUP BY DATE(created_at) ORDER BY date
        `;
        return { success: true, data: { stats, daily } };
    })

    // --- User Self: Get own logs ---
    .get('/self/logs', async ({ user, query }: ElysiaCtx) => {
        if (!user) return { success: false, message: 'Not authenticated' };
        const page = Number(query?.page) || 1;
        const limit = Number(query?.limit) || 50;
        const offset = (page - 1) * limit;
        const [countRow] = await sql`SELECT COUNT(*) as total FROM logs WHERE user_id = ${user.id}`;
        const data = await sql`
            SELECT id, model_name, prompt_tokens, completion_tokens, quota_cost, status_code,
                   is_stream, created_at, elapsed_ms, error_message
            FROM logs WHERE user_id = ${user.id}
            ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}
        `;
        return { data, total: countRow.total, page, limit };
    })

    // --- Checkin ---
    .post('/self/checkin', async ({ user, set }: ElysiaCtx) => {
        if (!user) return { success: false, message: 'Not authenticated' };
        const checkinEnabled = String(optionCache.get('CheckinEnabled', 'false')) === 'true';
        if (!checkinEnabled) { set.status = 403; return { success: false, message: 'Checkin is disabled' }; }

        const reward = Number(optionCache.get('CheckinReward', 100000));
        const today = new Date().toISOString().split('T')[0];

        // Check if already checked in today
        const [existing] = await sql`
            SELECT id FROM user_checkins WHERE user_id = ${user.id} AND checkin_date = ${today}
        `;
        if (existing) { set.status = 409; return { success: false, message: 'Already checked in today' }; }

        await sql`INSERT INTO user_checkins (user_id, checkin_date, reward) VALUES (${user.id}, ${today}, ${reward})`;
        await sql`UPDATE users SET quota = quota + ${reward} WHERE id = ${user.id}`;

        return { success: true, reward, message: `Checked in! +${reward} quota` };
    })

    // --- Checkin status ---
    .get('/self/checkin', async ({ user }: ElysiaCtx) => {
        if (!user) return { success: false, message: 'Not authenticated' };
        const today = new Date().toISOString().split('T')[0];
        const [row] = await sql`
            SELECT id, checkin_date, reward FROM user_checkins
            WHERE user_id = ${user.id} AND checkin_date = ${today}
        `;
        const checkinEnabled = String(optionCache.get('CheckinEnabled', 'false')) === 'true';
        const reward = Number(optionCache.get('CheckinReward', 100000));
        return {
            success: true,
            data: {
                enabled: checkinEnabled,
                checkedIn: !!row,
                reward,
                lastCheckin: row?.checkin_date || null,
            }
        };
    })

    // --- Aff/Invite ---
    .get('/self/aff', async ({ user }: ElysiaCtx) => {
        if (!user) return { success: false, message: 'Not authenticated' };
        let [aff] = await sql`SELECT code, reward FROM user_aff WHERE user_id = ${user.id}`;
        if (!aff) {
            const code = Bun.randomUUIDv7('hex').substring(0, 12);
            await sql`INSERT INTO user_aff (user_id, code) VALUES (${user.id}, ${code})`;
            aff = { code, reward: 0 };
        }
        // Count invites
        const [stats] = await sql`
            SELECT COUNT(*) as invite_count, COALESCE(SUM(reward), 0) as total_reward
            FROM user_aff_rewards WHERE referrer_id = ${user.id}
        `;
        return { success: true, data: { code: aff.code, inviteCount: stats?.invite_count || 0, totalReward: stats?.total_reward || 0 } };
    })

    // --- Topup (redemption code) ---
    .post('/self/topup', async ({ user, body, set }: ElysiaCtx) => {
        if (!user) return { success: false, message: 'Not authenticated' };
        const { key } = body as { key: string };
        if (!key) { set.status = 400; return { success: false, message: 'Key is required' }; }

        const [redemption] = await sql`
            SELECT * FROM redemptions WHERE key = ${key} AND status = 1 AND used_count < count
        `;
        if (!redemption) { set.status = 404; return { success: false, message: 'Invalid or exhausted redemption code' }; }

        await sql`UPDATE redemptions SET used_count = used_count + 1 WHERE id = ${redemption.id}`;
        await sql`UPDATE users SET quota = quota + ${redemption.quota} WHERE id = ${user.id}`;

        return { success: true, quota: redemption.quota, message: `Redeemed ${redemption.quota} quota` };
    }, { body: t.Object({ key: t.String() }) });
