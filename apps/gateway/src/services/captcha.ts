import { log } from './logger';
import { optionCache } from './optionCache';

/**
 * 人机验证服务
 * 对标 new-api 的 Captcha 门控，支持 Cloudflare Turnstile、reCAPTCHA、hCaptcha。
 * 配置来源：options 表。
 */

export type CaptchaProvider = 'turnstile' | 'recaptcha' | 'hcaptcha' | 'none';

interface CaptchaConfig {
    provider: CaptchaProvider;
    siteKey: string;
    secretKey: string;
}

export function getCaptchaConfig(): CaptchaConfig {
    const provider = String(optionCache.get('CaptchaProvider', 'none')).toLowerCase();
    if (provider === 'none' || !provider) {
        return { provider: 'none', siteKey: '', secretKey: '' };
    }
    const keyPrefix = provider === 'turnstile' ? 'Turnstile' : provider === 'recaptcha' ? 'reCAPTCHA' : 'hCaptcha';
    return {
        provider: provider as CaptchaProvider,
        siteKey: String(optionCache.get(`${keyPrefix}SiteKey`, '')),
        secretKey: String(optionCache.get(`${keyPrefix}SecretKey`, '')),
    };
}

export function isCaptchaEnabled(): boolean {
    const cfg = getCaptchaConfig();
    return cfg.provider !== 'none' && !!cfg.secretKey;
}

/**
 * 校验前端提交的 captcha token。
 * 如果未启用 captcha，直接返回 true。
 */
export async function verifyCaptcha(token: string | undefined, remoteIp?: string): Promise<boolean> {
    const cfg = getCaptchaConfig();
    if (cfg.provider === 'none' || !cfg.secretKey) return true;
    if (!token) return false;

    let verifyUrl: string;
    let body: Record<string, string>;
    switch (cfg.provider) {
        case 'turnstile':
            verifyUrl = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
            body = { secret: cfg.secretKey, response: token };
            if (remoteIp) body.remoteip = remoteIp;
            break;
        case 'recaptcha':
            verifyUrl = 'https://www.google.com/recaptcha/api/siteverify';
            body = { secret: cfg.secretKey, response: token };
            if (remoteIp) body.remoteip = remoteIp;
            break;
        case 'hcaptcha':
            verifyUrl = 'https://api.hcaptcha.com/siteverify';
            body = { secret: cfg.secretKey, response: token };
            if (remoteIp) body.remoteip = remoteIp;
            break;
        default:
            return true;
    }

    try {
        const res = await fetch(verifyUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams(body).toString(),
        });
        const data = await res.json() as Record<string, any>;
        return data.success === true;
    } catch (e: unknown) {
        log.error('[Captcha] Verification failed:', e);
        return false;
    }
}
