import { log } from '../services/logger';
import { sql } from '@elygate/db';
import { memoryCache } from './cache';
import { notificationService } from './notification';
import { optionCache } from './optionCache';
import { webhookService } from './webhook';

class CircuitBreaker {
    // channelId -> consecutive error count
    private errorCounts = new Map<number, number>();
    // channelId -> consecutive success count for half-open recovery
    private successCounts = new Map<number, number>();
    // channelId -> rolling average latency (ms)
    private latencyMetrics = new Map<number, number>();
    private healthCheckTimer: NodeJS.Timeout | null = null;

    constructor() {
        this.startHealthCheck();
    }

    private getThreshold(): number {
        return parseInt(optionCache.get('CIRCUIT_BREAKER_THRESHOLD', '3'));
    }

    private getRecoveryThreshold(): number {
        return parseInt(optionCache.get('CIRCUIT_BREAKER_RECOVERY_THRESHOLD', '5'));
    }

    /**
     * Record success and latency.
     */
    public async recordSuccess(channelId: number, latencyMs?: number) {
        if (this.errorCounts.has(channelId)) {
            this.errorCounts.delete(channelId);
        }

        if (latencyMs !== undefined) {
            const currentAvg = this.latencyMetrics.get(channelId) || latencyMs;
            const newAvg = (currentAvg * 0.7) + (latencyMs * 0.3); // Simple EMA
            this.latencyMetrics.set(channelId, newAvg);

            const latencyThreshold = parseInt(optionCache.get('LATENCY_THRESHOLD_MS', '30000'));
            if (newAvg > latencyThreshold) {
                log.warn(`[CircuitBreaker] Channel ${channelId} high latency (${Math.round(newAvg)}ms). Marking as Busy.`);
                await sql`UPDATE channels SET status = 5, status_message = 'High Latency', updated_at = NOW() WHERE id = ${channelId}`;
                await memoryCache.refresh();
            }
        }

        const channel = memoryCache.channels.get(channelId);
        if (channel && (channel.status === 4 || channel.status === 5)) {
            const count = (this.successCounts.get(channelId) || 0) + 1;
            const threshold = channel.status === 5 ? 1 : this.getRecoveryThreshold();

            if (count >= threshold) {
                log.info(`[CircuitBreaker] Channel ${channelId} recovered to Online.`);
                await sql`UPDATE channels SET status = 1, status_message = NULL, updated_at = NOW() WHERE id = ${channelId}`;
                await memoryCache.refresh();
                this.successCounts.delete(channelId);
            } else {
                this.successCounts.set(channelId, count);
            }
        }
    }

    /**
     * Record an error for a channel.
     */
    public async recordError(channelId: number, status?: number, message?: string) {
        const channel = memoryCache.channels.get(channelId);
        if (!channel) return;

        // 1. Immediate Disable for Auth Errors (401/403)
        if (status === 401 || status === 403) {
            log.error(`[CircuitBreaker] Channel ${channelId} Auth Error (${status}). Disabling.`);
            await this.disableChannel(channelId, `Auth Error: ${status} ${message || ""}`);
            return;
        }

        // 2. Mark as Busy for Rate Limits (429)
        if (status === 429) {
            log.warn(`[CircuitBreaker] Channel ${channelId} Rate Limited (429). Marking as Busy.`);
            await sql`UPDATE channels SET status = 5, status_message = 'Rate Limited (429)', updated_at = NOW() WHERE id = ${channelId}`;
            await memoryCache.refresh();
            return;
        }

        // 3. Regular error count logic for 5xx/Timeout
        if (status && status >= 400 && status < 500) return;

        // If in Half-Open, one failure trips it back to Disabled
        if (channel.status === 4 || channel.status === 5) {
            await this.disableChannel(channelId, `Failed during recovery/busy period: ${status}`);
            return;
        }

        const count = (this.errorCounts.get(channelId) || 0) + 1;
        const threshold = this.getThreshold();
        this.errorCounts.set(channelId, count);

        if (count >= threshold) {
            await this.disableChannel(channelId, `Consecutive failures: ${count}`);
        }
    }

