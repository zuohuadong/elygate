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
    public async recordError(channelId: number, status?: number, message?: string, activeKey?: string) {
        const channel = memoryCache.channels.get(channelId);
        if (!channel) return;

        // 1. Auth/Balance errors (401/403) → mark individual KEY, not entire channel
        if ((status === 401 || status === 403) && activeKey) {
            return this.markKeyExhausted(channelId, activeKey, status, message);
        }
        // Fallback if no activeKey provided — legacy behavior
        if (status === 401) {
            log.error(`[CircuitBreaker] Channel ${channelId} Auth Error (401). Disabling.`);
            await this.disableChannel(channelId, `Auth Error: 401 ${message || ""}`);
            return;
        }
        if (status === 403) {
            log.warn(`[CircuitBreaker] Channel ${channelId} received 403. Marking as Busy.`);
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

        // 4. For recovering/busy channels, don't disable on a single failure.
        //    Let them use the same time-window failure rate check as normal channels.
        //    The health check auto-recovery will handle status=4→1 transition.

        // 5. Add failure event to the time window
        const events = this.events.get(channelId) || [];
        events.push({ timestamp: Date.now(), success: false, status });
        this.events.set(channelId, events);

        // Reset consecutive success counter
        this.successCounts.delete(channelId);

        // 6. Check if failure rate in the window exceeds the threshold
        await this.checkAndTrip(channelId);
    }

    /**
     * Mark a specific key as exhausted. Only disable the channel if ALL keys are exhausted.
     */
    private async markKeyExhausted(channelId: number, key: string, status: number, message?: string) {
        try {
            // Fetch current channel state
            const [ch] = await sql`SELECT key, key_status FROM channels WHERE id = ${channelId}`;
            if (!ch) return;

            const allKeys = ch.key.split('\n').map((k: string) => k.trim()).filter(Boolean);
            const statusMap: Record<string, any> = (typeof ch.key_status === 'string'
                ? JSON.parse(ch.key_status)
                : ch.key_status) || {};

            // Mark this key with reason details
            const reason = status === 401 ? 'invalid' : 'exhausted';
            const shortMsg = (message || '').substring(0, 150);
            statusMap[key] = { status: reason, reason: shortMsg, time: new Date().toISOString() };
            log.warn(`[CircuitBreaker] Channel ${channelId} key ${key.substring(0, 8)}... marked as ${reason} (${status}). ${shortMsg}`);

            // Update key_status in DB
            await sql`UPDATE channels SET key_status = ${statusMap}, updated_at = NOW() WHERE id = ${channelId}`;

            // Check if ALL keys are now exhausted/invalid
            const isKeyBad = (v: any) => {
                if (typeof v === 'string') return v === 'exhausted' || v === 'invalid';
                return v?.status === 'exhausted' || v?.status === 'invalid';
            };
            const healthyKeys = allKeys.filter((k: string) => !statusMap[k] || !isKeyBad(statusMap[k]));

            if (healthyKeys.length === 0) {
                log.error(`[CircuitBreaker] Channel ${channelId} ALL ${allKeys.length} keys exhausted. Disabling channel.`);
                await this.disableChannel(channelId, `All ${allKeys.length} keys ${reason}: ${status}`);
            } else {
                log.info(`[CircuitBreaker] Channel ${channelId} still has ${healthyKeys.length}/${allKeys.length} healthy keys.`);
                await memoryCache.refresh();
                // Notify admin about the exhausted key
                const shouldNotify = String(optionCache.get('Notify_On_Channel_Offline', 'true')) === 'true';
                if (shouldNotify) {
                    await notificationService.send(
                        'Key Exhausted',
                        `Channel ${channelId} key ${key.substring(0, 8)}... marked ${reason}. ${healthyKeys.length}/${allKeys.length} keys remaining.`
                    );
                }
            }
        } catch (e: unknown) {
            log.error(`[CircuitBreaker] Failed to mark key exhausted for channel ${channelId}:`, e);
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
            let changed = false;

            // 1. Auto-recover Status 5 (Busy) after 1 minute cooldown
            const busyChannels = await sql`
                SELECT id FROM channels WHERE status = 5 AND updated_at < NOW() - INTERVAL '1 minute'
            `;
            for (const ch of busyChannels) {
                log.info(`[HealthCheck] Auto-recovering Busy channel ${ch.id} to Online.`);
                await sql`UPDATE channels SET status = 1, status_message = NULL, updated_at = NOW() WHERE id = ${ch.id}`;
                changed = true;
            }

            // 2. Auto-recover Status 4 (Testing Recovery) after 2 minutes — no re-ping needed
            //    The initial ping that moved it from status=3→4 already proved connectivity.
            //    Re-pinging can cause false negatives (e.g. /v1/models returns 404 but chat works).
            const testingChannels = await sql`
                SELECT id FROM channels 
                WHERE status = 4 AND updated_at < NOW() - INTERVAL '2 minutes'
            `;
            for (const ch of testingChannels) {
                log.info(`[HealthCheck] Auto-recovering Testing Recovery channel ${ch.id} to Online (cooldown passed).`);
                await sql`UPDATE channels SET status = 1, status_message = NULL, updated_at = NOW() WHERE id = ${ch.id}`;
                changed = true;
            }

            // 3. Try to recover Status 3 (Disabled) channels — ping to check if they're back
            //    Skip channels disabled for Auth Error (401) — those need manual key fix
            const disabledChannels = await sql`
                SELECT id, base_url AS "baseUrl", key, type FROM channels 
                WHERE status = 3 
                  AND (status_message IS NULL OR status_message NOT LIKE 'Auth Error: 401%')
                  AND updated_at < NOW() - INTERVAL '2 minutes'
            `;
            
            for (const ch of disabledChannels) {
                const isHealthy = await this.pingChannel(ch);
                if (isHealthy) {
                    log.info(`[HealthCheck] Disabled channel ${ch.id} ping succeeded. Moving to Testing Recovery.`);
                    await sql`UPDATE channels SET status = 4, status_message = 'Testing Recovery', updated_at = NOW() WHERE id = ${ch.id}`;
                    changed = true;
                }
            }

            // 4. Auto-recover exhausted keys — probe each exhausted key to see if balance is back
            //    Reference: New API relay_controller pattern — periodic key re-validation
            const channelsWithExhaustedKeys = await sql`
                SELECT id, base_url AS "baseUrl", key, key_status, type, status, models
                FROM channels
                WHERE key_status != '{}' AND key_status IS NOT NULL
                  AND updated_at < NOW() - INTERVAL '5 minutes'
            `;

            for (const ch of channelsWithExhaustedKeys) {
                const statusMap: Record<string, any> = (typeof ch.key_status === 'string'
                    ? JSON.parse(ch.key_status)
                    : ch.key_status) || {};

                const isKeyBad = (v: any) => {
                    if (typeof v === 'string') return v === 'exhausted' || v === 'invalid';
                    return v?.status === 'exhausted' || v?.status === 'invalid';
                };

                const exhaustedKeys = Object.entries(statusMap)
                    .filter(([_, v]) => isKeyBad(v))
                    .map(([k]) => k);

                if (exhaustedKeys.length === 0) continue;

                let restoredCount = 0;
                for (const key of exhaustedKeys) {
                    const isOk = await this.probeKey(ch.baseUrl, key);
                    if (isOk) {
                        delete statusMap[key];
                        restoredCount++;
                        log.info(`[HealthCheck] Key ${key.substring(0, 8)}... on channel ${ch.id} recovered. Restoring.`);
                    }
                }

                if (restoredCount > 0) {
                    await sql`UPDATE channels SET key_status = ${statusMap}, updated_at = NOW() WHERE id = ${ch.id}`;
                    changed = true;

                    // If channel was disabled due to all keys exhausted, bring it back online
                    if (ch.status === 3) {
                        const allKeys = ch.key.split('\n').map((k: string) => k.trim()).filter(Boolean);
                        const stillBad = allKeys.filter((k: string) => statusMap[k] && isKeyBad(statusMap[k]));
                        if (stillBad.length < allKeys.length) {
                            log.info(`[HealthCheck] Channel ${ch.id} has ${allKeys.length - stillBad.length} healthy keys. Restoring to Online.`);
                            await sql`UPDATE channels SET status = 1, status_message = NULL, updated_at = NOW() WHERE id = ${ch.id}`;
                        }
                    }
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
     * Probe a single key by making a lightweight /v1/models request.
     * Returns true if the key is valid and has balance (status < 400).
     */
    private async probeKey(baseUrl: string, key: string): Promise<boolean> {
        const timeoutMs = parseInt(optionCache.get('HEALTH_CHECK_TIMEOUT', '10000'));
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), timeoutMs);
            const url = `${baseUrl.replace(/\/+$/, '')}/v1/models`;
            const res = await fetch(url, {
                method: 'GET',
                headers: { 'Authorization': `Bearer ${key}` },
                signal: controller.signal
            });
            clearTimeout(timeout);
            // 401/403 = still bad, 200/other = recovered
            return res.status < 400;
        } catch {
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
