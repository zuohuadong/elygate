import { config } from '../config';
import { Elysia } from 'elysia';
import { sql } from '@elygate/db';
import { memoryCache } from '../services/cache';
import { optionCache } from '../services/optionCache';

/**
 * System APIs (/api/status, /api/notice, /api/option)
 * These are required by New-API / One-API frontend panels to fetch initial configuration.
 */
export const sysRouter = new Elysia({ prefix: '/api' })
    .get('/status', async () => {
        let dbStatus = 'ok';
        try { await sql`SELECT 1`; } catch { dbStatus = 'error'; }

        return {
            success: true,
            message: "",
            data: {
                version: "v0.5.0-elygate",
                status: dbStatus === 'ok' ? 'running' : 'degraded',
                db: dbStatus,
                cache: memoryCache.lastUpdated > 0 ? 'ok' : 'initializing',
                start_time: Math.floor(Date.now() / 1000 - 3600), // mock uptime
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
        const [dbCheck] = await sql`SELECT 1 as ok`.catch((e: unknown) => { log.warn("[Fallback]", e); return [{ ok: 0 }]; });
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
    .get('/notice', () => {
        return {
            success: true,
            message: "",
            data: optionCache.get('Notice', 'Welcome to Elygate AI Gateway.')
        };
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
    });
