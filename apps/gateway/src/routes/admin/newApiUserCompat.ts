import type { ElysiaCtx, TokenRecord, UserRecord } from '../../types';
import { Elysia } from 'elysia';
import { db } from '@elygate/db';
import { users, packages, userSubscriptions, announcements, logs, channels, userGroups, paymentOrders, subscriptionOrders, options, oauthAccounts, customOAuthProviders, twoFactorLoginChallenges, tokens, sessions, redemptions, inviteCodes, loginAttempts, userAff } from '@elygate/db/schema';
import { eq, and, desc, or, ilike, count, sum, inArray, sql as drizzleSql } from 'drizzle-orm';
import { adminGuard, authPlugin } from '../../middleware/auth';
import { optionCache } from '../../services/optionCache';
import { ChannelType } from '../../types';
import { memoryCache } from '../../services/cache';
import { buildModelsUrl } from '../../utils/url';
import { decryptChannelKeys, getChannelKeys } from '../../services/encryption';
import { getProviderHandler } from '../../providers';
import { config, apiUrls } from '../../config';
import { createCreemCheckoutSession, verifyCreemWebhookSignature, parseCreemWebhookEvent } from '../../services/creem';
import { createWaffoCheckoutSession, verifyWaffoWebhookSignature, parseWaffoWebhookEvent } from '../../services/waffo';
import { buildOtpAuthUrl, consumeBackupCode, generateBackupCodes, generateTwoFactorSecret, hashBackupCodes, verifyTotp } from '../../services/twoFactor';
import { authService } from '../../services/auth';
import { bindSubscriptionToUser, cancelSubscription } from '../../services/subscription';
import { newApiPlanToPackageValues, normalizeBillingPreference, resolveSubscriptionPlanId, wrapNewApiSubscriptionPlan } from '../../services/newApiSubscriptionCompat';
import { safeExternalFetch } from '../../utils/safeExternalUrl';
import { handleEPayPaymentCallback, handleStripePaymentCallback } from '../payment';
import { completePendingTopupPaymentOrderTx } from '../../services/paymentCallback';

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

function generateEPaySign(params: string, secret: string): string {
    return new Bun.CryptoHasher('md5').update(params + secret).digest('hex');
}

function normalizeDiscoveryUrl(body: Record<string, any>): string | null {
    const explicit = typeof body.discoveryUrl === 'string' ? body.discoveryUrl.trim() : typeof body.discovery_url === 'string' ? body.discovery_url.trim() : '';
    if (explicit) return explicit;
    const issuer = typeof body.issuer === 'string' ? body.issuer.trim().replace(/\/+$/, '') : '';
    if (issuer) return `${issuer}/.well-known/openid-configuration`;
    return null;
}

async function fetchOAuthDiscovery(body: Record<string, any>) {
    const discoveryUrl = normalizeDiscoveryUrl(body);
    if (!discoveryUrl) throw new Error('issuer or discoveryUrl is required');
    const res = await safeExternalFetch(discoveryUrl, { headers: { Accept: 'application/json' } });
    if (!res.ok) {
        throw new Error(`Discovery endpoint returned ${res.status}`);
    }
    const data = await res.json() as Record<string, any>;
    return {
        discoveryUrl,
        issuer: typeof data.issuer === 'string' ? data.issuer : body.issuer || null,
        authorizationEndpoint: typeof data.authorization_endpoint === 'string' ? data.authorization_endpoint : null,
        tokenEndpoint: typeof data.token_endpoint === 'string' ? data.token_endpoint : null,
        userinfoEndpoint: typeof data.userinfo_endpoint === 'string' ? data.userinfo_endpoint : null,
        jwksUri: typeof data.jwks_uri === 'string' ? data.jwks_uri : null,
        scopes: Array.isArray(data.scopes_supported) ? data.scopes_supported.filter((v): v is string => typeof v === 'string') : [],
        metadata: data,
    };
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
    } else if (paymentMethod === 'creem' && config.creem.apiKey) {
        try {
            paymentUrl = await createCreemCheckoutSession({
                amount,
                productName: `Elygate Top-up - $${(amount / 100).toFixed(2)}`,
                orderId: String(order.id),
                userId,
                successUrl: `${config.webUrl}/payment/success?order_id=${order.id}`,
                cancelUrl: `${config.webUrl}/payment/cancel?order_id=${order.id}`,
            });
        } catch (e) { throw new Error(`Creem error: ${e instanceof Error ? e.message : String(e)}`); }
    } else if (paymentMethod === 'waffo' && config.waffo.apiKey) {
        try {
            paymentUrl = await createWaffoCheckoutSession({
                amount,
                productName: `Elygate Top-up - $${(amount / 100).toFixed(2)}`,
                orderId: String(order.id),
                userId,
                successUrl: `${config.webUrl}/payment/success?order_id=${order.id}`,
                cancelUrl: `${config.webUrl}/payment/cancel?order_id=${order.id}`,
                notifyUrl: `${config.gatewayUrl}/api/admin/waffo/webhook`,
            });
        } catch (e) { throw new Error(`Waffo error: ${e instanceof Error ? e.message : String(e)}`); }
    }

    return {
        success: true,
        orderId: order.id,
        paymentUrl,
    };
}

function parsePackagePriceToCents(value: unknown): number {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) return 0;
    return Math.floor(numeric * 100);
}

async function createSubscriptionPaymentOrder(userId: number, packageId: number, paymentMethod: string) {
    const [paymentEnabled] = await db.select().from(options).where(eq(options.key, 'PaymentEnabled'));
    if (paymentEnabled && paymentEnabled.value === 'false') {
        throw new Error('Self-recharge is currently disabled');
    }
    if (!packageId) throw new Error('packageId is required');

    const [pkg] = await db.select({
        id: packages.id,
        name: packages.name,
        subtitle: packages.subtitle,
        price: packages.price,
        currency: packages.currency,
        durationDays: packages.durationDays,
        cycleQuota: packages.cycleQuota,
        stripePriceId: packages.stripePriceId,
        creemProductId: packages.creemProductId,
        waffoPancakeProductId: packages.waffoPancakeProductId,
        isPublic: packages.isPublic,
        enabled: packages.enabled,
    }).from(packages).where(eq(packages.id, packageId)).limit(1);
    if (!pkg || pkg.isPublic === false || pkg.enabled === false) throw new Error('Package not found');

    const amount = parsePackagePriceToCents(pkg.price);
    if (amount <= 0) throw new Error('Invalid package price');

    const tradeNo = `ELYSUB${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const [order] = await db.insert(subscriptionOrders).values({
        userId,
        packageId,
        amount,
        currency: String(pkg.currency || 'USD'),
        money: (amount / 100).toFixed(2),
        tradeNo,
        paymentMethod,
        paymentProvider: paymentMethod,
        status: 'pending',
    }).returning();

    let paymentUrl = '';
    if (paymentMethod === 'stripe' && config.stripe.secretKey) {
        const body = new URLSearchParams({
            'payment_method_types[]': 'card',
            mode: 'payment',
            success_url: `${config.webUrl}/payment/success?order_id=${order.id}`,
            cancel_url: `${config.webUrl}/payment/cancel?order_id=${order.id}`,
            'metadata[order_id]': String(order.id),
            'metadata[user_id]': String(userId),
            'metadata[order_kind]': 'subscription',
            'metadata[package_id]': String(packageId),
        });
        if (pkg.stripePriceId) {
            body.set('line_items[0][price]', pkg.stripePriceId);
            body.set('line_items[0][quantity]', '1');
        } else {
            body.set('line_items[0][price_data][currency]', String(pkg.currency || 'USD').toLowerCase());
            body.set('line_items[0][price_data][product_data][name]', `Elygate Subscription - ${pkg.name}`);
            body.set('line_items[0][price_data][unit_amount]', String(amount));
            body.set('line_items[0][quantity]', '1');
        }
        const stripeResponse = await fetch(apiUrls.stripe + '/v1/checkout/sessions', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${config.stripe.secretKey}`,
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body,
        });
        const session = await stripeResponse.json() as Record<string, any>;
        if (!session.url) {
            throw new Error(`Stripe error: ${session.error?.message || 'Unknown error'}`);
        }
        paymentUrl = session.url;
    } else if (paymentMethod === 'epay' && config.epay.appId && config.epay.appSecret) {
        const params = new URLSearchParams({
            pid: config.epay.appId,
            type: 'alipay',
            out_trade_no: order.tradeNo,
            notify_url: `${config.gatewayUrl}/api/payment/epay/callback`,
            return_url: `${config.webUrl}/payment/success?order_id=${order.id}`,
            name: `Elygate Subscription - ${pkg.name}`,
            money: (amount / 100).toFixed(2),
        });
        const sortedParams = new URLSearchParams([...params.entries()].sort());
        const sign = generateEPaySign(sortedParams.toString(), config.epay.appSecret);
        paymentUrl = `${config.epay.gateway}/submit.php?${sortedParams}&sign=${sign}&sign_type=MD5`;
    } else if (paymentMethod === 'creem' && config.creem.apiKey) {
        try {
            paymentUrl = await createCreemCheckoutSession({
                amount,
                productName: `Elygate Subscription - ${pkg.name}`,
                orderId: String(order.id),
                userId,
                successUrl: `${config.webUrl}/payment/success?order_id=${order.id}`,
                cancelUrl: `${config.webUrl}/payment/cancel?order_id=${order.id}`,
                productId: pkg.creemProductId || undefined,
            });
        } catch (e) { throw new Error(`Creem error: ${e instanceof Error ? e.message : String(e)}`); }
    } else if (paymentMethod === 'waffo' && config.waffo.apiKey) {
        try {
            paymentUrl = await createWaffoCheckoutSession({
                amount,
                productName: `Elygate Subscription - ${pkg.name}`,
                orderId: String(order.id),
                userId,
                successUrl: `${config.webUrl}/payment/success?order_id=${order.id}`,
                cancelUrl: `${config.webUrl}/payment/cancel?order_id=${order.id}`,
                notifyUrl: `${config.gatewayUrl}/api/admin/waffo/webhook`,
            });
        } catch (e) { throw new Error(`Waffo error: ${e instanceof Error ? e.message : String(e)}`); }
    }

    return {
        success: true,
        orderId: order.id,
        paymentUrl,
        data: {
            packageId: pkg.id,
            packageName: pkg.name,
            amount,
        },
    };
}

