import { log } from '../services/logger';
import { optionCache } from './optionCache';

/**
 * Webhook Service
 * Sends event notifications to configured webhook URLs.
 * Configuration is fetched dynamically from the options table.
 */
export const webhookService = {
    async trigger(event: string, payload: Record<string, any>) {
        const webhookUrl = optionCache.get('WebhookURL', '');
        const webhookSecret = optionCache.get('WebhookSecret', '');

        if (!webhookUrl) return;

        const body = { event, payload, timestamp: Date.now() };

        try {
            const headers: Record<string, string> = { 'Content-Type': 'application/json' };
            if (webhookSecret) {
                const signature = new Bun.CryptoHasher('sha256', webhookSecret)
                    .update(JSON.stringify(body))
                    .digest('hex');
                headers['X-Webhook-Signature'] = signature;
            }

            await fetch(webhookUrl, {
                method: 'POST',
                headers,
                body: JSON.stringify(body)
            });
            log.info(`[Webhook] Event '${event}' sent to ${webhookUrl}`);
        } catch (e) {
            log.error(`[Webhook] Failed to send '${event}':`, e);
        }
    }
};
