import type { ElysiaCtx, TokenRecord, UserRecord } from '../../types';
import { Elysia } from 'elysia';
import { db } from '@elygate/db';
import { users, packages, userSubscriptions, announcements, logs, channels, userGroups, paymentOrders, options, oauthAccounts } from '@elygate/db/schema';
import { eq, and, desc, or, ilike, count, sum, inArray, sql as drizzleSql } from 'drizzle-orm';
import { adminGuard, authPlugin } from '../../middleware/auth';
import { optionCache } from '../../services/optionCache';
import { ChannelType } from '../../types';
import { memoryCache } from '../../services/cache';
import { buildModelsUrl } from '../../utils/url';
import { decryptChannelKeys, getChannelKeys } from '../../services/encryption';
import { getProviderHandler } from '../../providers';
import { config, apiUrls } from '../../config';

/**
 * New API compatible user/subscription/announcement/ollama routes.
 * These are separate from the main newApiCompat to keep the chain intact.
 */

function parseModels(value: unknown): string[] {
    if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value);
            return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
        } catch {
            return [];
        }
    }
    return [];
}

function getUserVisibleModels(user: UserRecord, token: TokenRecord | undefined): string[] {
    let models = Array.from(memoryCache.channelRoutes.keys())
        .filter((model) => memoryCache.selectChannels(model, user.group || 'default').length > 0);
    if (token?.models && token.models.length > 0) {
        models = models.filter((model) => token.models!.includes(model));
    }
    return [...new Set(models)].sort();
}

function notImplemented(set: ElysiaCtx['set'], message: string) {
    set.status = 501;
    return { success: false, message };
}

function generateEPaySign(params: string, secret: string): string {
    return new Bun.CryptoHasher('md5').update(params + secret).digest('hex');
}

