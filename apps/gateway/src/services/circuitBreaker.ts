import { log } from '../services/logger';
import { sql } from '@elygate/db';
import { memoryCache } from './cache';
import { notificationService } from './notification';
import { optionCache } from './optionCache';
import { webhookService } from './webhook';

interface RequestEvent {
    timestamp: number;
    success: boolean;
    status?: number;
    latencyMs?: number;
}

/**
 * Sliding Time-Window Circuit Breaker.
 *
 * Instead of requiring N consecutive failures (which resets on any success),
 * this tracks ALL requests within a configurable time window and trips
 * when the failure rate exceeds a threshold.
 *
 * Configurable via system options:
 *   - CIRCUIT_BREAKER_WINDOW_MS: Time window size (default: 300000 = 5 minutes)
 *   - CIRCUIT_BREAKER_FAILURE_RATE: Failure rate to trip (default: 0.5 = 50%)
 *   - CIRCUIT_BREAKER_MIN_REQUESTS: Minimum requests in window before evaluation (default: 3)
 *   - CIRCUIT_BREAKER_RECOVERY_THRESHOLD: Consecutive successes needed in half-open (default: 3)
 *   - LATENCY_THRESHOLD_MS: Average latency to trigger busy status (default: 30000)
 */
class CircuitBreaker {
    // channelId -> rolling window of request events
    private events = new Map<number, RequestEvent[]>();
    // channelId -> consecutive success count for half-open recovery
    private successCounts = new Map<number, number>();
    // channelId -> rolling average latency (ms)
    private latencyMetrics = new Map<number, number>();
    private healthCheckTimer: NodeJS.Timeout | null = null;

    constructor() {
        this.startHealthCheck();
    }

    private getWindowMs(): number {
        return parseInt(optionCache.get('CIRCUIT_BREAKER_WINDOW_MS', '300000')); // 5 minutes
    }

    private getFailureRate(): number {
        return parseFloat(optionCache.get('CIRCUIT_BREAKER_FAILURE_RATE', '0.5')); // 50%
    }

    private getMinRequests(): number {
        return parseInt(optionCache.get('CIRCUIT_BREAKER_MIN_REQUESTS', '3'));
    }

    private getRecoveryThreshold(): number {
        return parseInt(optionCache.get('CIRCUIT_BREAKER_RECOVERY_THRESHOLD', '3'));
    }

    /**
     * Prune events older than the time window.
     */
    private pruneEvents(channelId: number) {
        const events = this.events.get(channelId);
        if (!events) return;
        const cutoff = Date.now() - this.getWindowMs();
        const pruned = events.filter(e => e.timestamp > cutoff);
        if (pruned.length === 0) {
            this.events.delete(channelId);
        } else {
            this.events.set(channelId, pruned);
        }
    }

    /**
     * Get current failure rate for a channel within the time window.
     */
    private getChannelFailureRate(channelId: number): { total: number; failures: number; rate: number } {
        this.pruneEvents(channelId);
        const events = this.events.get(channelId) || [];
        const total = events.length;
        const failures = events.filter(e => !e.success).length;
        return { total, failures, rate: total > 0 ? failures / total : 0 };
    }

    /**
     * Check if the circuit breaker should trip based on the time window.
     */
    private async checkAndTrip(channelId: number) {
        const { total, failures, rate } = this.getChannelFailureRate(channelId);
        const minRequests = this.getMinRequests();
        const failureRate = this.getFailureRate();

        if (total >= minRequests && rate >= failureRate) {
            log.warn(`[CircuitBreaker] Channel ${channelId} tripped: ${failures}/${total} failures (${(rate * 100).toFixed(0)}%) in ${this.getWindowMs() / 1000}s window.`);
            await this.disableChannel(channelId, `Failure rate ${(rate * 100).toFixed(0)}% (${failures}/${total}) in ${this.getWindowMs() / 1000}s`);
        }
    }

    /**
     * Record success and latency.
     */
    public async recordSuccess(channelId: number, latencyMs?: number) {
        // Add success event to window
        const events = this.events.get(channelId) || [];
        events.push({ timestamp: Date.now(), success: true, latencyMs });
        this.events.set(channelId, events);

        // Track latency
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

        // Half-Open recovery: track consecutive successes
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

        // 1. Immediate Disable for Auth Errors (401 only — invalid key)
        if (status === 401) {
            log.error(`[CircuitBreaker] Channel ${channelId} Auth Error (401). Disabling.`);
            await this.disableChannel(channelId, `Auth Error: 401 ${message || ""}`);
            return;
        }

        // 2. 403 may be upstream balance/quota issue — mark as Busy (auto-recoverable)
        if (status === 403) {
            log.warn(`[CircuitBreaker] Channel ${channelId} received 403 (may be upstream balance). Marking as Busy.`);
            await sql`UPDATE channels SET status = 5, status_message = ${'Upstream 403: ' + (message || '').substring(0, 100)}, updated_at = NOW() WHERE id = ${channelId}`;
            await memoryCache.refresh();
            return;
        }

        // 2. Mark as Busy for Rate Limits (429)
        if (status === 429) {
            log.warn(`[CircuitBreaker] Channel ${channelId} Rate Limited (429). Marking as Busy.`);
            await sql`UPDATE channels SET status = 5, status_message = 'Rate Limited (429)', updated_at = NOW() WHERE id = ${channelId}`;
            await memoryCache.refresh();
            return;
        }

        // 3. Skip client errors (4xx) — they're user mistakes, not channel problems
        if (status && status >= 400 && status < 500) return;

        // 4. If in Half-Open, one failure trips it back to Disabled
        if (channel.status === 4 || channel.status === 5) {
            await this.disableChannel(channelId, `Failed during recovery/busy period: ${status}`);
            return;
        }

        // 5. Add failure event to the time window
        const events = this.events.get(channelId) || [];
        events.push({ timestamp: Date.now(), success: false, status });
        this.events.set(channelId, events);

        // Reset consecutive success counter
        this.successCounts.delete(channelId);

        // 6. Check if failure rate in the window exceeds the threshold
        await this.checkAndTrip(channelId);
    }

    private async disableChannel(channelId: number, reason?: string) {
        try {
            await sql`
                UPDATE channels
                SET status = 3, status_message = ${reason || null}, updated_at = NOW()
                WHERE id = ${channelId} AND status != 2
            `;
            await memoryCache.refresh();
            // Clear events and counters for this channel
            this.events.delete(channelId);
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

    /**
     * Get circuit breaker stats for monitoring/admin.
     */
    public getStats() {
        const stats: Record<number, { total: number; failures: number; rate: string; avgLatency: string }> = {};
        for (const [channelId] of this.events) {
            const { total, failures, rate } = this.getChannelFailureRate(channelId);
            const avgLatency = this.latencyMetrics.get(channelId);
            stats[channelId] = {
                total,
                failures,
                rate: `${(rate * 100).toFixed(1)}%`,
                avgLatency: avgLatency ? `${Math.round(avgLatency)}ms` : 'N/A'
            };
        }
        return stats;
    }
}

export const circuitBreaker = new CircuitBreaker();
