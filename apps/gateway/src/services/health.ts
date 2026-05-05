import { config } from '../config';
import { log } from '../services/logger';
import { getErrorMessage } from '../utils/error';
import { db, sql } from "@elygate/db";
import { channels, healthLogs } from '@elygate/db/schema';
import { eq, and, gt, sql as drizzleSql } from 'drizzle-orm';
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

            const activeChannels = await db.select({
                id: channels.id,
                type: channels.type,
                baseUrl: channels.baseUrl,
                key: channels.key,
                testErrors: channels.testErrors,
            })
            .from(channels)
            .where(eq(channels.status, 1));

            for (const ch of activeChannels) {
                const testUrl = `${ch.baseUrl}/v1/models`;
                const keys = ch.key.split('\n').map((k: string) => k.trim()).filter(Boolean);
                const activeKey = keys[0];

                try {
                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), 10000);

                    const startTime = Date.now();
                    const res = await fetch(testUrl, {
                        headers: { 'Authorization': `Bearer ${activeKey}` },
                        signal: controller.signal
                    });
                    const latency = Date.now() - startTime;

                    clearTimeout(timeoutId);

                    if (res.ok) {
                        await db.insert(healthLogs).values({
                            channelId: ch.id,
                            status: 1,
                            latency,
                        });

                        if (ch.testErrors > 0) {
                            await db.update(channels)
                                .set({ testErrors: 0, testAt: new Date() })
                                .where(eq(channels.id, ch.id));
                        } else {
                            await db.update(channels)
                                .set({ testAt: new Date() })
                                .where(eq(channels.id, ch.id));
                        }
                    } else {
                        throw new Error(`HTTP ${res.status}`);
                    }
                } catch (e: unknown) {
                    const newErrors = ch.testErrors + 1;
                    log.warn(`[HealthCheck] Channel ${ch.id} failed ping (${newErrors}/${this.MAX_ERRORS}). Error:`, getErrorMessage(e));

                    await db.insert(healthLogs).values({
                        channelId: ch.id,
                        status: 0,
                        errorMessage: getErrorMessage(e),
                    });

                    if (newErrors >= this.MAX_ERRORS) {
                        log.error(`[HealthCheck] Channel ${ch.id} auto-disabled due to consecutive failures.`);
                        await db.update(channels)
                            .set({ status: 3, testErrors: newErrors, testAt: new Date() })
                            .where(eq(channels.id, ch.id));
                        memoryCache.refresh().catch((e: unknown) => log.error("[Async]", e));

                        try {
                            const { notificationService } = await import('./notifier');
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
                        await db.update(channels)
                            .set({ testErrors: newErrors, testAt: new Date() })
                            .where(eq(channels.id, ch.id));
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

setInterval(() => {
    if (String(config.enableHealthCheck) === 'true') {
        healthCheckService.checkAllChannels();
    }
}, 10 * 60 * 1000);
