import { log } from '../services/logger';
import { optionCache } from './optionCache';
import { webhookService } from './webhook';

/**
 * Notifier Service
 * Unifies Email (SMTP) and Webhook/Bot notifications.
 */
export const notifier = {
    async notify(subject: string, message: string, payload?: Record<string, unknown>) {
        log.info(`[Notifier] ${subject}: ${message}`);
        
        // 1. Email via SMTP (Simulation or implementation)
        const smtpEnabled = optionCache.get('SMTP_ENABLED', 'false') === 'true';
        if (smtpEnabled) {
            await this.sendEmail(subject, message);
        }

        // 2. Webhook / Robot
        const webhookEnabled = optionCache.get('WEBHOOK_ENABLED', 'false') === 'true';
        if (webhookEnabled) {
            await webhookService.trigger('system.alert', { subject, message, ...payload });
        }
    },

    async sendEmail(subject: string, message: string) {
        const config = optionCache.get('SMTP_CONFIG', {});
        if (!config.host) return;

        // Implementation with nodemailer would go here
        log.info(`[SMTP] Sending "${subject}" to ${config.to}`);
    }
};