async function createTopupPaymentOrder(userId: number, amount: number, paymentMethod: string) {
    const [paymentEnabled] = await db.select().from(options).where(eq(options.key, 'PaymentEnabled'));
    if (paymentEnabled && paymentEnabled.value === 'false') {
        throw new Error('Self-recharge is currently disabled');
    }
    if (!amount || amount <= 0) {
        throw new Error('Invalid amount');
    }

    const [order] = await db.insert(paymentOrders).values({
        userId,
        amount,
        paymentMethod,
        status: 0,
    }).returning();

    let paymentUrl = '';
    if (paymentMethod === 'stripe' && config.stripe.secretKey) {
        const stripeResponse = await fetch(apiUrls.stripe + '/v1/checkout/sessions', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${config.stripe.secretKey}`,
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
                'payment_method_types[]': 'card',
                'line_items[0][price_data][currency]': 'usd',
                'line_items[0][price_data][product_data][name]': `Elygate Top-up - $${(amount / 100).toFixed(2)}`,
                'line_items[0][price_data][unit_amount]': String(amount),
                'line_items[0][quantity]': '1',
                mode: 'payment',
                success_url: `${config.webUrl}/payment/success?order_id=${order.id}`,
                cancel_url: `${config.webUrl}/payment/cancel?order_id=${order.id}`,
                'metadata[order_id]': String(order.id),
                'metadata[user_id]': String(userId),
            }),
        });
        const session = await stripeResponse.json() as Record<string, any>;
        if (!session.url) {
            throw new Error(`Stripe error: ${session.error?.message || 'Unknown error'}`);
        }
        paymentUrl = session.url;
    } else if (paymentMethod === 'epay' && config.epay.appId && config.epay.appSecret) {
        const outTradeNo = `ELY${order.id}`;
        const params = new URLSearchParams({
            pid: config.epay.appId,
            type: 'alipay',
            out_trade_no: outTradeNo,
            notify_url: `${config.gatewayUrl}/api/payment/epay/callback`,
            return_url: `${config.webUrl}/payment/success?order_id=${order.id}`,
            name: `Elygate Top-up - $${(amount / 100).toFixed(2)}`,
            money: (amount / 100).toFixed(2),
        });
        const sortedParams = new URLSearchParams([...params.entries()].sort());
        const sign = generateEPaySign(sortedParams.toString(), config.epay.appSecret);
        paymentUrl = `${config.epay.gateway}/submit.php?${sortedParams}&sign=${sign}&sign_type=MD5`;
    }

    return {
        success: true,
        orderId: order.id,
        paymentUrl,
    };
}

export const newApiUserAdminRouter = new Elysia()
    .use(adminGuard)

    // User management (New API: /api/user)
    .get('/user', async () => {
        return await db.select({
            id: users.id,
            username: users.username,
            email: users.email,
            role: users.role,
            quota: users.quota,
            usedQuota: users.usedQuota,
            group: users.group,
            status: users.status,
            currency: users.currency,
            createdAt: users.createdAt,
        }).from(users).orderBy(desc(users.id));
    })
    .get('/user/:id', async ({ params: { id }, set }: ElysiaCtx) => {
        const [row] = await db.select({
            id: users.id,
            username: users.username,
            email: users.email,
            role: users.role,
            quota: users.quota,
            usedQuota: users.usedQuota,
            group: users.group,
            status: users.status,
            currency: users.currency,
            createdAt: users.createdAt,
        }).from(users).where(eq(users.id, Number(id))).limit(1);
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
            const [row] = await db.insert(users).values({
                username: b.username,
                email: b.email || null,
                passwordHash: hash,
                role: Number(b.role || 1),
                quota,
                group: b.group || 'default',
                status: Number(b.status || 1),
                currency: b.currency || 'USD',
            }).returning({
                id: users.id,
                username: users.username,
                email: users.email,
                role: users.role,
                quota: users.quota,
                group: users.group,
                status: users.status,
                currency: users.currency,
                createdAt: users.createdAt,
            });
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
        const [old] = await db.select().from(users).where(eq(users.id, id)).limit(1);
        if (!old) { set.status = 404; return { success: false, message: 'User not found' }; }
        const passwordHash = b.password ? await Bun.password.hash(String(b.password)) : old.passwordHash;
        const [row] = await db.update(users).set({
            email: b.email ?? old.email,
            passwordHash,
            role: Number(b.role ?? old.role),
            quota: Number(b.quota ?? old.quota),
            group: b.group ?? old.group,
            status: Number(b.status ?? old.status),
            currency: b.currency ?? old.currency,
            updatedAt: new Date(),
        }).where(eq(users.id, id))
            .returning({
                id: users.id,
                username: users.username,
                email: users.email,
                role: users.role,
                quota: users.quota,
                group: users.group,
                status: users.status,
                currency: users.currency,
                updatedAt: users.updatedAt,
            });
        return { success: true, data: row };
    })
    .delete('/user/:id', async ({ params: { id }, set }: ElysiaCtx) => {
        const [row] = await db.delete(users).where(and(eq(users.id, Number(id)), drizzleSql`${users.role} != 10`)).returning({ id: users.id });
        if (!row) { set.status = 403; return { success: false, message: 'Cannot delete admin user or user not found' }; }
        return { success: true, deleted: row.id };
    })
    .get('/user/search', async ({ query }: ElysiaCtx) => {
        const keyword = (query?.keyword || '').trim();
        const pattern = '%' + keyword + '%';
        return await db.select({
            id: users.id,
            username: users.username,
            email: users.email,
            role: users.role,
            quota: users.quota,
            usedQuota: users.usedQuota,
            group: users.group,
            status: users.status,
            currency: users.currency,
            createdAt: users.createdAt,
        }).from(users)
            .where(or(
                ilike(users.username, pattern),
                ilike(users.email, pattern),
                ilike(drizzleSql`CAST(${users.id} AS TEXT)`, pattern),
            ))
            .orderBy(desc(users.id))
            .limit(100);
    })

    // Subscription management (New API: /api/subscription)
    .get('/subscription', async () => {
        const rows = await db.select({
            id: userSubscriptions.id,
            userId: userSubscriptions.userId,
            packageId: userSubscriptions.packageId,
            startTime: userSubscriptions.startTime,
            endTime: userSubscriptions.endTime,
            status: userSubscriptions.status,
            quotaGranted: userSubscriptions.quotaGranted,
            quotaUsed: userSubscriptions.quotaUsed,
            lastResetAt: userSubscriptions.lastResetAt,
            packageName: packages.name,
            username: users.username,
        }).from(userSubscriptions)
            .leftJoin(packages, eq(userSubscriptions.packageId, packages.id))
            .leftJoin(users, eq(userSubscriptions.userId, users.id))
            .orderBy(desc(userSubscriptions.id))
            .limit(200);
        return rows;
    })
    .post('/subscription/bind', async ({ body, set }: ElysiaCtx) => {
        const b = body as Record<string, any>;
        const userId = Number(b.userId || b.user_id);
        const packageId = Number(b.packageId || b.package_id);
        if (!userId || !packageId) { set.status = 400; return { success: false, message: 'userId and packageId required' }; }
        const [pkg] = await db.select().from(packages).where(eq(packages.id, packageId)).limit(1);
        if (!pkg) { set.status = 404; return { success: false, message: 'Package not found' }; }
        const startTime = new Date();
        const endTime = new Date(Date.now() + (pkg.durationDays || 30) * 86400000);
        const [row] = await db.insert(userSubscriptions).values({
            userId,
            packageId,
            startTime,
            endTime,
            status: 1,
            quotaGranted: pkg.cycleQuota || Number(pkg.price) || 0,
        }).returning({
            id: userSubscriptions.id,
            userId: userSubscriptions.userId,
            packageId: userSubscriptions.packageId,
            startTime: userSubscriptions.startTime,
            endTime: userSubscriptions.endTime,
            status: userSubscriptions.status,
        });
        if (pkg.cycleQuota) {
            await db.update(users).set({ quota: drizzleSql`${users.quota} + ${pkg.cycleQuota}` }).where(eq(users.id, userId));
        }
        return { success: true, data: row };
    })
    .get('/group', async () => {
        return await db.select().from(userGroups).orderBy(desc(userGroups.createdAt));
    })
    .post('/custom-oauth-provider/discovery', ({ set }: ElysiaCtx) => notImplemented(set, 'Custom OAuth discovery is not implemented'))
    .get('/custom-oauth-provider', async () => {
        return { success: true, data: [] };
    })
    .get('/custom-oauth-provider/:id', ({ params, set }: ElysiaCtx) => {
        set.status = 404;
        return { success: false, message: `Custom OAuth provider '${params.id}' not found` };
    })
    .post('/custom-oauth-provider', ({ set }: ElysiaCtx) => notImplemented(set, 'Custom OAuth provider management is not implemented'))
    .put('/custom-oauth-provider/:id', ({ set }: ElysiaCtx) => notImplemented(set, 'Custom OAuth provider management is not implemented'))
    .delete('/custom-oauth-provider/:id', ({ set }: ElysiaCtx) => notImplemented(set, 'Custom OAuth provider management is not implemented'))
    .get('/data', async () => {
        return await db.select({
            date: drizzleSql<string>`DATE(${logs.createdAt})`,
            totalCost: sum(logs.quotaCost).mapWith(Number),
            totalTokens: sum(drizzleSql`${logs.promptTokens} + ${logs.completionTokens}`).mapWith(Number),
            requestCount: count(),
        }).from(logs)
            .groupBy(drizzleSql`DATE(${logs.createdAt})`)
            .orderBy(desc(drizzleSql`DATE(${logs.createdAt})`))
            .limit(90);
    })
    .get('/data/users', async ({ query }: ElysiaCtx) => {
        const userId = Number(query?.user_id || query?.userId || 0);
        const conditions = userId ? eq(logs.userId, userId) : undefined;
        return await db.select({
            userId: logs.userId,
            date: drizzleSql<string>`DATE(${logs.createdAt})`,
            totalCost: sum(logs.quotaCost).mapWith(Number),
            totalTokens: sum(drizzleSql`${logs.promptTokens} + ${logs.completionTokens}`).mapWith(Number),
            requestCount: count(),
        }).from(logs)
            .where(conditions)
            .groupBy(logs.userId, drizzleSql`DATE(${logs.createdAt})`)
            .orderBy(desc(drizzleSql`DATE(${logs.createdAt})`))
            .limit(180);
    })

    // Announcement management (New API: /api/announcement)
    .get('/announcement', async () => {
        const rows = await db.select({
            id: announcements.id,
            title: announcements.title,
            content: announcements.content,
            tag: announcements.tag,
            createdAt: announcements.createdAt,
            updatedAt: announcements.updatedAt,
        }).from(announcements).orderBy(desc(announcements.id)).limit(100);
        return rows;
    })
    .post('/announcement', async ({ body, set }: ElysiaCtx) => {
        const b = body as Record<string, any>;
        if (!b.title) { set.status = 400; return { success: false, message: 'title is required' }; }
        const [row] = await db.insert(announcements).values({
            title: b.title,
            content: b.content || '',
            tag: b.tag || null,
        }).returning({
            id: announcements.id,
            title: announcements.title,
            content: announcements.content,
            tag: announcements.tag,
            createdAt: announcements.createdAt,
        });
        return { success: true, data: row };
    })
    .put('/announcement', async ({ body, set }: ElysiaCtx) => {
        const b = body as Record<string, any>;
        const id = Number(b.id);
        if (!id) { set.status = 400; return { success: false, message: 'id is required' }; }
        const [old] = await db.select().from(announcements).where(eq(announcements.id, id)).limit(1);
        if (!old) { set.status = 404; return { success: false, message: 'Announcement not found' }; }
        const [row] = await db.update(announcements).set({
            title: b.title ?? old.title,
            content: b.content ?? old.content,
            tag: b.tag ?? old.tag,
            updatedAt: new Date(),
        }).where(eq(announcements.id, id)).returning({
            id: announcements.id,
            title: announcements.title,
            content: announcements.content,
            tag: announcements.tag,
            updatedAt: announcements.updatedAt,
        });
        return { success: true, data: row };
    })
    .delete('/announcement/:id', async ({ params: { id }, set }: ElysiaCtx) => {
        const [row] = await db.delete(announcements).where(eq(announcements.id, Number(id))).returning({ id: announcements.id });
        if (!row) { set.status = 404; return { success: false, message: 'Not found' }; }
        return { success: true, deleted: row.id };
    })

    // Log cleanup (New API: /api/log/clean)
    .delete('/log/clean', async ({ query, set }: ElysiaCtx) => {
        const retentionDays = Number(query?.retention_days || query?.retentionDays) || Number(optionCache.get('LogRetentionDays', 7));
        const cutoff = new Date(Date.now() - retentionDays * 86400000);
        const result = await db.delete(logs).where(drizzleSql`${logs.createdAt} < ${cutoff}`).returning({ id: logs.id });
        return { success: true, deleted: result.length || 0, retentionDays };
    })

    // Ollama pull/delete proxy
    .post('/channel/:id/ollama/pull', async ({ params: { id }, body, set }: ElysiaCtx) => {
        const [channel] = await db.select({
            id: channels.id,
            name: channels.name,
            type: channels.type,
            baseUrl: channels.baseUrl,
            key: channels.key,
        }).from(channels).where(eq(channels.id, Number(id))).limit(1);
        if (!channel) { set.status = 404; return { success: false, message: 'Channel not found' }; }
        if (Number(channel.type) !== ChannelType.OLLAMA) { set.status = 400; return { success: false, message: 'Not an Ollama channel' }; }
        const b = body as Record<string, any>;
        const modelName = b.model || b.name;
        if (!modelName) { set.status = 400; return { success: false, message: 'model name required' }; }
        const baseUrl = String(channel.baseUrl || '').replace(/\/+$/, '');
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
    .post('/channel/:id/ollama/pull/stream', async ({ params: { id }, body, set }: ElysiaCtx) => {
        const [channel] = await db.select({
            id: channels.id,
            type: channels.type,
            baseUrl: channels.baseUrl,
        }).from(channels).where(eq(channels.id, Number(id))).limit(1);
        if (!channel) { set.status = 404; return { success: false, message: 'Channel not found' }; }
        if (Number(channel.type) !== ChannelType.OLLAMA) { set.status = 400; return { success: false, message: 'Not an Ollama channel' }; }
        const b = body as Record<string, any>;
        const modelName = b.model || b.name;
        if (!modelName) { set.status = 400; return { success: false, message: 'model name required' }; }
        const baseUrl = String(channel.baseUrl || '').replace(/\/+$/, '');
        return await fetch(`${baseUrl}/api/pull`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: modelName, stream: true }),
        });
    })
    .get('/channel/ollama/version/:id', async ({ params: { id }, set }: ElysiaCtx) => {
        const [channel] = await db.select({
            id: channels.id,
            type: channels.type,
            baseUrl: channels.baseUrl,
        }).from(channels).where(eq(channels.id, Number(id))).limit(1);
        if (!channel) { set.status = 404; return { success: false, message: 'Channel not found' }; }
        if (Number(channel.type) !== ChannelType.OLLAMA) { set.status = 400; return { success: false, message: 'Not an Ollama channel' }; }
        const baseUrl = String(channel.baseUrl || '').replace(/\/+$/, '');
        try {
            const res = await fetch(`${baseUrl}/api/version`);
            if (!res.ok) return { success: false, message: `Version endpoint returned ${res.status}` };
            return { success: true, data: await res.json() };
        } catch (e: unknown) {
            set.status = 502;
            return { success: false, message: e instanceof Error ? e.message : String(e) };
        }
    })
    .get('/channel/fetch_models/:id', async ({ params: { id }, set }: ElysiaCtx) => {
        const [channel] = await db.select().from(channels).where(eq(channels.id, Number(id))).limit(1);
        if (!channel) { set.status = 404; return { success: false, message: 'Channel not found' }; }
        const keys = getChannelKeys(channel.key);
        if (keys.length === 0) { set.status = 400; return { success: false, message: 'No keys configured' }; }
        const baseUrl = String(channel.baseUrl || '').replace(/\/+$/, '');
        const handler = getProviderHandler(channel.type, channel.baseUrl);
        try {
            const res = await fetch(buildModelsUrl(baseUrl, channel.type), { headers: handler.buildHeaders(keys[0]) });
            if (!res.ok) return { success: false, message: `Upstream error: ${res.status}` };
            const data = await res.json();
            let models: string[] = [];
            if (channel.type === ChannelType.GEMINI) models = data.models?.map((m: Record<string, any>) => m.name?.replace('models/', '') || m.displayName).filter(Boolean) || [];
            else if (Array.isArray(data.data)) models = data.data.map((m: Record<string, any>) => m.id || m.name).filter(Boolean);
            else if (Array.isArray(data)) models = data.map((m: Record<string, any>) => m.id || m.name).filter(Boolean);
            return { success: true, models, total: models.length };
        } catch (e: unknown) {
            set.status = 502;
            return { success: false, message: e instanceof Error ? e.message : String(e) };
        }
    })
    .post('/channel/batch/tag', async ({ body, set }: ElysiaCtx) => {
        const b = body as Record<string, any>;
        const ids = Array.isArray(b.channelIds) ? b.channelIds.map(Number).filter(Boolean) : [];
        if (ids.length === 0) { set.status = 400; return { success: false, message: 'No channel IDs provided' }; }
        await db.update(channels).set({ tag: b.tag || null, updatedAt: new Date() }).where(inArray(channels.id, ids));
        return { success: true, updated: ids.length };
    })
    .post('/channel/copy/:id', async ({ params: { id }, set }: ElysiaCtx) => {
        const [source] = await db.select().from(channels).where(eq(channels.id, Number(id))).limit(1);
        if (!source) { set.status = 404; return { success: false, message: 'Channel not found' }; }
        const [result] = await db.insert(channels).values({
            name: `[Copy] ${source.name}`,
            type: source.type,
            key: source.key,
            baseUrl: source.baseUrl,
            models: source.models,
            modelMapping: source.modelMapping,
            priority: source.priority,
            weight: source.weight,
            status: 3,
            keyStrategy: source.keyStrategy,
            keyStatus: source.keyStatus,
            priceRatio: source.priceRatio,
            keyConcurrencyLimit: source.keyConcurrencyLimit,
            endpointType: source.endpointType,
            groups: source.groups,
        }).returning({ id: channels.id, name: channels.name });
        return { success: true, channel: result };
    })
    .post('/channel/:id/key', async ({ params: { id }, set, user }: ElysiaCtx) => {
        if (!user || user.role < 10) { set.status = 403; return { success: false, message: 'Root access required' }; }
        const [channel] = await db.select({ key: channels.key }).from(channels).where(eq(channels.id, Number(id))).limit(1);
        if (!channel) { set.status = 404; return { success: false, message: 'Channel not found' }; }
        return { success: true, key: decryptChannelKeys(channel.key) };
    })
    .delete('/channel/:id/ollama/:model', async ({ params: { id, model: modelName }, set }: ElysiaCtx) => {
        const [channel] = await db.select({
            id: channels.id,
            type: channels.type,
            baseUrl: channels.baseUrl,
        }).from(channels).where(eq(channels.id, Number(id))).limit(1);
        if (!channel) { set.status = 404; return { success: false, message: 'Channel not found' }; }
        if (Number(channel.type) !== ChannelType.OLLAMA) { set.status = 400; return { success: false, message: 'Not an Ollama channel' }; }
        const baseUrl = String(channel.baseUrl || '').replace(/\/+$/, '');
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
    .get('/subscription/plans', async ({ user }: ElysiaCtx) => {
        const currentUser = user as UserRecord | undefined;
        if (!currentUser) return { success: false, message: 'Authentication required' };
        const rows = await db.select().from(packages).where(eq(packages.isPublic, true)).orderBy(packages.price);
        return rows.filter((pkg) => {
            const allowedGroups = Array.isArray(pkg.allowedGroups) ? pkg.allowedGroups : [];
            return allowedGroups.length === 0 || allowedGroups.includes(currentUser.group || 'default');
        });
    })
    .get('/subscription/self', async ({ user }: ElysiaCtx) => {
        const currentUser = user as UserRecord | undefined;
        if (!currentUser) return { success: false, message: 'Authentication required' };
        return await db.select({
            id: userSubscriptions.id,
            packageId: userSubscriptions.packageId,
            packageName: packages.name,
            startTime: userSubscriptions.startTime,
            endTime: userSubscriptions.endTime,
            status: userSubscriptions.status,
            quotaGranted: userSubscriptions.quotaGranted,
            quotaUsed: userSubscriptions.quotaUsed,
            lastResetAt: userSubscriptions.lastResetAt,
        }).from(userSubscriptions)
            .leftJoin(packages, eq(userSubscriptions.packageId, packages.id))
            .where(eq(userSubscriptions.userId, currentUser.id))
            .orderBy(desc(userSubscriptions.id));
    })
    .get('/data/self', async ({ user }: ElysiaCtx) => {
        const currentUser = user as UserRecord | undefined;
        if (!currentUser) return { success: false, message: 'Authentication required' };
        return await db.select({
            date: drizzleSql<string>`DATE(${logs.createdAt})`,
            totalCost: sum(logs.quotaCost).mapWith(Number),
            totalTokens: sum(drizzleSql`${logs.promptTokens} + ${logs.completionTokens}`).mapWith(Number),
            requestCount: count(),
        }).from(logs)
            .where(eq(logs.userId, currentUser.id))
            .groupBy(drizzleSql`DATE(${logs.createdAt})`)
            .orderBy(desc(drizzleSql`DATE(${logs.createdAt})`))
            .limit(90);
    })
    .get('/user/self', async ({ user }: ElysiaCtx) => {
        const currentUser = user as UserRecord | undefined;
        if (!currentUser) return { success: false, message: 'Authentication required' };
        const [row] = await db.select({
            id: users.id,
            username: users.username,
            email: users.email,
            name: users.name,
            role: users.role,
            quota: users.quota,
            usedQuota: users.usedQuota,
            group: users.group,
            status: users.status,
            currency: users.currency,
            createdAt: users.createdAt,
        }).from(users).where(eq(users.id, currentUser.id)).limit(1);
        return row || { success: false, message: 'User not found' };
    })
    .put('/user/self', async ({ user, body, set }: ElysiaCtx) => {
        const currentUser = user as UserRecord | undefined;
        if (!currentUser) return { success: false, message: 'Authentication required' };
        const b = body as Record<string, any>;
        const [row] = await db.update(users).set({
            email: b.email,
            name: b.name,
            currency: b.currency,
            updatedAt: new Date(),
        }).where(eq(users.id, currentUser.id)).returning({
            id: users.id,
            username: users.username,
            email: users.email,
            name: users.name,
            currency: users.currency,
            updatedAt: users.updatedAt,
        });
        return { success: true, data: row };
    })
    .get('/user/models', async ({ user, token }: ElysiaCtx) => {
        const currentUser = user as UserRecord | undefined;
        if (!currentUser) return { success: false, message: 'Authentication required' };
        return getUserVisibleModels(currentUser, token as TokenRecord | undefined);
    })
    .get('/user/aff', async ({ user, set }: ElysiaCtx) => {
        const currentUser = user as UserRecord | undefined;
        if (!currentUser) { set.status = 401; return { success: false, message: 'Authentication required' }; }
        const [row] = await db.select({ code: drizzleSql<string>`code`, reward: drizzleSql<number>`reward` }).from(drizzleSql`user_aff`).where(drizzleSql`user_id = ${currentUser.id}`) as any;
        return { success: true, data: row || null };
    })
    .get('/user/2fa/status', () => {
        return { success: true, data: { enabled: false, backupCodesRemaining: 0 } };
    })
    .post('/user/2fa/setup', ({ set }: ElysiaCtx) => notImplemented(set, '2FA setup is not implemented'))
    .post('/user/2fa/enable', ({ set }: ElysiaCtx) => notImplemented(set, '2FA enable is not implemented'))
    .post('/user/2fa/disable', ({ set }: ElysiaCtx) => notImplemented(set, '2FA disable is not implemented'))
    .post('/user/2fa/backup_codes', ({ set }: ElysiaCtx) => notImplemented(set, '2FA backup code regeneration is not implemented'))
    .get('/user/passkey', () => {
        return { success: true, data: { enabled: false, registered: false, verified: false } };
    })
    .post('/user/passkey/register/begin', ({ set }: ElysiaCtx) => notImplemented(set, 'Passkey registration is not implemented'))
    .post('/user/passkey/register/finish', ({ set }: ElysiaCtx) => notImplemented(set, 'Passkey registration is not implemented'))
    .post('/user/passkey/verify/begin', ({ set }: ElysiaCtx) => notImplemented(set, 'Passkey verification is not implemented'))
    .post('/user/passkey/verify/finish', ({ set }: ElysiaCtx) => notImplemented(set, 'Passkey verification is not implemented'))
    .delete('/user/passkey', ({ set }: ElysiaCtx) => notImplemented(set, 'Passkey deletion is not implemented'))
    .get('/user/oauth/bindings', async ({ user, set }: ElysiaCtx) => {
        const currentUser = user as UserRecord | undefined;
        if (!currentUser) { set.status = 401; return { success: false, message: 'Authentication required' }; }
        const rows = await db.select({
            id: oauthAccounts.id,
            provider: oauthAccounts.provider,
            providerUserId: oauthAccounts.providerUserId,
            expiresAt: oauthAccounts.expiresAt,
            createdAt: oauthAccounts.createdAt,
        }).from(oauthAccounts).where(eq(oauthAccounts.userId, currentUser.id)).orderBy(desc(oauthAccounts.id));
        return { success: true, data: rows };
    })
    .delete('/user/oauth/bindings/:provider_id', async ({ user, params, set }: ElysiaCtx) => {
        const currentUser = user as UserRecord | undefined;
        if (!currentUser) { set.status = 401; return { success: false, message: 'Authentication required' }; }
        const id = Number(params.provider_id);
        if (!id) { set.status = 400; return { success: false, message: 'Invalid provider id' }; }
        const rows = await db.delete(oauthAccounts).where(and(eq(oauthAccounts.id, id), eq(oauthAccounts.userId, currentUser.id))).returning({ id: oauthAccounts.id });
        if (rows.length === 0) { set.status = 404; return { success: false, message: 'Binding not found' }; }
        return { success: true, deleted: rows[0].id };
    })
    .get('/user/checkin', async ({ user, set }: ElysiaCtx) => {
        const currentUser = user as UserRecord | undefined;
        if (!currentUser) { set.status = 401; return { success: false, message: 'Authentication required' }; }
        const today = new Date().toISOString().split('T')[0];
        const [row] = await db.select({ id: drizzleSql<number>`id` }).from(drizzleSql`user_checkins`).where(drizzleSql`user_id = ${currentUser.id} AND checkin_date = ${today}`) as any;
        return { success: true, data: { enabled: String(optionCache.get('CheckinEnabled', 'false')) === 'true', checkedIn: !!row, reward: Number(optionCache.get('CheckinReward', 100000)) } };
    })
    .post('/user/checkin', async ({ user, set }: ElysiaCtx) => {
        const currentUser = user as UserRecord | undefined;
        if (!currentUser) { set.status = 401; return { success: false, message: 'Authentication required' }; }
        if (String(optionCache.get('CheckinEnabled', 'false')) !== 'true') { set.status = 403; return { success: false, message: 'Checkin is disabled' }; }
        const reward = Number(optionCache.get('CheckinReward', 100000));
        const today = new Date().toISOString().split('T')[0];
        const [existing] = await db.select({ id: drizzleSql<number>`id` }).from(drizzleSql`user_checkins`).where(drizzleSql`user_id = ${currentUser.id} AND checkin_date = ${today}`) as any;
        if (existing) { set.status = 409; return { success: false, message: 'Already checked in today' }; }
        await db.execute(drizzleSql`INSERT INTO user_checkins (user_id, checkin_date, reward) VALUES (${currentUser.id}, ${today}, ${reward})`);
        await db.update(users).set({ quota: drizzleSql`${users.quota} + ${reward}` }).where(eq(users.id, currentUser.id));
        return { success: true, reward };
    })
    .get('/user/topup/info', async () => {
        return {
            success: true,
            data: {
                enabled: String(optionCache.get('PaymentEnabled', 'true')) === 'true',
                methods: optionCache.get('PaymentMethods', 'redemption'),
                quotaPerUnit: Number(optionCache.get('QuotaPerUnit', 500000)),
                exchangeRate: Number(optionCache.get('ExchangeRate', 7.2)),
            }
        };
    })
    .get('/user/topup/self', async ({ user, set }: ElysiaCtx) => {
        const currentUser = user as UserRecord | undefined;
        if (!currentUser) { set.status = 401; return { success: false, message: 'Authentication required' }; }
        return await db.select().from(paymentOrders).where(eq(paymentOrders.userId, currentUser.id)).orderBy(desc(paymentOrders.id)).limit(50);
    })
    .post('/user/pay', async ({ user, body, set }: ElysiaCtx) => {
        const currentUser = user as UserRecord | undefined;
        if (!currentUser) { set.status = 401; return { success: false, message: 'Authentication required' }; }
        const payload = body as Record<string, any>;
        try {
            return await createTopupPaymentOrder(currentUser.id, Number(payload.amount), String(payload.paymentMethod || payload.payment_method || 'epay'));
        } catch (e: unknown) {
            set.status = 500;
            return { success: false, message: e instanceof Error ? e.message : String(e) };
        }
    })
    .post('/user/amount', async ({ body, set }: ElysiaCtx) => {
        const payload = body as Record<string, any>;
        const amount = Number(payload.amount || 0);
        if (!amount || amount <= 0) { set.status = 400; return { success: false, message: 'Invalid amount' }; }
        const quotaPerUnit = Number(optionCache.get('QuotaPerUnit', 500000));
        return { success: true, data: { amount, quota: Math.floor((amount / 100) * quotaPerUnit) } };
    })
    .post('/user/stripe/pay', async ({ user, body, set }: ElysiaCtx) => {
        const currentUser = user as UserRecord | undefined;
        if (!currentUser) { set.status = 401; return { success: false, message: 'Authentication required' }; }
        try {
            return await createTopupPaymentOrder(currentUser.id, Number((body as Record<string, any>).amount), 'stripe');
        } catch (e: unknown) {
            set.status = 500;
            return { success: false, message: e instanceof Error ? e.message : String(e) };
        }
    })
    .post('/user/stripe/amount', async ({ body, set }: ElysiaCtx) => {
        const amount = Number((body as Record<string, any>).amount || 0);
        if (!amount || amount <= 0) { set.status = 400; return { success: false, message: 'Invalid amount' }; }
        const quotaPerUnit = Number(optionCache.get('QuotaPerUnit', 500000));
        return { success: true, data: { amount, quota: Math.floor((amount / 100) * quotaPerUnit), provider: 'stripe' } };
    })
    .post('/user/creem/pay', ({ set }: ElysiaCtx) => notImplemented(set, 'Creem pay is not implemented'))
    .post('/user/waffo/pay', ({ set }: ElysiaCtx) => notImplemented(set, 'Waffo pay is not implemented'))
    .post('/user/waffo/amount', ({ set }: ElysiaCtx) => notImplemented(set, 'Waffo amount is not implemented'))
    .post('/user/topup', async ({ user, body, set }: ElysiaCtx) => {
        const currentUser = user as UserRecord | undefined;
        if (!currentUser) { set.status = 401; return { success: false, message: 'Authentication required' }; }
        const key = (body as Record<string, any>).key;
        if (!key) { set.status = 400; return { success: false, message: 'Key is required' }; }
        const [redemption] = await db.select().from(drizzleSql`redemptions`).where(drizzleSql`key = ${key} AND status = 1 AND used_count < count`) as any;
        if (!redemption) { set.status = 404; return { success: false, message: 'Invalid or exhausted redemption code' }; }
        await db.execute(drizzleSql`UPDATE redemptions SET used_count = used_count + 1 WHERE id = ${redemption.id}`);
        await db.update(users).set({ quota: drizzleSql`${users.quota} + ${redemption.quota}` }).where(eq(users.id, currentUser.id));
        return { success: true, quota: redemption.quota };
    })
    .post('/subscription/epay/pay', ({ set }: ElysiaCtx) => notImplemented(set, 'Subscription EPay flow is not implemented'))
    .post('/subscription/stripe/pay', ({ set }: ElysiaCtx) => notImplemented(set, 'Subscription Stripe flow is not implemented'))
    .post('/subscription/creem/pay', ({ set }: ElysiaCtx) => notImplemented(set, 'Subscription Creem flow is not implemented'))
    // User self-service announcements (public readable)
    .get('/announcement/public', async () => {
        const rows = await db.select({
            id: announcements.id,
            title: announcements.title,
            content: announcements.content,
            tag: announcements.tag,
            createdAt: announcements.createdAt,
        }).from(announcements).orderBy(desc(announcements.id)).limit(20);
        return { success: true, data: rows };
    });

export const newApiUserPublicRouter = new Elysia()
    .post('/user/login/2fa', ({ set }: ElysiaCtx) => notImplemented(set, '2FA login is not implemented'))
    .post('/user/passkey/login/begin', ({ set }: ElysiaCtx) => notImplemented(set, 'Passkey login is not implemented'))
    .post('/user/passkey/login/finish', ({ set }: ElysiaCtx) => notImplemented(set, 'Passkey login is not implemented'));
