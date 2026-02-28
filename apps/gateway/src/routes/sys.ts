import { Elysia } from 'elysia';
import { optionCache } from '../services/optionCache';

/**
 * System APIs (/api/status, /api/notice, /api/option)
 * These are required by New-API / One-API frontend panels to fetch initial configuration.
 */
export const sysRouter = new Elysia({ prefix: '/api' })
    .get('/status', () => {
        // Mock status compatible with New-API
        return {
            success: true,
            message: "",
            data: {
                version: "v0.5.0-elygate",
                start_time: Math.floor(Date.now() / 1000 - 3600), // mock uptime
                quota_per_unit: 500000,
                display_in_currency: false,
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
            }
        };
    });
