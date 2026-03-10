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
     * Record a success for a channel.
     */
    public async recordSuccess(channelId: number) {
        if (this.errorCounts.has(channelId)) {
            this.errorCounts.delete(channelId);
            console.log(`[CircuitBreaker] Channel ${channelId} error count reset.`);
        }

        // Handle Half-Open recovery
        const channel = memoryCache.channels.get(channelId);
        if (channel && channel.status === 4) {
            const count = (this.successCounts.get(channelId) || 0) + 1;
            const threshold = this.getRecoveryThreshold();

            if (count >= threshold) {
                console.log(`[CircuitBreaker] Channel ${channelId} fully recovered from Half-Open.`);
                await sql`UPDATE channels SET status = 1, updated_at = NOW() WHERE id = ${channelId}`;
                await memoryCache.refresh();
                this.successCounts.delete(channelId);
            } else {
                this.successCounts.set(channelId, count);
                console.log(`[CircuitBreaker] Channel ${channelId} Half-Open success: ${count}/${threshold}`);
            }
        }
    }

    /**
     * Record an error for a channel.
     */
    public async recordError(channelId: number, status?: number) {
        if (status && status >= 400 && status < 429) return;

        const channel = memoryCache.channels.get(channelId);
        if (!channel) return;

        // If in Half-Open, one failure trips it back to Disabled
        if (channel.status === 4) {
            console.warn(`[CircuitBreaker] Channel ${channelId} failed in Half-Open. Re-disabling.`);
            await this.disableChannel(channelId);
            return;
        }

        const count = (this.errorCounts.get(channelId) || 0) + 1;
        const threshold = this.getThreshold();
        this.errorCounts.set(channelId, count);

        console.warn(`[CircuitBreaker] Channel ${channelId} error count: ${count}/${threshold}`);

        if (count >= threshold) {
            await this.disableChannel(channelId);
        }
    }

    private async disableChannel(channelId: number) {
        console.error(`[CircuitBreaker] Channel ${channelId} disabled by circuit breaker.`);
        try {
            await sql`
                UPDATE channels
                SET status = 3, updated_at = NOW()
                WHERE id = ${channelId} AND status IN (1, 4)
            `;
            await memoryCache.refresh();
            this.errorCounts.delete(channelId);
            this.successCounts.delete(channelId);

            await notificationService.send(
                'Channel Prohibited',
                `Channel ID ${channelId} has been disabled due to frequent failures.`
            );
            await webhookService.trigger('channel.disabled', { channelId });
        } catch (e) {
            console.error(`[CircuitBreaker] Failed to disable channel ${channelId}:`, e);
        }
    }

    private startHealthCheck() {
        if (this.healthCheckTimer) clearInterval(this.healthCheckTimer);
        const interval = parseInt(optionCache.get('HEALTH_CHECK_INTERVAL', '60000'));
        this.healthCheckTimer = setInterval(() => this.runHealthCheck(), interval);
    }

    private async runHealthCheck() {
        try {
            const disabledChannels = await sql`
                SELECT id, base_url AS "baseUrl", key, type FROM channels WHERE status = 3
            `;
            if (disabledChannels.length === 0) return;

            for (const ch of disabledChannels) {
                const isHealthy = await this.pingChannel(ch);
                if (isHealthy) {
                    console.log(`[HealthCheck] Channel ${ch.id} recovered to Half-Open.`);
                    await sql`UPDATE channels SET status = 4, updated_at = NOW() WHERE id = ${ch.id}`;
                }
            }
            if (disabledChannels.length > 0) await memoryCache.refresh();
        } catch (e) {
            console.error('[HealthCheck] Error checking channels:', e);
        }
    }

    private async pingChannel(channel: any): Promise<boolean> {
        const keys = channel.key.split('\n').map((k: string) => k.trim()).filter(Boolean);
        if (keys.length === 0) return false;

        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 5000);
            const res = await fetch(`${channel.baseUrl}/v1/models`, {
                headers: { 'Authorization': `Bearer ${keys[0]}` },
                signal: controller.signal
            });
            clearTimeout(timeout);
            return res.status < 429;
        } catch (e) {
            return false;
        }
    }
}

export const circuitBreaker = new CircuitBreaker();
