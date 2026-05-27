import { log } from '../services/logger';
import { getErrorMessage } from '../utils/error';
import { enqueueWebhookDelivery, type WebhookDeliveryJobPayload } from './jobQueue';
import { optionCache } from './optionCache';

/**
 * Webhook Service
 * Sends event notifications to configured webhook URLs.
 * Configuration is fetched dynamically from the options table.
 */
export async function deliverWebhookJob(job: WebhookDeliveryJobPayload): Promise<void> {
    const webhookUrl = job.url || optionCache.get('WebhookURL', '');
    if (!webhookUrl) return;

    const body = job.body || { event: job.event, payload: job.payload || {}, timestamp: Date.now() };
    const bodyText = JSON.stringify(body);
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(job.headers || {}),
    };

    const webhookSecret = job.secret !== undefined
        ? job.secret
        : (job.url ? '' : optionCache.get('WebhookSecret', ''));
    if (webhookSecret) {
        const signature = new Bun.CryptoHasher('sha256', webhookSecret)
            .update(bodyText)
            .digest('hex');
        headers['X-Webhook-Signature'] = signature;
    }

    const response = await fetch(webhookUrl, {
        method: 'POST',
        headers,
        body: bodyText,
    });

    if (!response.ok) {
        throw new Error(`Webhook returned HTTP ${response.status}`);
    }

    log.info(`[Webhook] ${job.logLabel || `event '${job.event}'`} sent to ${webhookUrl}`);
}

export const webhookService = {
    async trigger(event: string, payload: Record<string, any>) {
        const webhookUrl = optionCache.get('WebhookURL', '');
        const webhookSecret = optionCache.get('WebhookSecret', '');

        if (!webhookUrl) return;

        try {
            await enqueueWebhookDelivery({
                event,
                payload,
                url: webhookUrl,
                secret: webhookSecret,
            });
        } catch (e: unknown) {
            log.error(`[Webhook] Failed to enqueue '${event}', sending directly:`, getErrorMessage(e));
            try {
                await deliverWebhookJob({ event, payload, url: webhookUrl, secret: webhookSecret });
            } catch (sendErr: unknown) {
                log.error(`[Webhook] Failed to send '${event}':`, getErrorMessage(sendErr));
            }
        }
    }
};
