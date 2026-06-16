import { log } from '../services/logger';
import { optionCache } from './optionCache';
import { webhookService } from './webhook';
import { sendMail } from './mail';

/**
 * 统一通知服务
 * 支持邮件（SMTP）、Telegram 机器人、Webhook 三种渠道。
 * 配置从 options 表动态读取。
 */
export const notifier = {
    /**
     * 通过所有已启用的渠道发送通知。
     */
    async notify(subject: string, message: string, payload?: Record<string, unknown>) {
        log.info(`[Notifier] ${subject}: ${message}`);

        const enabled = optionCache.get('NotificationEnabled', true);
        if (!enabled) return;

        const methods = optionCache.get<string[]>('NotificationMethods', ['email']);

        // 1. 邮件（SMTP）
        if (methods.includes('email')) {
            await this.sendEmail(subject, message);
        }

        // 2. Telegram 机器人
        if (methods.includes('telegram')) {
            await this.sendTelegram(subject, message);
        }

        // 3. Webhook
        const webhookEnabled = optionCache.get<string>('WEBHOOK_ENABLED', 'false') === 'true';
        if (webhookEnabled) {
            await webhookService.trigger('system.alert', { subject, message, ...payload });
        }
    },

    async sendEmail(subject: string, message: string) {
        const cfg = optionCache.get<Record<string, any>>('SMTPConfig', {});
        const to = cfg.adminEmail || cfg.to;
        if (!cfg.host || !to) {
            log.warn('[Notifier] SMTP not configured or missing recipient.');
            return;
        }
        await sendMail({ to, subject, text: message, html: `<pre>${message}</pre>` });
    },

    async sendTelegram(subject: string, message: string) {
        const config = optionCache.get<Record<string, any>>('TelegramConfig', {});
        if (!config.token || !config.chatId) {
            return;
        }

        try {
            const url = `https://api.telegram.org/bot${config.token}/sendMessage`;
            await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: config.chatId,
                    text: `*${subject}*\n\n${message}`,
                    parse_mode: 'Markdown'
                })
            });
            log.info(`[Notifier/Telegram] Message sent: ${subject}`);
        } catch (e: unknown) {
            log.error('[Notifier/Telegram] Failed:', e);
        }
    }
};

/**
 * 向后兼容别名
 */
export const notificationService = {
    send: (subject: string, message: string) => notifier.notify(subject, message),
};
