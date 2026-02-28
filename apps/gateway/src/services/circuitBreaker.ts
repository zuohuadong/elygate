import { sql } from '@elygate/db';
import { memoryCache } from './cache';
import { notificationService } from './notification';

const ERROR_THRESHOLD = 3; // Disable after 3 consecutive errors
const HEALTH_CHECK_INTERVAL = 60 * 1000; // Check every 1 minute

class CircuitBreaker {
    // channelId -> consecutive error count
    private errorCounts = new Map<number, number>();
    private healthCheckTimer: NodeJS.Timeout | null = null;

    constructor() {
        this.startHealthCheck();
    }

    /**
     * Record a success for a channel, resetting its error count.
     */
    public recordSuccess(channelId: number) {
        if (this.errorCounts.has(channelId)) {
            this.errorCounts.delete(channelId);
            console.log(`[CircuitBreaker] Channel ${channelId} recovered, error count reset.`);
        }
    }

    /**
     * Record an error for a channel. If threshold reached, auto-disable.
     */
    public async recordError(channelId: number, status?: number) {
        // We only trip on 429 or 5xx or network errors (no status)
        if (status && status >= 400 && status < 429) {
            // Client errors like 400, 401, 404 do not trigger circuit breaker
            return;
        }

        const count = (this.errorCounts.get(channelId) || 0) + 1;
        this.errorCounts.set(channelId, count);
        console.warn(`[CircuitBreaker] Channel ${channelId} error count: ${count}/${ERROR_THRESHOLD}`);

        if (count >= ERROR_THRESHOLD) {
            await this.disableChannel(channelId);
        }
    }

    private async disableChannel(channelId: number) {
        console.error(`[CircuitBreaker] Channel ${channelId} exceeded error threshold. Auto-disabling.`);
        try {
            await sql`
                UPDATE channels
                SET status = 3, updated_at = NOW()
                WHERE id = ${channelId} AND status = 1
            `;
            // Remove from cache immediately
            await memoryCache.refresh();
            this.errorCounts.delete(channelId);

            // Notify admin
            await notificationService.send(
                'Channel Auto-Disabled',
                `Channel ID ${channelId} has been auto-disabled after ${ERROR_THRESHOLD} consecutive errors.`
            );
        } catch (e) {
            console.error(`[CircuitBreaker] Failed to disable channel ${channelId}:`, e);
        }
    }

    /**
     * Background daemon to ping disabled channels (status = 3) occasionally.
     */
    private startHealthCheck() {
        if (this.healthCheckTimer) {
            clearInterval(this.healthCheckTimer);
        }
        this.healthCheckTimer = setInterval(() => this.runHealthCheck(), HEALTH_CHECK_INTERVAL);
    }

    private async runHealthCheck() {
        try {
            // Find all auto-disabled channels
            const disabledChannels = await sql`
                SELECT id, base_url AS "baseUrl", key, type
                FROM channels
                WHERE status = 3
            `;

            if (disabledChannels.length === 0) return;

            console.log(`[HealthCheck] Pinging ${disabledChannels.length} auto-disabled channels...`);

            let recoveredCount = 0;
            for (const ch of disabledChannels) {
                const isHealthy = await this.pingChannel(ch);

                await sql`
                    UPDATE channels
                    SET test_at = NOW()
                    WHERE id = ${ch.id}
                `;

                if (isHealthy) {
                    console.log(`[HealthCheck] Channel ${ch.id} is healthy again. Re-enabling.`);
                    await sql`
                        UPDATE channels
                        SET status = 1, updated_at = NOW()
                        WHERE id = ${ch.id}
                    `;
                    recoveredCount++;
                }
            }

            if (recoveredCount > 0) {
                await memoryCache.refresh();
            }
        } catch (e) {
            console.error('[HealthCheck] Error checking channels:', e);
        }
    }

    private async pingChannel(channel: any): Promise<boolean> {
        // Pick active key
        const keys = channel.key.split('\n').map((k: string) => k.trim()).filter(Boolean);
        if (keys.length === 0) return false;
        const activeKey = keys[0];

        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 5000);

            const req = await fetch(`${channel.baseUrl}/v1/chat/completions`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${activeKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: 'ping-model-test-ignore',
                    messages: [{ role: 'user', content: 'hi' }],
                    max_tokens: 1
                }),
                signal: controller.signal
            });
            clearTimeout(timeout);

            // 400/401/404 indicates the service is up.
            if (req.status < 429) {
                return true;
            }
            return false;
        } catch (e) {
            return false;
        }
    }
}

export const circuitBreaker = new CircuitBreaker();