function apiSuccess(data: unknown = null, message = '') {
    return { success: true, message, data };
}

function providerUnsupported(provider: string) {
    return {
        success: false,
        disabled: true,
        provider,
        message: `${provider} payment webhook is not configured in Elygate core compatibility mode`,
    };
}

function getMoneyAmount(payload: Record<string, any>): number {
    const raw = payload.amount ?? payload.money ?? payload.total ?? 0;
    return Number(raw);
}

function topupAmountPreview(amount: number, provider: string) {
    const quotaPerUnit = Number(optionCache.get('QuotaPerUnit', 500000));
    return {
        success: true,
        data: {
            amount,
            quota: Math.floor((amount / 100) * quotaPerUnit),
            provider,
        }
    };
}

async function listUserSubscriptionSummaries(userId: number) {
    return await db.select({
        id: userSubscriptions.id,
        userId: userSubscriptions.userId,
        packageId: userSubscriptions.packageId,
        packageName: packages.name,
        startTime: userSubscriptions.startTime,
        endTime: userSubscriptions.endTime,
        status: userSubscriptions.status,
        source: userSubscriptions.source,
        amountTotal: userSubscriptions.amountTotal,
        amountUsed: userSubscriptions.amountUsed,
        quotaGranted: userSubscriptions.quotaGranted,
        quotaUsed: userSubscriptions.quotaUsed,
        lastResetAt: userSubscriptions.lastResetAt,
        nextResetAt: userSubscriptions.nextResetAt,
        upgradeGroup: userSubscriptions.upgradeGroup,
        prevUserGroup: userSubscriptions.prevUserGroup,
        createdAt: userSubscriptions.createdAt,
        updatedAt: userSubscriptions.updatedAt,
    }).from(userSubscriptions)
        .leftJoin(packages, eq(userSubscriptions.packageId, packages.id))
        .where(eq(userSubscriptions.userId, userId))
        .orderBy(desc(userSubscriptions.id));
}

async function registerCompatUser(payload: Record<string, any>) {
    const username = String(payload.username || '').trim();
    const password = String(payload.password || '');
    if (!username || !password) throw new Error('username and password are required');

    const registerMode = String(optionCache.get('RegisterMode', 'open'));
    if (registerMode === 'closed') throw new Error('Registration is currently disabled');

    const inviteCode = String(payload.inviteCode || payload.invite_code || '').trim();
    let giftQuota = 0;
    let inviteCodeId: number | null = null;
    if (inviteCode) {
        const [codeRecord] = await db.select().from(inviteCodes).where(eq(inviteCodes.code, inviteCode)).limit(1);
        if (!codeRecord || codeRecord.status !== 1 || (codeRecord.expiresAt && new Date(codeRecord.expiresAt) < new Date()) || codeRecord.usedCount >= codeRecord.maxUses) {
            throw new Error('Invalid invite code');
        }
        giftQuota = Number(codeRecord.giftQuota || 0);
        inviteCodeId = codeRecord.id;
    } else if (registerMode === 'invite') {
        throw new Error('Invite code is required for registration');
    }

    const passwordHash = await Bun.password.hash(password);
    const defaultQuota = Number(optionCache.get('SignRegisterQuota', 500000));
    return await db.transaction(async (tx) => {
        const [row] = await tx.insert(users).values({
            username,
            email: payload.email || null,
            name: payload.name || null,
            passwordHash,
            role: 1,
            quota: defaultQuota + giftQuota,
            status: 1,
            currency: payload.currency || 'USD',
        }).returning({
            id: users.id,
            username: users.username,
            role: users.role,
            quota: users.quota,
            currency: users.currency,
        });

        const key = `sk-${Bun.randomUUIDv7('hex')}`;
        await tx.insert(tokens).values({
            userId: row.id,
            name: 'Default API Key',
            key,
            status: 1,
            remainQuota: -1,
        });
        if (inviteCodeId) {
            await tx.update(inviteCodes).set({
                usedCount: drizzleSql`${inviteCodes.usedCount} + 1`,
                updatedAt: new Date(),
            }).where(eq(inviteCodes.id, inviteCodeId));
        }
        return { ...row, token: key, giftQuota };
    });
}

async function loginCompatUser(payload: Record<string, any>, request: Request, authSession: { set: (value: any) => void }) {
    const username = String(payload.username || '').trim();
    const password = String(payload.password || '');
    if (!username || !password) throw new Error('username and password are required');
    const clientIP = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';

    const [row] = await db.select({
        id: users.id,
        username: users.username,
        passwordHash: users.passwordHash,
        role: users.role,
        status: users.status,
        lockedUntil: users.lockedUntil,
        currency: users.currency,
        twoFactorEnabled: users.twoFactorEnabled,
    }).from(users).where(eq(users.username, username)).limit(1);

    if (!row || row.status !== 1 || (row.lockedUntil && new Date(row.lockedUntil) > new Date())) {
        await db.insert(loginAttempts).values({ username, ipAddress: clientIP, success: false });
        throw new Error('Invalid username or password');
    }

    const valid = await Bun.password.verify(password, row.passwordHash).catch(() => false);
    if (!valid) {
        await db.insert(loginAttempts).values({ username, ipAddress: clientIP, success: false });
        throw new Error('Invalid username or password');
    }

    await db.delete(loginAttempts).where(eq(loginAttempts.username, username));
    if (row.twoFactorEnabled) {
        const challengeId = `tfa_${Bun.randomUUIDv7('hex')}`;
        await db.insert(twoFactorLoginChallenges).values({
            id: challengeId,
            userId: row.id,
            expiresAt: new Date(Date.now() + 5 * 60 * 1000),
        });
        return { success: true, requires2FA: true, challengeToken: challengeId, username: row.username };
    }

    const { sessionToken } = await authService.createWebSession(
        row.id,
        clientIP,
        request.headers.get('user-agent') || 'unknown'
    );
    authSession.set({
        value: sessionToken,
        httpOnly: true,
        secure: request.headers.get('x-forwarded-proto') === 'https',
        sameSite: 'lax',
        maxAge: 7 * 86400,
        path: '/'
    });
    const tokenKey = await authService.ensureDefaultApiKey(row.id);
    return { success: true, token: tokenKey, username: row.username, role: row.role, currency: row.currency || 'USD' };
}

const PASSKEY_PROVIDER_PREFIX = 'passkey:';
const PASSKEY_CHALLENGE_TTL_MS = 5 * 60 * 1000;
const passkeyChallenges = new Map<string, { action: 'register' | 'verify' | 'login'; userId: number; expiresAt: number }>();

function parsePasskeyMetadata(value: unknown): Record<string, any> {
    if (!value) return {};
    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value);
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
        } catch {
            return {};
        }
    }
    return typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
}

function getPasskeyRpId() {
    const fallback = 'localhost';
    for (const raw of [config.webUrl, config.gatewayUrl]) {
        if (!raw) continue;
        try {
            const host = new URL(raw).hostname;
            if (host) return host;
        } catch {
            continue;
        }
    }
    return fallback;
}

function cleanupPasskeyChallenges() {
    const now = Date.now();
    for (const [token, challenge] of passkeyChallenges.entries()) {
        if (challenge.expiresAt <= now) passkeyChallenges.delete(token);
    }
}

function createPasskeyChallenge(action: 'register' | 'verify' | 'login', userId: number) {
    cleanupPasskeyChallenges();
    const challengeToken = `pkc_${Bun.randomUUIDv7('hex')}`;
    const challenge = Bun.randomUUIDv7('hex');
    passkeyChallenges.set(challengeToken, { action, userId, expiresAt: Date.now() + PASSKEY_CHALLENGE_TTL_MS });
    return { challengeToken, challenge };
}

function consumePasskeyChallenge(token: string, action: 'register' | 'verify' | 'login') {
    cleanupPasskeyChallenges();
    const challenge = passkeyChallenges.get(token);
    if (!challenge || challenge.action !== action || challenge.expiresAt <= Date.now()) return null;
    passkeyChallenges.delete(token);
    return challenge;
}

function extractCredentialId(payload: Record<string, any>) {
    const direct = payload.credentialId || payload.credential_id;
    if (typeof direct === 'string' && direct.trim()) return direct.trim();
    const credential = payload.credential;
    if (credential && typeof credential === 'object') {
        const nested = (credential as Record<string, any>).id || (credential as Record<string, any>).rawId;
        if (typeof nested === 'string' && nested.trim()) return nested.trim();
    }
    return '';
}

