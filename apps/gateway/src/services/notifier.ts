import { log } from '../services/logger';
import { optionCache } from './optionCache';
import { webhookService } from './webhook';

/**
 * Unified Notification Service
 * Supports Email (SMTP), Telegram Bot, and Webhook notifications.
 * Configuration is fetched dynamically from the options table.
 * 
 * Merged from legacy notification.ts + notifier.ts into a single module.
 */
export const notifier = {
    /**
     * Send a notification via all enabled channels.
     * Also exported as `notificationService.send()` for backward compatibility.
     */
    async notify(subject: string, message: string, payload?: Record<string, unknown>) {
        log.info(`[Notifier] ${subject}: ${message}`);

        const enabled = optionCache.get('NotificationEnabled', true);
        if (!enabled) return;

        const methods = optionCache.get<string[]>('NotificationMethods', ['email']);

        // 1. Email via SMTP
        if (methods.includes('email')) {
            await this.sendEmail(subject, message);
        }

        // 2. Telegram Bot
        if (methods.includes('telegram')) {
            await this.sendTelegram(subject, message);
        }

        // 3. Webhook / Robot
        const webhookEnabled = optionCache.get<string>('WEBHOOK_ENABLED', 'false') === 'true';
        if (webhookEnabled) {
            await webhookService.trigger('system.alert', { subject, message, ...payload });
        }
    },

    async sendEmail(subject: string, message: string) {
        const config = optionCache.get('SMTPConfig', {} as Record<string, any>);
        if (!config.host) {
            log.warn('[Notifier] SMTP not configured.');
            return;
        }

        // Implementation with nodemailer would go here
        log.info(`[Notifier/Email] To: ${config.adminEmail || config.to}, Subject: ${subject}`);
    },

    async sendTelegram(subject: string, message: string) {
        const config = optionCache.get('TelegramConfig', {} as Record<string, any>);
        if (!config.token || !config.chatId) {
            return; // Silently skip if not configured
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
 * Backward-compatible alias for code that imports `notificationService`.
 * Maps `.send()` to the unified `.notify()` method.
 */
export const notificationService = {
    send: (subject: string, message: string) => notifier.notify(subject, message),
};
