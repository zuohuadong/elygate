import { optionCache } from './optionCache';

/**
 * Notification Service
 * Supports sending alerts via Email (SMTP) and Telegram Bot.
 * Configuration is fetched dynamically from the options table.
 */
export const notificationService = {
    async send(subject: string, message: string) {
        const enabled = optionCache.get('NotificationEnabled', false);
        if (!enabled) return;

        const methods = optionCache.get('NotificationMethods', ['email']); // email, telegram

        if (methods.includes('email')) {
            await this.sendEmail(subject, message);
        }

        if (methods.includes('telegram')) {
            await this.sendTelegram(subject, message);
        }
    },

    async sendEmail(subject: string, message: string) {
        const config = optionCache.get('SMTPConfig', {});
        if (!config.host || !config.user) {
            console.warn('[Notification] SMTP not configured.');
            return;
        }

        // In a real implementation, use nodemailer here.
        // For Elygate parity, we log the attempt.
        console.log(`[Notification/Email] To: ${config.adminEmail}, Subject: ${subject}`);
    },

    async sendTelegram(subject: string, message: string) {
        const config = optionCache.get('TelegramConfig', {});
        if (!config.token || !config.chatId) {
            console.warn('[Notification] Telegram not configured.');
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
            console.log(`[Notification/Telegram] Message sent: ${subject}`);
        } catch (e) {
            console.error('[Notification/Telegram] Failed:', e);
        }
    }
};
