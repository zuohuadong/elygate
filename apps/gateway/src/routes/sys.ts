import type { ElysiaCtx } from '../types';
import { log } from '../services/logger';
import { config } from '../config';
import { Elysia } from 'elysia';
import { db } from '@elygate/db';
import { users } from '@elygate/db/schema';
import { count, sql as drizzleSql } from 'drizzle-orm';
import { memoryCache } from '../services/cache';
import { optionCache } from '../services/optionCache';
import { isSmtpConfigured } from '../services/mail';
import { isCaptchaEnabled, verifyCaptcha, getCaptchaConfig } from '../services/captcha';
import { createAndSendVerification, consumeVerification } from '../services/verification';
import { eq } from 'drizzle-orm';
import { getUserFromCookie } from '../middleware/auth';
import { isPublicRechargeEnabled } from '../services/paymentPolicy';

/**
 * System APIs (/api/status, /api/notice, /api/option)
 * These are required by New-API / One-API frontend panels to fetch initial configuration.
 */
export const sysRouter = new Elysia({ prefix: '/api' })
    .get('/setup', async () => {
        const [{ total }] = await db.select({ total: count() }).from(users);
        return {
            success: true,
            data: {
                initialized: Number(total || 0) > 0,
                needsSetup: Number(total || 0) === 0,
            }
        };
    })
    .post('/setup', async ({ body, set }) => {
        const [{ total }] = await db.select({ total: count() }).from(users);
        if (Number(total || 0) > 0) {
            set.status = 409;
            return { success: false, message: 'System already initialized' };
        }
        const payload = (body || {}) as Record<string, any>;
        if (!payload.username || !payload.password) {
            set.status = 400;
            return { success: false, message: 'username and password are required' };
        }
        const passwordHash = await Bun.password.hash(String(payload.password));
        const [admin] = await db.insert(users).values({
            username: payload.username,
            passwordHash,
            role: 10,
            quota: 100000000,
            status: 1,
            currency: 'USD',
        }).returning({ id: users.id, username: users.username });
        return { success: true, data: admin };
    })
    .get('/status', async () => {
        let dbStatus = 'ok';
        try { await db.execute(drizzleSql`SELECT 1`); } catch { dbStatus = 'error'; }

        return {
            success: true,
            message: "",
            data: {
                version: "v0.5.0-elygate",
                status: dbStatus === 'ok' ? 'running' : 'degraded',
                db: dbStatus,
                cache: memoryCache.lastUpdated > 0 ? 'ok' : 'initializing',
                start_time: Math.floor(Date.now() / 1000 - 3600),
                quota_per_unit: Number(optionCache.get('QuotaPerUnit', 500000)),
                rmb_quota_per_unit: Number(optionCache.get('QuotaPerUnit', 500000)) / Number(optionCache.get('ExchangeRate', 7.2)),
                exchange_rate: Number(optionCache.get('ExchangeRate', 7.2)),
                display_in_currency: String(optionCache.get('DisplayInCurrency', 'false')) === 'true',
                github_oauth: !!config.github.clientId,
                discord_oauth: !!config.discord.clientId,
                telegram_oauth: !!config.telegram.botToken,
                google_oauth: !!config.google.clientId,
                linuxdo_oauth: !!config.linuxdo.clientId,
                wechat_oauth: !!config.wechat.appId,
                captcha_enabled: isCaptchaEnabled(),
                captcha_provider: getCaptchaConfig().provider,
            }
        };
    })
    .get('/health', async () => {
        const [dbCheck] = await db.execute(drizzleSql`SELECT 1 as ok`).catch((e: unknown) => { log.warn("[Fallback]", e); return [{ ok: 0 }]; });
        const channelStats = {
            total: memoryCache.channels.size,
            active: Array.from(memoryCache.channels.values()).filter(c => c.status === 1).length,
            prohibited: Array.from(memoryCache.channels.values()).filter(c => c.status === 3).length,
            halfOpen: Array.from(memoryCache.channels.values()).filter(c => c.status === 4).length,
        };

        return {
            status: dbCheck.ok ? 'healthy' : 'unhealthy',
            timestamp: new Date().toISOString(),
            components: {
                database: dbCheck.ok ? 'up' : 'down',
                cache: memoryCache.lastUpdated > 0 ? 'up' : 'down',
                channels: channelStats
            }
        };
    })
    .get('/uptime/status', async () => {
        const [dbCheck] = await db.execute(drizzleSql`SELECT 1 as ok`).catch(() => [{ ok: 0 }]);
        return {
            success: true,
            data: {
                status: dbCheck.ok ? 'up' : 'down',
                uptime: Math.floor(process.uptime()),
            }
        };
    })
    .get('/notice', () => {
        return {
            success: true,
            message: "",
            data: optionCache.get('Notice', 'Welcome to Elygate AI Gateway.')
        };
    })
    .get('/about', () => {
        return { success: true, message: '', data: optionCache.get('About', '') };
    })
    .get('/privacy-policy', () => {
        return { success: true, message: '', data: optionCache.get('PrivacyPolicy', '') };
    })
    .get('/user-agreement', () => {
        return { success: true, message: '', data: optionCache.get('UserAgreement', '') };
    })
    .get('/pricing', () => {
        const modelRatio = optionCache.get('ModelRatio', {}) as Record<string, number>;
        const completionRatio = optionCache.get('CompletionRatio', {}) as Record<string, number>;
        const groupRatio = optionCache.get('GroupRatio', {}) as Record<string, number>;
        const groupGroupRatio = optionCache.get('GroupGroupRatio', {}) as Record<string, Record<string, number>>;
        const fixedCostModels = optionCache.get('FixedCostModels', {}) as Record<string, number>;
        const imageRatio = optionCache.get('ImageRatio', {}) as Record<string, number>;
        const audioRatio = optionCache.get('AudioRatio', {}) as Record<string, number>;
        const audioCompletionRatio = optionCache.get('AudioCompletionRatio', {}) as Record<string, number>;
        const createCacheRatio = optionCache.get('CreateCacheRatio', {}) as Record<string, number>;
        const cacheRatio = Number(optionCache.get('CacheRatio', 0.5));
        return {
            success: true, message: '', data: {
                modelRatio,
                completionRatio,
                groupRatio,
                groupGroupRatio,
                fixedCostModels,
                imageRatio,
                audioRatio,
                audioCompletionRatio,
                createCacheRatio,
                cacheRatio,
                content: optionCache.get('PricingContent', ''),
                currencySymbol: optionCache.get('CurrencySymbol', '$'),
                quotaPerUnit: Number(optionCache.get('QuotaPerUnit', 500000)),
                exchangeRate: Number(optionCache.get('ExchangeRate', 7.2)),
                quotaDisplayType: String(optionCache.get('QuotaDisplayType', 'USD')),
            }
        };
    })
    .get('/ratio_config', () => {
        return {
            success: true,
            data: {
                modelRatio: optionCache.get('ModelRatio', {}),
                completionRatio: optionCache.get('CompletionRatio', {}),
                groupRatio: optionCache.get('GroupRatio', {}),
                groupGroupRatio: optionCache.get('GroupGroupRatio', {}),
                fixedCostModels: optionCache.get('FixedCostModels', {}),
                cacheRatio: Number(optionCache.get('CacheRatio', 0.5)),
                imageRatio: optionCache.get('ImageRatio', {}),
                audioRatio: optionCache.get('AudioRatio', {}),
                audioCompletionRatio: optionCache.get('AudioCompletionRatio', {}),
                createCacheRatio: optionCache.get('CreateCacheRatio', {}),
            }
        };
    })
    .get('/home_page_content', () => {
        return { success: true, message: '', data: optionCache.get('HomePageContent', '') };
    })
    .get('/groups', () => {
        return { success: true, message: '', data: [{ key: 'default', name: 'Default Group' }] };
    })
    .get('/option', () => {
        return {
            success: true,
            message: "",
            data: {
                GeneralNotice: optionCache.get('GeneralNotice', ''),
                HomePageContent: optionCache.get('HomePageContent', ''),
                About: optionCache.get('About', ''),
                SystemName: optionCache.get('SystemName', 'Elygate API'),
                Logo: optionCache.get('Logo', ''),
                Footer: optionCache.get('Footer', ''),
                Theme: optionCache.get('Theme', 'default'),
                CustomCSS: optionCache.get('CustomCSS', ''),
                CustomJS: optionCache.get('CustomJS', ''),
                Favicon: optionCache.get('Favicon', ''),
                GithubUrl: optionCache.get('GithubUrl', 'https://github.com/zuohuadong/elygate'),
                ServerAddress: optionCache.get('ServerAddress', 'https://api.elygate.com'),
                SMTPConfigured: !!(optionCache.get('SMTPConfig', {}) as {host?: string}).host,
                TelegramConfigured: !!(optionCache.get('TelegramConfig', {}) as {token?: string}).token,
                RegisterMode: optionCache.get('RegisterMode', 'open'),
                QuotaPerUnit: optionCache.get('QuotaPerUnit', 500000),
                CurrencySymbol: optionCache.get('CurrencySymbol', '$'),
                CurrencyName: optionCache.get('CurrencyName', 'USD'),
                ExchangeRate: optionCache.get('ExchangeRate', 7.2),
                DisplayInCurrency: String(optionCache.get('DisplayInCurrency', 'false')) === 'true',
                PaymentEnabled: isPublicRechargeEnabled(optionCache.get('PaymentEnabled', 'false')),
                PaymentMethods: optionCache.get('PaymentMethods', 'redemption'),
                LoginMethods: optionCache.get('LoginMethods', 'password'),
                PasswordLoginEnabled: String(optionCache.get('PasswordLoginEnabled', 'true')) === 'true',
                GitHubOAuthEnabled: String(optionCache.get('GitHubOAuthEnabled', 'false')) === 'true',
                WeChatOAuthEnabled: String(optionCache.get('WeChatOAuthEnabled', 'false')) === 'true',
                CaptchaEnabled: isCaptchaEnabled(),
                CaptchaProvider: getCaptchaConfig().provider,
                CaptchaSiteKey: getCaptchaConfig().siteKey,
            }
        };
    })
    .get('/oauth/state', () => {
        return { success: true, data: { state: Bun.randomUUIDv7('hex') } };
    })
    .get('/oauth/:provider', ({ params, set, request }) => {
        const url = new URL(request.url);
        const query = url.search || '';
        const provider = String(params.provider || '');
        if (provider === 'github' || provider === 'discord' || provider === 'google' || provider === 'linuxdo' || provider === 'wechat') {
            set.redirect = `/api/auth/${provider}${query}`;
            return;
        }
        if (provider === 'telegram') {
            set.redirect = `/api/auth/telegram${query}`;
            return;
        }
        set.status = 501;
        return { success: false, message: `OAuth provider '${provider}' is not supported` };
    })
    .get('/oauth/telegram/login', ({ set, request }) => {
        const url = new URL(request.url);
        set.redirect = `/api/auth/telegram${url.search}`;
    })
    // ─── 邮箱绑定验证码 ───
    .post('/oauth/email/bind', async ({ body, set, request, cookie }: ElysiaCtx) => {
        const authUser = await getUserFromCookie(cookie?.auth_session);
        if (!authUser) { set.status = 401; return { success: false, message: '请先登录' }; }
        const payload = (body || {}) as Record<string, any>;
        const email = String(payload.email || '').trim().toLowerCase();
        if (!email) { set.status = 400; return { success: false, message: '邮箱不能为空' }; }

        const captchaOk = await verifyCaptcha(payload.captcha, request.headers.get('x-real-ip') || request.headers.get('x-forwarded-for') || undefined);
        if (!captchaOk) { set.status = 400; return { success: false, message: '人机验证失败' }; }

        const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
        if (existing && existing.id !== authUser.id) { set.status = 409; return { success: false, message: '该邮箱已被使用' }; }

        const result = await createAndSendVerification({
            type: 'email_bind',
            target: email,
            userId: authUser.id,
            ipAddress: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || undefined,
        });
        if (!result.success) set.status = 400;
        return { success: result.success, message: result.message };
    })
    // ─── 微信 OAuth（配置占位） ───
    .get('/oauth/wechat', ({ set }) => {
        if (!config.wechat.appId) { set.status = 501; return { success: false, message: 'WeChat OAuth is not configured' }; }
        set.redirect = '/api/auth/wechat';
    })
    .post('/oauth/wechat/bind', ({ set }) => {
        if (!config.wechat.appId) { set.status = 501; return { success: false, message: 'WeChat OAuth is not configured' }; }
        // 微信绑定需要前端配合完成 OAuth 流程后调用此端点
        set.status = 501;
        return { success: false, message: 'Please use /api/auth/wechat to start WeChat OAuth flow' };
    })
    // ─── 邮箱验证码发送 ───
    .get('/verification', async ({ query, set, request }: ElysiaCtx) => {
        if (!isSmtpConfigured()) { set.status = 503; return { success: false, message: 'SMTP 未配置，无法发送邮件' }; }
        const email = String((query as Record<string, any>)?.email || '').trim().toLowerCase();
        if (!email) { set.status = 400; return { success: false, message: '邮箱不能为空' }; }

        const result = await createAndSendVerification({
            type: 'email_verification',
            target: email,
            ipAddress: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || undefined,
        });
        if (!result.success) set.status = 429;
        return { success: result.success, message: result.message };
    })
    // ─── 密码重置验证码发送 ───
    .get('/reset_password', async ({ query, set, request }: ElysiaCtx) => {
        if (!isSmtpConfigured()) { set.status = 503; return { success: false, message: 'SMTP 未配置，无法发送邮件' }; }
        const email = String((query as Record<string, any>)?.email || '').trim().toLowerCase();
        if (!email) { set.status = 400; return { success: false, message: '邮箱不能为空' }; }

        const [u] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
        if (!u) { set.status = 404; return { success: false, message: '该邮箱未注册' }; }

        const result = await createAndSendVerification({
            type: 'password_reset',
            target: email,
            userId: u.id,
            ipAddress: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || undefined,
        });
        if (!result.success) set.status = 429;
        return { success: result.success, message: result.message };
    })
    // ─── 密码重置（提交新密码 + 验证码） ───
    .post('/user/reset', async ({ body, set }: ElysiaCtx) => {
        const payload = (body || {}) as Record<string, any>;
        const email = String(payload.email || '').trim().toLowerCase();
        const code = String(payload.code || '').trim();
        const newPassword = String(payload.new_password || payload.password || '').trim();
        if (!email || !code || !newPassword) { set.status = 400; return { success: false, message: '邮箱、验证码和新密码不能为空' }; }

        const verify = await consumeVerification({ type: 'password_reset', target: email, code });
        if (!verify.valid) { set.status = 400; return { success: false, message: verify.message }; }

        const passwordHash = await Bun.password.hash(newPassword);
        await db.update(users).set({ passwordHash }).where(eq(users.email, email));
        return { success: true, message: '密码重置成功' };
    })
    // ─── 通用验证码校验 ───
    .post('/verify', async ({ body, set }: ElysiaCtx) => {
        const payload = (body || {}) as Record<string, any>;
        const email = String(payload.email || '').trim().toLowerCase();
        const code = String(payload.code || '').trim();
        const type = String(payload.type || 'universal') as any;
        if (!email || !code) { set.status = 400; return { success: false, message: '邮箱和验证码不能为空' }; }

        const verify = await consumeVerification({ type, target: email, code });
        if (!verify.valid) { set.status = 400; return { success: false, message: verify.message }; }
        return { success: true, message: '验证成功' };
    });
