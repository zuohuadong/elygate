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
                display_in_currency: optionCache.get('DisplayInCurrency', 'false') === 'true',
                github_oauth: !!process.env.GITHUB_CLIENT_ID,
                discord_oauth: !!process.env.DISCORD_CLIENT_ID,
                telegram_oauth: !!process.env.TELEGRAM_BOT_TOKEN
            }
        };
    })
    .get('/health', async () => {
        const [dbCheck] = await sql`SELECT 1 as ok`.catch(() => [{ ok: 0 }]);
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
                SMTPConfigured: !!optionCache.get('SMTPConfig', {}).host,
                TelegramConfigured: !!optionCache.get('TelegramConfig', {}).token,
                RegisterMode: optionCache.get('RegisterMode', 'open'),
                QuotaPerUnit: optionCache.get('QuotaPerUnit', 500000),
                CurrencySymbol: optionCache.get('CurrencySymbol', '$'),
                CurrencyName: optionCache.get('CurrencyName', 'USD'),
                ExchangeRate: optionCache.get('ExchangeRate', 7.2),
                DisplayInCurrency: optionCache.get('DisplayInCurrency', 'false') === 'true',
                PaymentEnabled: optionCache.get('PaymentEnabled', 'true') === 'true',
                PaymentMethods: optionCache.get('PaymentMethods', 'redemption'),
                LoginMethods: optionCache.get('LoginMethods', 'password'),
                PasswordLoginEnabled: optionCache.get('PasswordLoginEnabled', 'true') === 'true',
                GitHubOAuthEnabled: optionCache.get('GitHubOAuthEnabled', 'false') === 'true',
                WeChatOAuthEnabled: optionCache.get('WeChatOAuthEnabled', 'false') === 'true',
            }
        };
    });