async function listUserPasskeys(userId: number) {
    const rows = await db.select({
        id: oauthAccounts.id,
        credentialId: oauthAccounts.providerUserId,
        metadata: oauthAccounts.accessToken,
        createdAt: oauthAccounts.createdAt,
    }).from(oauthAccounts)
        .where(and(eq(oauthAccounts.userId, userId), ilike(oauthAccounts.provider, `${PASSKEY_PROVIDER_PREFIX}%`)))
        .orderBy(desc(oauthAccounts.id));

    return rows.map((row) => {
        const metadata = parsePasskeyMetadata(row.metadata);
        const transports = Array.isArray(metadata.transports) ? metadata.transports.filter((item): item is string => typeof item === 'string') : [];
        return {
            id: row.id,
            credentialId: row.credentialId,
            name: String(metadata.name || metadata.deviceName || ''),
            transports,
            createdAt: row.createdAt,
            metadata,
        };
    });
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
    .get('/user/topup', async ({ query }: ElysiaCtx) => {
        const userId = Number(query?.user_id || query?.userId || 0);
        const rows = await db.select({
            id: paymentOrders.id,
            userId: paymentOrders.userId,
            username: users.username,
            amount: paymentOrders.amount,
            paymentMethod: paymentOrders.paymentMethod,
            orderType: paymentOrders.orderType,
            targetType: paymentOrders.targetType,
            targetId: paymentOrders.targetId,
            status: paymentOrders.status,
            transactionId: paymentOrders.transactionId,
            createdAt: paymentOrders.createdAt,
            updatedAt: paymentOrders.updatedAt,
        }).from(paymentOrders)
            .leftJoin(users, eq(paymentOrders.userId, users.id))
            .where(userId ? eq(paymentOrders.userId, userId) : undefined)
            .orderBy(desc(paymentOrders.id))
            .limit(200);
        return apiSuccess(rows);
    })
    .post('/user/topup/complete', async ({ body, set }: ElysiaCtx) => {
        const b = body as Record<string, any>;
        const orderId = Number(b.id || b.order_id || b.orderId);
        if (!orderId) { set.status = 400; return { success: false, message: 'order id is required' }; }
        const quotaPerUnit = Number(optionCache.get('QuotaPerUnit', 500000));
        const [order] = await db.update(paymentOrders)
            .set({ status: 1, transactionId: b.transaction_id || b.transactionId || `admin_${orderId}`, updatedAt: new Date() })
            .where(and(eq(paymentOrders.id, orderId), eq(paymentOrders.status, 0)))
            .returning({
                id: paymentOrders.id,
                userId: paymentOrders.userId,
                amount: paymentOrders.amount,
                paymentMethod: paymentOrders.paymentMethod,
            });
        if (!order) return apiSuccess(null, 'order already completed or not found');
        const quotaToAdd = Math.floor((Number(order.amount) / 100) * quotaPerUnit);
        await db.update(users)
            .set({ quota: drizzleSql`${users.quota} + ${quotaToAdd}` })
            .where(eq(users.id, order.userId));
        return apiSuccess({ ...order, quotaAdded: quotaToAdd });
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
        try {
            const row = await bindSubscriptionToUser(userId, packageId, 'admin');
            return { success: true, data: row };
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e);
            set.status = message.includes('not found') ? 404 : 400;
            return { success: false, message };
        }
    })
    .get('/subscription/admin/plans', async () => {
        const rows = await db.select().from(packages).orderBy(desc(packages.sortOrder), desc(packages.id));
        return apiSuccess(rows.map(wrapNewApiSubscriptionPlan));
    })
    .post('/subscription/admin/plans', async ({ body, user, set }: ElysiaCtx) => {
        const values = newApiPlanToPackageValues((body || {}) as Record<string, any>);
        if (!values.name) { set.status = 400; return { success: false, message: 'plan.title is required' }; }
        const [row] = await db.insert(packages).values({
            ...values,
            addedBy: (user as UserRecord | undefined)?.id || null,
        }).returning();
        return apiSuccess(wrapNewApiSubscriptionPlan(row));
    })
    .put('/subscription/admin/plans/:id', async ({ params, body, set }: ElysiaCtx) => {
        const id = Number(params.id);
        if (!id) { set.status = 400; return { success: false, message: 'invalid plan id' }; }
        const [old] = await db.select().from(packages).where(eq(packages.id, id)).limit(1);
        if (!old) { set.status = 404; return { success: false, message: 'Subscription plan not found' }; }
        const values = newApiPlanToPackageValues((body || {}) as Record<string, any>);
        if (!values.name) { set.status = 400; return { success: false, message: 'plan.title is required' }; }
        const [row] = await db.update(packages).set({
            ...values,
            updatedAt: new Date(),
        }).where(eq(packages.id, id)).returning();
        return apiSuccess(wrapNewApiSubscriptionPlan(row));
    })
    .patch('/subscription/admin/plans/:id', async ({ params, body, set }: ElysiaCtx) => {
        const id = Number(params.id);
        const enabled = (body as Record<string, any>)?.enabled;
        if (!id || typeof enabled !== 'boolean') { set.status = 400; return { success: false, message: 'id and boolean enabled are required' }; }
        const [row] = await db.update(packages).set({ enabled, updatedAt: new Date() })
            .where(eq(packages.id, id))
            .returning();
        if (!row) { set.status = 404; return { success: false, message: 'Subscription plan not found' }; }
        return apiSuccess(wrapNewApiSubscriptionPlan(row));
    })
    .post('/subscription/admin/bind', async ({ body, set }: ElysiaCtx) => {
        const b = body as Record<string, any>;
        const userId = Number(b.user_id || b.userId);
        const packageId = resolveSubscriptionPlanId(b);
        if (!userId || !packageId) { set.status = 400; return { success: false, message: 'user_id and plan_id are required' }; }
        try {
            const row = await bindSubscriptionToUser(userId, packageId, 'admin');
            return apiSuccess(row);
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e);
            set.status = message.includes('not found') ? 404 : 400;
            return { success: false, message };
        }
    })
    .get('/subscription/admin/users/:id/subscriptions', async ({ params, set }: ElysiaCtx) => {
        const userId = Number(params.id);
        if (!userId) { set.status = 400; return { success: false, message: 'invalid user id' }; }
        return apiSuccess(await listUserSubscriptionSummaries(userId));
    })
    .post('/subscription/admin/users/:id/subscriptions', async ({ params, body, set }: ElysiaCtx) => {
        const userId = Number(params.id);
        const packageId = resolveSubscriptionPlanId((body || {}) as Record<string, any>);
        if (!userId || !packageId) { set.status = 400; return { success: false, message: 'user id and plan_id are required' }; }
        try {
            const row = await bindSubscriptionToUser(userId, packageId, 'admin');
            return apiSuccess(row);
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e);
            set.status = message.includes('not found') ? 404 : 400;
            return { success: false, message };
        }
    })
    .post('/subscription/admin/user_subscriptions/:id/invalidate', async ({ params, set }: ElysiaCtx) => {
        try {
            await cancelSubscription(Number(params.id), false);
            return apiSuccess(null);
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e);
            set.status = message.includes('not found') ? 404 : 400;
            return { success: false, message };
        }
    })
    .delete('/subscription/admin/user_subscriptions/:id', async ({ params, set }: ElysiaCtx) => {
        try {
            await cancelSubscription(Number(params.id), true);
            return apiSuccess(null);
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e);
            set.status = message.includes('not found') ? 404 : 400;
            return { success: false, message };
        }
    })
    .get('/group', async () => {
        return await db.select().from(userGroups).orderBy(desc(userGroups.createdAt));
    })
    .post('/custom-oauth-provider/discovery', async ({ body, set }: ElysiaCtx) => {
        try {
            const discovery = await fetchOAuthDiscovery((body || {}) as Record<string, any>);
            return { success: true, data: discovery };
        } catch (e: unknown) {
            set.status = 400;
            return { success: false, message: e instanceof Error ? e.message : String(e) };
        }
    })
    .get('/custom-oauth-provider', async () => {
        const rows = await db.select({
            id: customOAuthProviders.id,
            name: customOAuthProviders.name,
            issuer: customOAuthProviders.issuer,
            discoveryUrl: customOAuthProviders.discoveryUrl,
            clientId: customOAuthProviders.clientId,
            authorizationEndpoint: customOAuthProviders.authorizationEndpoint,
            tokenEndpoint: customOAuthProviders.tokenEndpoint,
            userinfoEndpoint: customOAuthProviders.userinfoEndpoint,
            jwksUri: customOAuthProviders.jwksUri,
            scopes: customOAuthProviders.scopes,
            enabled: customOAuthProviders.enabled,
            metadata: customOAuthProviders.metadata,
            createdAt: customOAuthProviders.createdAt,
            updatedAt: customOAuthProviders.updatedAt,
        }).from(customOAuthProviders).orderBy(desc(customOAuthProviders.id));
        return { success: true, data: rows };
    })
    .get('/custom-oauth-provider/:id', async ({ params, set }: ElysiaCtx) => {
        const [row] = await db.select({
            id: customOAuthProviders.id,
            name: customOAuthProviders.name,
            issuer: customOAuthProviders.issuer,
            discoveryUrl: customOAuthProviders.discoveryUrl,
            clientId: customOAuthProviders.clientId,
            clientSecret: customOAuthProviders.clientSecret,
            authorizationEndpoint: customOAuthProviders.authorizationEndpoint,
            tokenEndpoint: customOAuthProviders.tokenEndpoint,
            userinfoEndpoint: customOAuthProviders.userinfoEndpoint,
            jwksUri: customOAuthProviders.jwksUri,
            scopes: customOAuthProviders.scopes,
            enabled: customOAuthProviders.enabled,
            metadata: customOAuthProviders.metadata,
            createdAt: customOAuthProviders.createdAt,
            updatedAt: customOAuthProviders.updatedAt,
        }).from(customOAuthProviders).where(eq(customOAuthProviders.id, Number(params.id))).limit(1);
        if (!row) {
            set.status = 404;
            return { success: false, message: `Custom OAuth provider '${params.id}' not found` };
        }
        return { success: true, data: row };
    })
    .post('/custom-oauth-provider', async ({ body, set }: ElysiaCtx) => {
        const b = (body || {}) as Record<string, any>;
        if (!b.name) {
            set.status = 400;
            return { success: false, message: 'name is required' };
        }
        try {
            const discovery = (b.discoveryUrl || b.discovery_url || b.issuer) ? await fetchOAuthDiscovery(b) : null;
            const [row] = await db.insert(customOAuthProviders).values({
                name: String(b.name),
                issuer: discovery?.issuer ?? b.issuer ?? null,
                discoveryUrl: discovery?.discoveryUrl ?? b.discoveryUrl ?? b.discovery_url ?? null,
                clientId: b.clientId ?? b.client_id ?? null,
                clientSecret: b.clientSecret ?? b.client_secret ?? null,
                authorizationEndpoint: discovery?.authorizationEndpoint ?? b.authorizationEndpoint ?? b.authorization_endpoint ?? null,
                tokenEndpoint: discovery?.tokenEndpoint ?? b.tokenEndpoint ?? b.token_endpoint ?? null,
                userinfoEndpoint: discovery?.userinfoEndpoint ?? b.userinfoEndpoint ?? b.userinfo_endpoint ?? null,
                jwksUri: discovery?.jwksUri ?? b.jwksUri ?? b.jwks_uri ?? null,
                scopes: discovery?.scopes ?? (Array.isArray(b.scopes) ? b.scopes : []),
                enabled: b.enabled ?? true,
                metadata: discovery?.metadata ?? (b.metadata || {}),
            }).returning({
                id: customOAuthProviders.id,
                name: customOAuthProviders.name,
                issuer: customOAuthProviders.issuer,
                discoveryUrl: customOAuthProviders.discoveryUrl,
                enabled: customOAuthProviders.enabled,
                createdAt: customOAuthProviders.createdAt,
            });
            return { success: true, data: row };
        } catch (e: unknown) {
            set.status = 400;
            return { success: false, message: e instanceof Error ? e.message : String(e) };
        }
    })
    .put('/custom-oauth-provider/:id', async ({ params, body, set }: ElysiaCtx) => {
        const id = Number(params.id);
        if (!id) {
            set.status = 400;
            return { success: false, message: 'invalid id' };
        }
        const [old] = await db.select().from(customOAuthProviders).where(eq(customOAuthProviders.id, id)).limit(1);
        if (!old) {
            set.status = 404;
            return { success: false, message: 'Custom OAuth provider not found' };
        }
        const b = (body || {}) as Record<string, any>;
        try {
            const shouldRefreshDiscovery = Boolean(b.discoveryUrl || b.discovery_url || b.issuer);
            const discovery = shouldRefreshDiscovery ? await fetchOAuthDiscovery(b) : null;
            const [row] = await db.update(customOAuthProviders).set({
                name: b.name ?? old.name,
                issuer: discovery?.issuer ?? b.issuer ?? old.issuer,
                discoveryUrl: discovery?.discoveryUrl ?? b.discoveryUrl ?? b.discovery_url ?? old.discoveryUrl,
                clientId: b.clientId ?? b.client_id ?? old.clientId,
                clientSecret: b.clientSecret ?? b.client_secret ?? old.clientSecret,
                authorizationEndpoint: discovery?.authorizationEndpoint ?? b.authorizationEndpoint ?? b.authorization_endpoint ?? old.authorizationEndpoint,
                tokenEndpoint: discovery?.tokenEndpoint ?? b.tokenEndpoint ?? b.token_endpoint ?? old.tokenEndpoint,
                userinfoEndpoint: discovery?.userinfoEndpoint ?? b.userinfoEndpoint ?? b.userinfo_endpoint ?? old.userinfoEndpoint,
                jwksUri: discovery?.jwksUri ?? b.jwksUri ?? b.jwks_uri ?? old.jwksUri,
                scopes: discovery?.scopes ?? (Array.isArray(b.scopes) ? b.scopes : old.scopes),
                enabled: b.enabled ?? old.enabled,
                metadata: discovery?.metadata ?? b.metadata ?? old.metadata,
                updatedAt: new Date(),
            }).where(eq(customOAuthProviders.id, id)).returning({
                id: customOAuthProviders.id,
                name: customOAuthProviders.name,
                issuer: customOAuthProviders.issuer,
                discoveryUrl: customOAuthProviders.discoveryUrl,
                enabled: customOAuthProviders.enabled,
                updatedAt: customOAuthProviders.updatedAt,
            });
            return { success: true, data: row };
        } catch (e: unknown) {
            set.status = 400;
            return { success: false, message: e instanceof Error ? e.message : String(e) };
        }
    })
    .delete('/custom-oauth-provider/:id', async ({ params, set }: ElysiaCtx) => {
        const rows = await db.delete(customOAuthProviders).where(eq(customOAuthProviders.id, Number(params.id))).returning({ id: customOAuthProviders.id });
        if (rows.length === 0) {
            set.status = 404;
            return { success: false, message: 'Custom OAuth provider not found' };
        }
        return { success: true, deleted: rows[0].id };
    })
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
    .get('/redemption', async () => {
        return apiSuccess(await db.select().from(redemptions).where(drizzleSql`${redemptions.deletedAt} IS NULL`).orderBy(desc(redemptions.id)).limit(200));
    })
    .get('/redemption/search', async ({ query }: ElysiaCtx) => {
        const keyword = String(query?.keyword || query?.q || '').trim();
        const pattern = `%${keyword}%`;
        const rows = await db.select().from(redemptions)
            .where(and(
                drizzleSql`${redemptions.deletedAt} IS NULL`,
                or(ilike(redemptions.name, pattern), ilike(redemptions.key, pattern))
            ))
            .orderBy(desc(redemptions.id))
            .limit(100);
        return apiSuccess(rows);
    })
    .get('/redemption/:id', async ({ params, set }: ElysiaCtx) => {
        const [row] = await db.select().from(redemptions).where(eq(redemptions.id, Number(params.id))).limit(1);
        if (!row || row.deletedAt) { set.status = 404; return { success: false, message: 'Redemption not found' }; }
        return apiSuccess(row);
    })
    .post('/redemption', async ({ body, user, set }: ElysiaCtx) => {
        const b = body as Record<string, any>;
        if (!b.name) { set.status = 400; return { success: false, message: 'name is required' }; }
        const key = b.key || `cdk-${Bun.randomUUIDv7('hex')}`;
        const [row] = await db.insert(redemptions).values({
            name: b.name,
            key,
            quota: Number(b.quota || 0),
            count: Number(b.count || 1),
            status: Number(b.status || 1),
            expiresAt: b.expiredTime || b.expired_time || b.expiresAt || null,
            createdBy: (user as UserRecord | undefined)?.id || null,
        }).returning();
        return apiSuccess(row);
    })
    .put('/redemption', async ({ body, set }: ElysiaCtx) => {
        const b = body as Record<string, any>;
        const id = Number(b.id);
        if (!id) { set.status = 400; return { success: false, message: 'id is required' }; }
        const [row] = await db.update(redemptions).set({
            ...(b.name !== undefined && { name: b.name }),
            ...(b.key !== undefined && { key: b.key }),
            ...(b.quota !== undefined && { quota: Number(b.quota) }),
            ...(b.count !== undefined && { count: Number(b.count) }),
            ...(b.status !== undefined && { status: Number(b.status) }),
            ...(b.expiredTime !== undefined && { expiresAt: b.expiredTime }),
            ...(b.expired_time !== undefined && { expiresAt: b.expired_time }),
            ...(b.expiresAt !== undefined && { expiresAt: b.expiresAt }),
        }).where(eq(redemptions.id, id)).returning();
        if (!row) { set.status = 404; return { success: false, message: 'Redemption not found' }; }
        return apiSuccess(row);
    })
    .delete('/redemption/invalid', async () => {
        const rows = await db.update(redemptions)
            .set({ deletedAt: new Date(), status: 2 })
            .where(or(
                drizzleSql`${redemptions.usedCount} >= ${redemptions.count}`,
                drizzleSql`${redemptions.expiresAt} IS NOT NULL AND ${redemptions.expiresAt} < NOW()`
            ))
            .returning({ id: redemptions.id });
        return apiSuccess({ deleted: rows.length });
    })
    .delete('/redemption/:id', async ({ params, set }: ElysiaCtx) => {
        const [row] = await db.update(redemptions)
            .set({ deletedAt: new Date(), status: 2 })
            .where(eq(redemptions.id, Number(params.id)))
            .returning({ id: redemptions.id });
        if (!row) { set.status = 404; return { success: false, message: 'Redemption not found' }; }
        return apiSuccess({ deleted: row.id });
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
        const rows = await db.select().from(packages)
            .where(and(eq(packages.isPublic, true), eq(packages.enabled, true)))
            .orderBy(desc(packages.sortOrder), packages.price);
        return apiSuccess(rows.filter((pkg) => {
            const allowedGroups = Array.isArray(pkg.allowedGroups) ? pkg.allowedGroups : [];
            return allowedGroups.length === 0 || allowedGroups.includes(currentUser.group || 'default');
        }).map(wrapNewApiSubscriptionPlan));
    })
    .get('/subscription/self', async ({ user }: ElysiaCtx) => {
        const currentUser = user as UserRecord | undefined;
        if (!currentUser) return { success: false, message: 'Authentication required' };
        const [userRow] = await db.select({ billingPreference: users.billingPreference }).from(users).where(eq(users.id, currentUser.id)).limit(1);
        const allSubscriptions = await listUserSubscriptionSummaries(currentUser.id);
        const now = Date.now();
        const activeSubscriptions = allSubscriptions.filter((sub) => {
            const endTime = sub.endTime ? new Date(sub.endTime).getTime() : 0;
            return Number(sub.status) === 1 && endTime > now;
        });
        return apiSuccess({
            billing_preference: normalizeBillingPreference(userRow?.billingPreference),
            subscriptions: activeSubscriptions,
            all_subscriptions: allSubscriptions,
        });
    })
    .put('/subscription/self/preference', async ({ user, body, set }: ElysiaCtx) => {
        const currentUser = user as UserRecord | undefined;
        if (!currentUser) { set.status = 401; return { success: false, message: 'Authentication required' }; }
        const preference = normalizeBillingPreference((body as Record<string, any>).billing_preference ?? (body as Record<string, any>).billingPreference);
        await db.update(users).set({ billingPreference: preference, updatedAt: new Date() }).where(eq(users.id, currentUser.id));
        return apiSuccess({ billing_preference: preference });
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
            billingPreference: users.billingPreference,
            quotaDisplayType: users.quotaDisplayType,
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
            billingPreference: b.billingPreference,
            quotaDisplayType: b.quotaDisplayType,
            updatedAt: new Date(),
        }).where(eq(users.id, currentUser.id)).returning({
            id: users.id,
            username: users.username,
            email: users.email,
            name: users.name,
            currency: users.currency,
            billingPreference: users.billingPreference,
            quotaDisplayType: users.quotaDisplayType,
            updatedAt: users.updatedAt,
        });
        return { success: true, data: row };
    })
    .put('/user/setting', async ({ user, body, set }: ElysiaCtx) => {
        const currentUser = user as UserRecord | undefined;
        if (!currentUser) { set.status = 401; return { success: false, message: 'Authentication required' }; }
        const payload = (body || {}) as Record<string, any>;
        const preference = payload.billing_preference ?? payload.billingPreference;
        const quotaDisplayType = payload.quota_display_type ?? payload.quotaDisplayType;
        const [row] = await db.update(users).set({
            ...(preference !== undefined && { billingPreference: normalizeBillingPreference(preference) }),
            ...(quotaDisplayType !== undefined && { quotaDisplayType: String(quotaDisplayType) }),
            ...(payload.currency !== undefined && { currency: String(payload.currency) }),
            ...(payload.name !== undefined && { name: payload.name }),
            updatedAt: new Date(),
        }).where(eq(users.id, currentUser.id)).returning({
            id: users.id,
            billingPreference: users.billingPreference,
            quotaDisplayType: users.quotaDisplayType,
            currency: users.currency,
            name: users.name,
            updatedAt: users.updatedAt,
        });
        return apiSuccess(row);
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
    .post('/user/aff_transfer', async ({ user, body, set }: ElysiaCtx) => {
        const currentUser = user as UserRecord | undefined;
        if (!currentUser) { set.status = 401; return { success: false, message: 'Authentication required' }; }
        const quota = Number((body as Record<string, any>).quota || 0);
        if (quota <= 0) { set.status = 400; return { success: false, message: 'quota is required' }; }
        const result = await db.transaction(async (tx) => {
            const [aff] = await tx.update(userAff)
                .set({ reward: drizzleSql`${userAff.reward} - ${quota}` })
                .where(and(eq(userAff.userId, currentUser.id), drizzleSql`${userAff.reward} >= ${quota}`))
                .returning({ reward: userAff.reward });
            if (!aff) return null;
            const [updatedUser] = await tx.update(users)
                .set({ quota: drizzleSql`${users.quota} + ${quota}` })
                .where(eq(users.id, currentUser.id))
                .returning({ quota: users.quota });
            return { remainingAffQuota: aff.reward, quota: updatedUser.quota };
        });
        if (!result) { set.status = 400; return { success: false, message: 'Insufficient affiliate quota' }; }
        return apiSuccess(result);
    })
    .get('/user/2fa/status', async ({ user, set }: ElysiaCtx) => {
        const currentUser = user as UserRecord | undefined;
        if (!currentUser) { set.status = 401; return { success: false, message: 'Authentication required' }; }
        const [row] = await db.select({
            twoFactorEnabled: users.twoFactorEnabled,
            twoFactorBackupCodes: users.twoFactorBackupCodes,
            twoFactorPendingSecret: users.twoFactorPendingSecret,
        }).from(users).where(eq(users.id, currentUser.id)).limit(1);
        const backupCodes = Array.isArray(row?.twoFactorBackupCodes) ? row!.twoFactorBackupCodes : [];
        return {
            success: true,
            data: {
                enabled: Boolean(row?.twoFactorEnabled),
                pending: Boolean(row?.twoFactorPendingSecret),
                backupCodesRemaining: backupCodes.length,
            }
        };
    })
    .post('/user/2fa/setup', async ({ user, set }: ElysiaCtx) => {
        const currentUser = user as UserRecord | undefined;
        if (!currentUser) { set.status = 401; return { success: false, message: 'Authentication required' }; }
        const secret = generateTwoFactorSecret();
        const backupCodes = generateBackupCodes();
        const issuer = String(optionCache.get('SystemName', 'Elygate'));
        await db.update(users).set({
            twoFactorPendingSecret: secret,
            twoFactorPendingBackupCodes: hashBackupCodes(backupCodes),
            updatedAt: new Date(),
        }).where(eq(users.id, currentUser.id));
        return {
            success: true,
            data: {
                secret,
                otpauthUrl: buildOtpAuthUrl(secret, currentUser.username, issuer),
                backupCodes,
            }
        };
    })
    .post('/user/2fa/enable', async ({ user, body, set }: ElysiaCtx) => {
        const currentUser = user as UserRecord | undefined;
        if (!currentUser) { set.status = 401; return { success: false, message: 'Authentication required' }; }
        const code = String((body as Record<string, any>).code || '');
        const [row] = await db.select({
            pendingSecret: users.twoFactorPendingSecret,
            pendingCodes: users.twoFactorPendingBackupCodes,
        }).from(users).where(eq(users.id, currentUser.id)).limit(1);
        if (!row?.pendingSecret) { set.status = 400; return { success: false, message: 'No pending 2FA setup' }; }
        if (!verifyTotp(row.pendingSecret, code)) { set.status = 401; return { success: false, message: 'Invalid 2FA code' }; }
        await db.update(users).set({
            twoFactorEnabled: true,
            twoFactorSecret: row.pendingSecret,
            twoFactorBackupCodes: Array.isArray(row.pendingCodes) ? row.pendingCodes : [],
            twoFactorPendingSecret: null,
            twoFactorPendingBackupCodes: [],
            updatedAt: new Date(),
        }).where(eq(users.id, currentUser.id));
        return { success: true };
    })
    .post('/user/2fa/disable', async ({ user, body, set }: ElysiaCtx) => {
        const currentUser = user as UserRecord | undefined;
        if (!currentUser) { set.status = 401; return { success: false, message: 'Authentication required' }; }
        const code = String((body as Record<string, any>).code || '');
        const backupCode = String((body as Record<string, any>).backupCode || (body as Record<string, any>).backup_code || '');
        const [row] = await db.select({
            enabled: users.twoFactorEnabled,
            secret: users.twoFactorSecret,
            backupCodes: users.twoFactorBackupCodes,
        }).from(users).where(eq(users.id, currentUser.id)).limit(1);
        if (!row?.enabled || !row.secret) { set.status = 400; return { success: false, message: '2FA is not enabled' }; }
        const storedCodes = Array.isArray(row.backupCodes) ? row.backupCodes : [];
        const totpValid = code ? verifyTotp(row.secret, code) : false;
        const backupResult = !totpValid && backupCode ? consumeBackupCode(backupCode, storedCodes) : { valid: false, remaining: storedCodes };
        if (!totpValid && !backupResult.valid) { set.status = 401; return { success: false, message: 'Invalid 2FA code' }; }
        await db.update(users).set({
            twoFactorEnabled: false,
            twoFactorSecret: null,
            twoFactorBackupCodes: [],
            twoFactorPendingSecret: null,
            twoFactorPendingBackupCodes: [],
            updatedAt: new Date(),
        }).where(eq(users.id, currentUser.id));
        return { success: true };
    })
    .post('/user/2fa/backup_codes', async ({ user, body, set }: ElysiaCtx) => {
        const currentUser = user as UserRecord | undefined;
        if (!currentUser) { set.status = 401; return { success: false, message: 'Authentication required' }; }
        const code = String((body as Record<string, any>).code || '');
        const [row] = await db.select({
            enabled: users.twoFactorEnabled,
            secret: users.twoFactorSecret,
        }).from(users).where(eq(users.id, currentUser.id)).limit(1);
        if (!row?.enabled || !row.secret) { set.status = 400; return { success: false, message: '2FA is not enabled' }; }
        if (!verifyTotp(row.secret, code)) { set.status = 401; return { success: false, message: 'Invalid 2FA code' }; }
        const backupCodes = generateBackupCodes();
        await db.update(users).set({
            twoFactorBackupCodes: hashBackupCodes(backupCodes),
            updatedAt: new Date(),
        }).where(eq(users.id, currentUser.id));
        return { success: true, data: { backupCodes } };
    })
    .get('/user/passkey', async ({ user, set }: ElysiaCtx) => {
        const currentUser = user as UserRecord | undefined;
        if (!currentUser) { set.status = 401; return { success: false, message: 'Authentication required' }; }
        const passkeys = await listUserPasskeys(currentUser.id);
        return {
            success: true,
            data: {
                enabled: passkeys.length > 0,
                registered: passkeys.length > 0,
                verified: passkeys.some((item) => item.metadata.verified === true),
                passkeys: passkeys.map((item) => ({
                    id: item.id,
                    credentialId: item.credentialId,
                    name: item.name || 'Passkey',
                    transports: item.transports,
                    createdAt: item.createdAt,
                    verified: item.metadata.verified === true,
                    lastUsedAt: item.metadata.lastUsedAt || null,
                })),
            }
        };
    })
    .post('/user/passkey/register/begin', async ({ user, body, set }: ElysiaCtx) => {
        const currentUser = user as UserRecord | undefined;
        if (!currentUser) { set.status = 401; return { success: false, message: 'Authentication required' }; }
        const payload = body as Record<string, any>;
        const displayName = String(payload.displayName || payload.display_name || currentUser.username || 'User');
        const passkeys = await listUserPasskeys(currentUser.id);
        const { challengeToken, challenge } = createPasskeyChallenge('register', currentUser.id);
        const rpId = getPasskeyRpId();
        return {
            success: true,
            data: {
                challengeToken,
                publicKey: {
                    challenge,
                    rp: { id: rpId, name: String(optionCache.get('SystemName', 'Elygate')) },
                    user: {
                        id: String(currentUser.id),
                        name: currentUser.username,
                        displayName,
                    },
                    pubKeyCredParams: [
                        { type: 'public-key', alg: -7 },
                        { type: 'public-key', alg: -257 },
                    ],
                    authenticatorSelection: { userVerification: 'preferred' },
                    timeout: 60000,
                    excludeCredentials: passkeys.map((item) => ({
                        id: item.credentialId,
                        type: 'public-key',
                        transports: item.transports.length > 0 ? item.transports : ['internal'],
                    })),
                }
            }
        };
    })
    .post('/user/passkey/register/finish', async ({ user, body, set }: ElysiaCtx) => {
        const currentUser = user as UserRecord | undefined;
        if (!currentUser) { set.status = 401; return { success: false, message: 'Authentication required' }; }
        const payload = body as Record<string, any>;
        const challengeToken = String(payload.challengeToken || payload.challenge_token || '');
        if (!challengeToken) { set.status = 400; return { success: false, message: 'challengeToken is required' }; }
        const challenge = consumePasskeyChallenge(challengeToken, 'register');
        if (!challenge || challenge.userId !== currentUser.id) {
            set.status = 401;
            return { success: false, message: 'Invalid or expired challenge' };
        }
        const credentialId = extractCredentialId(payload);
        if (!credentialId) { set.status = 400; return { success: false, message: 'credentialId is required' }; }

        const transports = Array.isArray(payload.transports)
            ? payload.transports.filter((item): item is string => typeof item === 'string')
            : ['internal'];
        const metadata = {
            name: String(payload.name || payload.deviceName || payload.device_name || 'Passkey'),
            transports,
            verified: false,
            registeredAt: new Date().toISOString(),
        };

        const [existing] = await db.select({ id: oauthAccounts.id }).from(oauthAccounts)
            .where(and(eq(oauthAccounts.userId, currentUser.id), eq(oauthAccounts.providerUserId, credentialId)))
            .limit(1);
        if (existing) {
            await db.update(oauthAccounts).set({
                accessToken: JSON.stringify(metadata),
            }).where(eq(oauthAccounts.id, existing.id));
        } else {
            await db.insert(oauthAccounts).values({
                userId: currentUser.id,
                provider: `${PASSKEY_PROVIDER_PREFIX}${credentialId}`,
                providerUserId: credentialId,
                accessToken: JSON.stringify(metadata),
            });
        }
        return { success: true, data: { credentialId, registered: true } };
    })
    .post('/user/passkey/verify/begin', async ({ user, body, set }: ElysiaCtx) => {
        const currentUser = user as UserRecord | undefined;
        if (!currentUser) { set.status = 401; return { success: false, message: 'Authentication required' }; }
        const payload = body as Record<string, any>;
        const credentialId = String(payload.credentialId || payload.credential_id || '');
        const passkeys = await listUserPasskeys(currentUser.id);
        if (passkeys.length === 0) { set.status = 400; return { success: false, message: 'No passkey registered' }; }
        const targetCredentialId = credentialId || passkeys[0].credentialId;
        if (!passkeys.some((item) => item.credentialId === targetCredentialId)) {
            set.status = 404;
            return { success: false, message: 'Passkey not found' };
        }
        const { challengeToken, challenge } = createPasskeyChallenge('verify', currentUser.id);
        return {
            success: true,
            data: {
                challengeToken,
                credentialId: targetCredentialId,
                publicKey: {
                    challenge,
                    rpId: getPasskeyRpId(),
                    timeout: 60000,
                    userVerification: 'preferred',
                    allowCredentials: [{
                        id: targetCredentialId,
                        type: 'public-key',
                    }],
                }
            }
        };
    })
    .post('/user/passkey/verify/finish', async ({ user, body, set }: ElysiaCtx) => {
        const currentUser = user as UserRecord | undefined;
        if (!currentUser) { set.status = 401; return { success: false, message: 'Authentication required' }; }
        const payload = body as Record<string, any>;
        const challengeToken = String(payload.challengeToken || payload.challenge_token || '');
        if (!challengeToken) { set.status = 400; return { success: false, message: 'challengeToken is required' }; }
        const challenge = consumePasskeyChallenge(challengeToken, 'verify');
        if (!challenge || challenge.userId !== currentUser.id) {
            set.status = 401;
            return { success: false, message: 'Invalid or expired challenge' };
        }
        const credentialId = extractCredentialId(payload);
        if (!credentialId) { set.status = 400; return { success: false, message: 'credentialId is required' }; }
        const [passkey] = await db.select({
            id: oauthAccounts.id,
            metadata: oauthAccounts.accessToken,
        }).from(oauthAccounts)
            .where(and(eq(oauthAccounts.userId, currentUser.id), eq(oauthAccounts.providerUserId, credentialId), ilike(oauthAccounts.provider, `${PASSKEY_PROVIDER_PREFIX}%`)))
            .limit(1);
        if (!passkey) { set.status = 404; return { success: false, message: 'Passkey not found' }; }

        const metadata = parsePasskeyMetadata(passkey.metadata);
        metadata.verified = true;
        metadata.lastVerifiedAt = new Date().toISOString();
        await db.update(oauthAccounts).set({
            accessToken: JSON.stringify(metadata),
        }).where(eq(oauthAccounts.id, passkey.id));
        return { success: true, data: { credentialId, verified: true } };
    })
    .delete('/user/passkey', async ({ user, body, set }: ElysiaCtx) => {
        const currentUser = user as UserRecord | undefined;
        if (!currentUser) { set.status = 401; return { success: false, message: 'Authentication required' }; }
        const payload = (body || {}) as Record<string, any>;
        const credentialId = String(payload.credentialId || payload.credential_id || '').trim();
        if (credentialId) {
            const rows = await db.delete(oauthAccounts)
                .where(and(eq(oauthAccounts.userId, currentUser.id), eq(oauthAccounts.providerUserId, credentialId), ilike(oauthAccounts.provider, `${PASSKEY_PROVIDER_PREFIX}%`)))
                .returning({ id: oauthAccounts.id });
            if (rows.length === 0) { set.status = 404; return { success: false, message: 'Passkey not found' }; }
            return { success: true, deleted: rows.length };
        }
        const rows = await db.delete(oauthAccounts)
            .where(and(eq(oauthAccounts.userId, currentUser.id), ilike(oauthAccounts.provider, `${PASSKEY_PROVIDER_PREFIX}%`)))
            .returning({ id: oauthAccounts.id });
        return { success: true, deleted: rows.length };
    })
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
        const rewardMin = Number(optionCache.get('CheckinRewardMin', optionCache.get('CheckinReward', 100000)));
        const rewardMax = Number(optionCache.get('CheckinRewardMax', optionCache.get('CheckinReward', 100000)));
        return { success: true, data: { enabled: String(optionCache.get('CheckinEnabled', 'false')) === 'true', checkedIn: !!row, rewardMin, rewardMax } };
    })
    .post('/user/checkin', async ({ user, set }: ElysiaCtx) => {
        const currentUser = user as UserRecord | undefined;
        if (!currentUser) { set.status = 401; return { success: false, message: 'Authentication required' }; }
        if (String(optionCache.get('CheckinEnabled', 'false')) !== 'true') { set.status = 403; return { success: false, message: 'Checkin is disabled' }; }
        const rewardMin = Number(optionCache.get('CheckinRewardMin', optionCache.get('CheckinReward', 100000)));
        const rewardMax = Number(optionCache.get('CheckinRewardMax', optionCache.get('CheckinReward', 100000)));
        const rewardFloor = Math.min(rewardMin, rewardMax);
        const rewardCeil = Math.max(rewardMin, rewardMax);
        const reward = rewardFloor + Math.floor(Math.random() * Math.max(rewardCeil - rewardFloor + 1, 1));
        const today = new Date().toISOString().split('T')[0];
        const [existing] = await db.select({ id: drizzleSql<number>`id` }).from(drizzleSql`user_checkins`).where(drizzleSql`user_id = ${currentUser.id} AND checkin_date = ${today}`) as any;
        if (existing) { set.status = 409; return { success: false, message: 'Already checked in today' }; }
        await db.execute(drizzleSql`INSERT INTO user_checkins (user_id, checkin_date, reward) VALUES (${currentUser.id}, ${today}, ${reward})`);
        await db.update(users).set({ quota: drizzleSql`${users.quota} + ${reward}` }).where(eq(users.id, currentUser.id));
        return { success: true, reward };
    })
    .get('/user/topup/info', async () => {
        const amountOptions = String(optionCache.get('AmountOptions', ''));
        const amountDiscount = String(optionCache.get('AmountDiscount', '{}'));
        return {
            success: true,
            data: {
                enabled: String(optionCache.get('PaymentEnabled', 'true')) === 'true',
                methods: optionCache.get('PaymentMethods', 'redemption'),
                quotaPerUnit: Number(optionCache.get('QuotaPerUnit', 500000)),
                exchangeRate: Number(optionCache.get('ExchangeRate', 7.2)),
                amountOptions,
                amountDiscount,
                paymentComplianceConfirmed: String(optionCache.get('PaymentComplianceConfirmed', 'false')) === 'true',
                paymentComplianceTermsVersion: String(optionCache.get('PaymentComplianceTermsVersion', '')),
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
    .post('/user/creem/pay', async ({ user, body, set }: ElysiaCtx) => {
        const currentUser = user as UserRecord | undefined;
        if (!currentUser) { set.status = 401; return { success: false, message: 'Authentication required' }; }
        try {
            return await createTopupPaymentOrder(currentUser.id, Number((body as Record<string, any>).amount), 'creem');
        } catch (e: unknown) {
            set.status = 500;
            return { success: false, message: e instanceof Error ? e.message : String(e) };
        }
    })
    .post('/user/waffo/pay', async ({ user, body, set }: ElysiaCtx) => {
        const currentUser = user as UserRecord | undefined;
        if (!currentUser) { set.status = 401; return { success: false, message: 'Authentication required' }; }
        try {
            return await createTopupPaymentOrder(currentUser.id, Number((body as Record<string, any>).amount), 'waffo');
        } catch (e: unknown) {
            set.status = 500;
            return { success: false, message: e instanceof Error ? e.message : String(e) };
        }
    })
    .post('/user/waffo/amount', async ({ body, set }: ElysiaCtx) => {
        const amount = Number((body as Record<string, any>).amount || 0);
        if (!amount || amount <= 0) { set.status = 400; return { success: false, message: 'Invalid amount' }; }
        const quotaPerUnit = Number(optionCache.get('QuotaPerUnit', 500000));
        return { success: true, data: { amount, quota: Math.floor((amount / 100) * quotaPerUnit), provider: 'waffo' } };
    })
    .post('/user/waffo-pancake/amount', async ({ body, set }: ElysiaCtx) => {
        const amount = getMoneyAmount((body || {}) as Record<string, any>);
        if (!amount || amount <= 0) { set.status = 400; return { success: false, message: 'Invalid amount' }; }
        return topupAmountPreview(amount, 'waffo-pancake');
    })
    .post('/user/waffo-pancake/pay', async ({ set }: ElysiaCtx) => {
        set.status = 400;
        return { success: false, disabled: true, provider: 'waffo-pancake', message: 'Waffo-Pancake payment is not configured in Elygate core compatibility mode' };
    })
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
    .post('/subscription/epay/pay', async ({ user, body, set }: ElysiaCtx) => {
        const currentUser = user as UserRecord | undefined;
        if (!currentUser) { set.status = 401; return { success: false, message: 'Authentication required' }; }
        const payload = body as Record<string, any>;
        const packageId = Number(payload.packageId || payload.package_id || payload.id);
        if (!packageId) { set.status = 400; return { success: false, message: 'packageId is required' }; }
        try {
            return await createSubscriptionPaymentOrder(currentUser.id, packageId, 'epay');
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e);
            set.status = message.includes('not found') || message.includes('required') || message.includes('Invalid') ? 400 : 500;
            return { success: false, message };
        }
    })
    .post('/subscription/stripe/pay', async ({ user, body, set }: ElysiaCtx) => {
        const currentUser = user as UserRecord | undefined;
        if (!currentUser) { set.status = 401; return { success: false, message: 'Authentication required' }; }
        const payload = body as Record<string, any>;
        const packageId = Number(payload.packageId || payload.package_id || payload.id);
        if (!packageId) { set.status = 400; return { success: false, message: 'packageId is required' }; }
        try {
            return await createSubscriptionPaymentOrder(currentUser.id, packageId, 'stripe');
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e);
            set.status = message.includes('not found') || message.includes('required') || message.includes('Invalid') ? 400 : 500;
            return { success: false, message };
        }
    })
    .post('/subscription/creem/pay', async ({ user, body, set }: ElysiaCtx) => {
        const currentUser = user as UserRecord | undefined;
        if (!currentUser) { set.status = 401; return { success: false, message: 'Authentication required' }; }
        const payload = body as Record<string, any>;
        const packageId = Number(payload.packageId || payload.package_id || payload.id);
        if (!packageId) { set.status = 400; return { success: false, message: 'packageId is required' }; }
        try {
            return await createSubscriptionPaymentOrder(currentUser.id, packageId, 'creem');
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e);
            set.status = message.includes('not found') || message.includes('required') || message.includes('Invalid') ? 400 : 500;
            return { success: false, message };
        }
    })
    .post('/subscription/waffo-pancake/pay', async ({ set }: ElysiaCtx) => {
        set.status = 400;
        return { success: false, disabled: true, provider: 'waffo-pancake', message: 'Waffo-Pancake subscription payment is not configured in Elygate core compatibility mode' };
    })
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
    .post('/user/register', async ({ body, set }: ElysiaCtx) => {
        try {
            const row = await registerCompatUser((body || {}) as Record<string, any>);
            return apiSuccess(row, 'Registration successful');
        } catch (e: unknown) {
            set.status = 400;
            return { success: false, message: e instanceof Error ? e.message : String(e) };
        }
    })
    .post('/user/login', async ({ body, set, request, cookie: { auth_session } }: ElysiaCtx) => {
        try {
            return await loginCompatUser((body || {}) as Record<string, any>, request, auth_session);
        } catch (e: unknown) {
            set.status = 401;
            return { success: false, message: e instanceof Error ? e.message : String(e) };
        }
    })
    .get('/user/logout', async ({ cookie: { auth_session } }: ElysiaCtx) => {
        if (auth_session.value) {
            await db.delete(sessions).where(eq(sessions.token, auth_session.value));
        }
        auth_session.remove();
        return { success: true, message: 'Logged out successfully' };
    })
    .post('/user/logout', async ({ cookie: { auth_session } }: ElysiaCtx) => {
        if (auth_session.value) {
            await db.delete(sessions).where(eq(sessions.token, auth_session.value));
        }
        auth_session.remove();
        return { success: true, message: 'Logged out successfully' };
    })
    .get('/user/groups', async () => {
        const rows = await db.select().from(userGroups).where(eq(userGroups.status, 1)).orderBy(desc(userGroups.createdAt));
        return apiSuccess(rows);
    })
    .post('/stripe/webhook', handleStripePaymentCallback)
    .post('/creem/webhook', async ({ body, request, set }: ElysiaCtx) => {
        if (!config.creem.webhookSecret) return providerUnsupported('creem');
        const rawBody = typeof body === 'string' ? body : JSON.stringify(body || {});
        const signature = request.headers.get('creem-signature') || '';
        if (!verifyCreemWebhookSignature(rawBody, signature)) {
            set.status = 401; return { success: false, message: 'Invalid Creem signature' };
        }
        const parsed = parseCreemWebhookEvent(body as Record<string, any>);
        if (!parsed) { set.status = 400; return { success: false, message: 'Missing order_id' }; }
        if (parsed.eventType === 'checkout.session.completed' || parsed.eventType === 'payment.completed') {
            const orderId = Number(parsed.orderId);
            if (Number.isFinite(orderId)) {
                await db.transaction(async (tx) => {
                    await completePendingTopupPaymentOrderTx(tx, orderId, parsed.transactionId, async (t, order) => {
                        const quotaPerUnit = Number(optionCache.get('QuotaPerUnit', 500000));
                        const quota = Math.floor((order.amount / 100) * quotaPerUnit);
                        await t.update(users).set({ quota: drizzleSql`${users.quota} + ${quota}` }).where(eq(users.id, order.userId));
                    });
                });
            }
        }
        return { success: true };
    })
    .post('/waffo/webhook', async ({ body, query, request, set }: ElysiaCtx) => {
        if (!config.waffo.webhookSecret) return providerUnsupported('waffo');
        const rawBody = typeof body === 'string' ? body : JSON.stringify(body || {});
        const signature = request.headers.get('waffo-signature') || '';
        if (!verifyWaffoWebhookSignature(rawBody, signature)) {
            set.status = 401; return { success: false, message: 'Invalid Waffo signature' };
        }
        const parsed = parseWaffoWebhookEvent(query || {}, body as Record<string, any>);
        if (!parsed) { set.status = 400; return { success: false, message: 'Missing order_id' }; }
        if (parsed.status === 'success' || parsed.status === 'completed' || parsed.status === 'paid') {
            const orderId = Number(parsed.orderId);
            if (Number.isFinite(orderId)) {
                await db.transaction(async (tx) => {
                    await completePendingTopupPaymentOrderTx(tx, orderId, parsed.transactionId, async (t, order) => {
                        const quotaPerUnit = Number(optionCache.get('QuotaPerUnit', 500000));
                        const quota = Math.floor((order.amount / 100) * quotaPerUnit);
                        await t.update(users).set({ quota: drizzleSql`${users.quota} + ${quota}` }).where(eq(users.id, order.userId));
                    });
                });
            }
        }
        return { success: true };
    })
    .post('/waffo-pancake/webhook/:env', ({ params }: ElysiaCtx) => ({ ...providerUnsupported('waffo-pancake'), env: params.env }))
    .post('/subscription/epay/notify', handleEPayPaymentCallback)
    .get('/subscription/epay/notify', handleEPayPaymentCallback)
    .post('/subscription/epay/return', handleEPayPaymentCallback)
    .get('/subscription/epay/return', handleEPayPaymentCallback)
    .post('/user/login/2fa', async ({ body, set, request, cookie: { auth_session } }: ElysiaCtx) => {
        const payload = body as Record<string, any>;
        const challengeToken = String(payload.challengeToken || payload.challenge_token || '');
        const code = String(payload.code || payload.totp || '');
        const backupCode = String(payload.backupCode || payload.backup_code || '');
        if (!challengeToken) {
            set.status = 400;
            return { success: false, message: 'challengeToken is required' };
        }
        if (!code && !backupCode) {
            set.status = 400;
            return { success: false, message: 'code or backupCode is required' };
        }

        const [challenge] = await db.select().from(twoFactorLoginChallenges)
            .where(and(eq(twoFactorLoginChallenges.id, challengeToken), drizzleSql`${twoFactorLoginChallenges.expiresAt} > NOW()`))
            .limit(1);
        if (!challenge) {
            set.status = 401;
            return { success: false, message: 'Invalid or expired challenge' };
        }

        const [currentUser] = await db.select({
            id: users.id,
            username: users.username,
            role: users.role,
            currency: users.currency,
            twoFactorEnabled: users.twoFactorEnabled,
            twoFactorSecret: users.twoFactorSecret,
            twoFactorBackupCodes: users.twoFactorBackupCodes,
        }).from(users).where(eq(users.id, challenge.userId)).limit(1);
        if (!currentUser || !currentUser.twoFactorEnabled || !currentUser.twoFactorSecret) {
            set.status = 401;
            return { success: false, message: '2FA is not enabled for this account' };
        }

        const storedCodes = Array.isArray(currentUser.twoFactorBackupCodes) ? currentUser.twoFactorBackupCodes : [];
        const totpValid = code ? verifyTotp(currentUser.twoFactorSecret, code) : false;
        const backupResult = !totpValid && backupCode ? consumeBackupCode(backupCode, storedCodes) : { valid: false, remaining: storedCodes };
        if (!totpValid && !backupResult.valid) {
            set.status = 401;
            return { success: false, message: 'Invalid 2FA code' };
        }

        if (backupResult.valid) {
            await db.update(users).set({
                twoFactorBackupCodes: backupResult.remaining,
                updatedAt: new Date(),
            }).where(eq(users.id, currentUser.id));
        }

        await db.delete(twoFactorLoginChallenges).where(eq(twoFactorLoginChallenges.id, challengeToken));
        const { sessionToken } = await authService.createWebSession(
            currentUser.id,
            request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown',
            request.headers.get('user-agent') || 'unknown'
        );
        auth_session.set({
            value: sessionToken,
            httpOnly: true,
            secure: request.headers.get('x-forwarded-proto') === 'https',
            sameSite: 'lax',
            maxAge: 7 * 86400,
            path: '/'
        });
        const tokenKey = await authService.ensureDefaultApiKey(currentUser.id);
        return {
            success: true,
            token: tokenKey,
            username: currentUser.username,
            role: currentUser.role,
            currency: currentUser.currency || 'USD',
        };
    })
    .post('/user/passkey/login/begin', async ({ body, set }: ElysiaCtx) => {
        const payload = body as Record<string, any>;
        const username = String(payload.username || payload.user || '').trim();
        if (!username) {
            set.status = 400;
            return { success: false, message: 'username is required' };
        }
        const [targetUser] = await db.select({
            id: users.id,
            username: users.username,
            role: users.role,
            currency: users.currency,
            status: users.status,
        }).from(users).where(eq(users.username, username)).limit(1);
        if (!targetUser || targetUser.status !== 1) {
            set.status = 401;
            return { success: false, message: 'Invalid credentials' };
        }
        const passkeys = await listUserPasskeys(targetUser.id);
        if (passkeys.length === 0) {
            set.status = 400;
            return { success: false, message: 'Passkey login is not available for this account' };
        }
        const { challengeToken, challenge } = createPasskeyChallenge('login', targetUser.id);
        return {
            success: true,
            data: {
                challengeToken,
                username: targetUser.username,
                publicKey: {
                    challenge,
                    rpId: getPasskeyRpId(),
                    timeout: 60000,
                    userVerification: 'preferred',
                    allowCredentials: passkeys.map((item) => ({
                        id: item.credentialId,
                        type: 'public-key',
                        transports: item.transports.length > 0 ? item.transports : ['internal'],
                    })),
                },
            }
        };
    })
    .post('/user/passkey/login/finish', async ({ body, set, request, cookie: { auth_session } }: ElysiaCtx) => {
        const payload = body as Record<string, any>;
        const challengeToken = String(payload.challengeToken || payload.challenge_token || '');
        if (!challengeToken) {
            set.status = 400;
            return { success: false, message: 'challengeToken is required' };
        }
        const challenge = consumePasskeyChallenge(challengeToken, 'login');
        if (!challenge) {
            set.status = 401;
            return { success: false, message: 'Invalid or expired challenge' };
        }
        const credentialId = extractCredentialId(payload);
        if (!credentialId) {
            set.status = 400;
            return { success: false, message: 'credentialId is required' };
        }
        const [binding] = await db.select({
            id: oauthAccounts.id,
            userId: oauthAccounts.userId,
            metadata: oauthAccounts.accessToken,
        }).from(oauthAccounts)
            .where(and(eq(oauthAccounts.userId, challenge.userId), eq(oauthAccounts.providerUserId, credentialId), ilike(oauthAccounts.provider, `${PASSKEY_PROVIDER_PREFIX}%`)))
            .limit(1);
        if (!binding) {
            set.status = 401;
            return { success: false, message: 'Invalid passkey credential' };
        }

        const [currentUser] = await db.select({
            id: users.id,
            username: users.username,
            role: users.role,
            currency: users.currency,
            status: users.status,
        }).from(users).where(eq(users.id, binding.userId)).limit(1);
        if (!currentUser || currentUser.status !== 1) {
            set.status = 401;
            return { success: false, message: 'Account is unavailable' };
        }

        const metadata = parsePasskeyMetadata(binding.metadata);
        metadata.verified = true;
        metadata.lastUsedAt = new Date().toISOString();
        await db.update(oauthAccounts).set({ accessToken: JSON.stringify(metadata) }).where(eq(oauthAccounts.id, binding.id));

        const { sessionToken } = await authService.createWebSession(
            currentUser.id,
            request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown',
            request.headers.get('user-agent') || 'unknown'
        );
        auth_session.set({
            value: sessionToken,
            httpOnly: true,
            secure: request.headers.get('x-forwarded-proto') === 'https',
            sameSite: 'lax',
            maxAge: 7 * 86400,
            path: '/'
        });
        const tokenKey = await authService.ensureDefaultApiKey(currentUser.id);
        return {
            success: true,
            token: tokenKey,
            username: currentUser.username,
            role: currentUser.role,
            currency: currentUser.currency || 'USD',
        };
    });
