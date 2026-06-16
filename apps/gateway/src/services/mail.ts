import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { log } from './logger';
import { optionCache } from './optionCache';

/**
 * SMTP 邮件服务
 * 配置来源于 options 表的 SMTPConfig 键，支持动态刷新。
 * 对标 new-api 的邮件验证、密码重置、告警通知能力。
 */

export interface SmtpConfig {
    host: string;
    port: number;
    username?: string;
    password?: string;
    from: string;
    fromName?: string;
    secure?: boolean;
}

let cachedTransport: Transporter | null = null;
let cachedKey = '';

function buildConfigKey(cfg: SmtpConfig): string {
    return `${cfg.host}:${cfg.port}:${cfg.username || ''}:${cfg.secure ? 1 : 0}`;
}

function getSmtpConfig(): SmtpConfig | null {
    const raw = optionCache.get<Record<string, any>>('SMTPConfig', {});
    if (!raw || !raw.host) return null;
    return {
        host: String(raw.host),
        port: Number(raw.port || 587),
        username: raw.username || raw.user || '',
        password: raw.password || raw.pass || '',
        from: String(raw.from || raw.email || raw.adminEmail || ''),
        fromName: String(raw.fromName || raw.name || 'Elygate'),
        secure: raw.secure !== undefined ? !!raw.secure : (Number(raw.port) === 465),
    };
}

function getTransport(): Transporter | null {
    const cfg = getSmtpConfig();
    if (!cfg) return null;
    const key = buildConfigKey(cfg);
    if (cachedTransport && key === cachedKey) return cachedTransport;
    if (cachedTransport) {
        try { cachedTransport.close(); } catch {}
    }
    cachedTransport = nodemailer.createTransport({
        host: cfg.host,
        port: cfg.port,
        secure: cfg.secure,
        auth: cfg.username ? { user: cfg.username, pass: cfg.password || '' } : undefined,
    });
    cachedKey = key;
    return cachedTransport;
}

export function isSmtpConfigured(): boolean {
    return !!getSmtpConfig();
}

export interface SendMailOptions {
    to: string;
    subject: string;
    html?: string;
    text?: string;
}

export async function sendMail(opts: SendMailOptions): Promise<boolean> {
    const cfg = getSmtpConfig();
    if (!cfg) {
        log.warn('[Mail] SMTP not configured, skipping send');
        return false;
    }
    const transport = getTransport();
    if (!transport) return false;

    const fromAddress = cfg.fromName ? `${cfg.fromName} <${cfg.from}>` : cfg.from;
    try {
        await transport.sendMail({
            from: fromAddress,
            to: opts.to,
            subject: opts.subject,
            html: opts.html,
            text: opts.text,
        });
        log.info(`[Mail] Sent to ${opts.to}, subject: ${opts.subject}`);
        return true;
    } catch (e: unknown) {
        log.error(`[Mail] Failed to send to ${opts.to}:`, e);
        return false;
    }
}

/**
 * 验证码生成
 */
export function generateCode(length = 6): string {
    const digits = '0123456789';
    let code = '';
    const buf = new Uint8Array(length);
    crypto.getRandomValues(buf);
    for (let i = 0; i < length; i++) code += digits[buf[i] % 10];
    return code;
}

/**
 * 通用邮件模板
 */
export function renderVerificationEmail(opts: { code: string; purpose: string; systemName?: string; expireMinutes?: number }): { subject: string; html: string; text: string } {
    const systemName = opts.systemName || optionCache.get('SystemName', 'Elygate');
    const minutes = opts.expireMinutes || 10;
    const subject = `${systemName} - ${opts.purpose}验证码`;
    const html = `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
<h2 style="color:#333">${systemName}</h2>
<p>您正在进行<strong>${opts.purpose}</strong>操作，验证码为：</p>
<div style="font-size:32px;font-weight:bold;letter-spacing:8px;color:#4f46e5;padding:16px 0">${opts.code}</div>
<p>验证码 ${minutes} 分钟内有效，请勿泄露给他人。</p>
<p>如非本人操作，请忽略此邮件。</p>
</div>`;
    const text = `${systemName}\n\n${opts.purpose}验证码：${opts.code}\n\n验证码 ${minutes} 分钟内有效。`;
    return { subject, html, text };
}

/**
 * 重置 transport（用于配置变更后强制刷新）
 */
export function resetMailTransport(): void {
    if (cachedTransport) {
        try { cachedTransport.close(); } catch {}
        cachedTransport = null;
        cachedKey = '';
    }
}
