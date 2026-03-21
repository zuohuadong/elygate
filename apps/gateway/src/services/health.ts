import { config } from '../config';
import { log } from '../services/logger';
import { getErrorMessage } from '../utils/error';
import { sql } from "@elygate/db";
import { memoryCache } from "./cache";

/**
 * Background Channel Health Checker
 * Proactively tests active channels using a lightweight model (e.g., gpt-3.5-turbo).
 * If a channel fails 3 consecutive times, it is auto-disabled.
 */
class HealthChecker {
    private isRunning = false;
    private readonly MAX_ERRORS = 3;

    public async checkAllChannels() {
        if (this.isRunning) return;
        this.isRunning = true;
        try {
            log.info("[HealthCheck] Starting proactive channel verification...");

            // Fetch all currently active channels
            const channels = await sql`
                SELECT id, type, base_url, key, test_errors
                FROM channels
                WHERE status = 1
            `;

            for (const ch of channels) {
                // In a full implementation, you'd use the provider-specific handler here.
                // For proxy/OpenAI standard channels, we do a simple models endpoint ping.
                const testUrl = `${ch.base_url}/v1/models`;
                const keys = ch.key.split('\n').map((k: string) => k.trim()).filter(Boolean);
                const activeKey = keys[0];

                try {
                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout

                    const startTime = Date.now();
                    const res = await fetch(testUrl, {
                        headers: { 'Authorization': `Bearer ${activeKey}` },
                        signal: controller.signal
                    });
                    const latency = Date.now() - startTime;

                    clearTimeout(timeoutId);

                    if (res.ok) {
                        // Record health log
                        await sql`INSERT INTO health_logs (channel_id, status, latency) VALUES (${ch.id}, 1, ${latency})`;

                        // Reset error count on success
                        if (ch.test_errors > 0) {
                            await sql`UPDATE channels SET test_errors = 0, test_at = NOW() WHERE id = ${ch.id}`;
                        } else {
                            await sql`UPDATE channels SET test_at = NOW() WHERE id = ${ch.id}`;
                        }
                    } else {
                        throw new Error(`HTTP ${res.status}`);
                    }
                } catch (e: unknown) {
                    const newErrors = ch.test_errors + 1;
                    log.warn(`[HealthCheck] Channel ${ch.id} failed ping (${newErrors}/${this.MAX_ERRORS}). Error:`, getErrorMessage(e));

                    // Record failure health log
                    await sql`INSERT INTO health_logs (channel_id, status, error_message) VALUES (${ch.id}, 0, ${getErrorMessage(e)})`;

                    if (newErrors >= this.MAX_ERRORS) {
                        log.error(`[HealthCheck] Channel ${ch.id} auto-disabled due to consecutive failures.`);
                        await sql`UPDATE channels SET status = 3, test_errors = ${newErrors}, test_at = NOW() WHERE id = ${ch.id}`;
                        memoryCache.refresh().catch((e: unknown) => log.error("[Async]", e));

                        // Also notify admin and trigger webhook (similar to circuit breaker)
                        try {
                            const { notificationService } = await import('./notification');
                            const { webhookService } = await import('./webhook');
                            await notificationService.send(
                                'Proactive Health Check Failed',
                                `Channel ID ${ch.id} has been disabled due to consecutive ping failures.`
                            );
                            await webhookService.trigger('channel.disabled', { channelId: ch.id });
                        } catch (err) {
                            log.error('[HealthCheck] Failed to send notification:', err);
                        }
                    } else {
                        await sql`UPDATE channels SET test_errors = ${newErrors}, test_at = NOW() WHERE id = ${ch.id}`;
                    }
                }
            }
        } catch (e: unknown) {
            log.error("[HealthCheck] Global Error:", e);
        } finally {
            this.isRunning = false;
        }
    }
}

export const healthCheckService = new HealthChecker();

// Start background cron job to run every 10 minutes
setInterval(() => {
    // Only run if the environment specifically enables proactive testing
    // to save dummy request costs, or if optionCache defines it
    if (String(config.enableHealthCheck) === 'true') {
        healthCheckService.checkAllChannels();
    }
}, 10 * 60 * 1000); // 10 minutes
