import { log } from '../services/logger';
import { config } from '../config';
import { Elysia } from 'elysia';
import { db } from '@elygate/db';
import { users } from '@elygate/db/schema';
import { count, sql as drizzleSql } from 'drizzle-orm';
import { memoryCache } from '../services/cache';
import { optionCache } from '../services/optionCache';

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
                telegram_oauth: !!config.telegram.botToken
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
        const fixedCostModels = optionCache.get('FixedCostModels', {}) as Record<string, number>;
        return {
            success: true, message: '', data: {
                modelRatio, completionRatio, groupRatio, fixedCostModels,
                content: optionCache.get('PricingContent', ''),
                currencySymbol: optionCache.get('CurrencySymbol', '$'),
                quotaPerUnit: Number(optionCache.get('QuotaPerUnit', 500000)),
                exchangeRate: Number(optionCache.get('ExchangeRate', 7.2)),
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
                fixedCostModels: optionCache.get('FixedCostModels', {}),
                cacheRatio: Number(optionCache.get('CacheRatio', 0.5)),
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
                PaymentEnabled: String(optionCache.get('PaymentEnabled', 'true')) === 'true',
                PaymentMethods: optionCache.get('PaymentMethods', 'redemption'),
                LoginMethods: optionCache.get('LoginMethods', 'password'),
                PasswordLoginEnabled: String(optionCache.get('PasswordLoginEnabled', 'true')) === 'true',
                GitHubOAuthEnabled: String(optionCache.get('GitHubOAuthEnabled', 'false')) === 'true',
                WeChatOAuthEnabled: String(optionCache.get('WeChatOAuthEnabled', 'false')) === 'true',
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
        if (provider === 'github' || provider === 'discord') {
            set.redirect = `/api/auth/${provider}${query}`;
            return;
        }
        if (provider === 'telegram') {
            set.redirect = `/api/auth/telegram${query}`;
            return;
        }
        set.status = 501;
        return { success: false, message: `OAuth provider '${provider}' is not implemented` };
    })
    .get('/oauth/telegram/login', ({ set, request }) => {
        const url = new URL(request.url);
        set.redirect = `/api/auth/telegram${url.search}`;
    })
    .post('/oauth/email/bind', ({ set }) => {
        set.status = 501;
        return { success: false, message: 'Email bind is not implemented' };
    })
    .get('/oauth/wechat', ({ set }) => {
        set.status = 501;
        return { success: false, message: 'WeChat OAuth is not implemented' };
    })
    .post('/oauth/wechat/bind', ({ set }) => {
        set.status = 501;
        return { success: false, message: 'WeChat bind is not implemented' };
    })
    .get('/verification', ({ set }) => {
        set.status = 501;
        return { success: false, message: 'Email verification is not implemented' };
    })
    .get('/reset_password', ({ set }) => {
        set.status = 501;
        return { success: false, message: 'Password reset email is not implemented' };
    })
    .post('/user/reset', ({ set }) => {
        set.status = 501;
        return { success: false, message: 'Password reset is not implemented' };
    })
    .post('/verify', ({ set }) => {
        set.status = 501;
        return { success: false, message: 'Universal verification is not implemented' };
    });