    private async disableChannel(channelId: number, reason?: string) {
        try {
            await sql`
                UPDATE channels
                SET status = 3, status_message = ${reason || null}, updated_at = NOW()
                WHERE id = ${channelId} AND status != 2
            `;
            await memoryCache.refresh();
            this.errorCounts.delete(channelId);
            this.successCounts.delete(channelId);

            const shouldNotify = String(optionCache.get('Notify_On_Channel_Offline', 'true')) === 'true';

            if (shouldNotify) {
                await notificationService.send(
                    'Channel Disabled',
                    `Channel ID ${channelId} disabled: ${reason || 'Frequent failures'}`
                );
                await webhookService.trigger('channel.disabled', { channelId, reason });
            }
        } catch (e: unknown) {
            log.error(`[CircuitBreaker] Failed to disable channel ${channelId}:`, e);
        }
    }

    private startHealthCheck() {
        if (this.healthCheckTimer) clearInterval(this.healthCheckTimer);
        const interval = parseInt(optionCache.get('HEALTH_CHECK_INTERVAL', '60000'));
        this.healthCheckTimer = setInterval(() => this.runHealthCheck(), interval);
    }

    private async runHealthCheck() {
        try {
            // Auto-recover Status 5 (Busy) after cooldown
            const busyChannels = await sql`
                SELECT id FROM channels WHERE status = 5 AND updated_at < NOW() - INTERVAL '1 minute'
            `;
            for (const ch of busyChannels) {
                await sql`UPDATE channels SET status = 1, status_message = NULL, updated_at = NOW() WHERE id = ${ch.id}`;
            }

            // Auto-recover Status 4 (Testing Recovery) after 5 minutes timeout
            // If the channel is still reachable, it should be back online
            const testingChannels = await sql`
                SELECT id, base_url AS "baseUrl", key, type FROM channels 
                WHERE status = 4 AND updated_at < NOW() - INTERVAL '5 minutes'
            `;
            let changed = busyChannels.length > 0;
            for (const ch of testingChannels) {
                const isHealthy = await this.pingChannel(ch);
                if (isHealthy) {
                    log.info(`[CircuitBreaker] Channel ${ch.id} auto-recovered from Testing Recovery (timeout).`);
                    await sql`UPDATE channels SET status = 1, status_message = NULL, updated_at = NOW() WHERE id = ${ch.id}`;
                    changed = true;
                } else {
                    // If still failing, put back to disabled
                    await sql`UPDATE channels SET status = 3, status_message = 'Failed during testing recovery', updated_at = NOW() WHERE id = ${ch.id}`;
                    changed = true;
                }
            }

            const disabledChannels = await sql`
                SELECT id, base_url AS "baseUrl", key, type FROM channels WHERE status = 3 AND (status_message IS NULL OR status_message NOT LIKE 'Auth Error%')
            `;
            
            for (const ch of disabledChannels) {
                const isHealthy = await this.pingChannel(ch);
                if (isHealthy) {
                    await sql`UPDATE channels SET status = 4, status_message = 'Testing Recovery', updated_at = NOW() WHERE id = ${ch.id}`;
                    changed = true;
                }
            }
            if (changed) await memoryCache.refresh();
        } catch (e: unknown) {
            log.error('[HealthCheck] Error checking channels:', e);
        }
    }

    private async pingChannel(channel: Record<string, any>): Promise<boolean> {
        const keys = channel.key.split('\n').map((k: string) => k.trim()).filter(Boolean);
        if (keys.length === 0) return false;

        const useTestPrompt = String(optionCache.get('HEALTH_CHECK_USE_PROMPT', 'false')) === 'true';
        const testPrompt = optionCache.get('HEALTH_CHECK_PROMPT', 'Hi');
        const timeoutMs = parseInt(optionCache.get('HEALTH_CHECK_TIMEOUT', '10000'));

        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), timeoutMs);
            
            let url = `${channel.baseUrl}/v1/models`;
            let body = null;
            let method = 'GET';

            if (useTestPrompt && channel.models && channel.models.length > 0) {
                const models = Array.isArray(channel.models) ? channel.models : JSON.parse(channel.models);
                const testModel = models[0];
                url = `${channel.baseUrl}/v1/chat/completions`;
                method = 'POST';
                body = JSON.stringify({
                    model: testModel,
                    messages: [{ role: 'user', content: testPrompt }],
                    max_tokens: 1
                });
            }

            const res = await fetch(url, {
                method,
                headers: { 
                    'Authorization': `Bearer ${keys[0]}`,
                    'Content-Type': 'application/json'
                },
                body,
                signal: controller.signal
            });
            clearTimeout(timeout);
            return res.status < 429;
        } catch (e: unknown) {
            return false;
        }
    }
}

export const circuitBreaker = new CircuitBreaker();
