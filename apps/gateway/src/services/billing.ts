import { log } from '../services/logger';
import { getErrorMessage } from '../utils/error';
import { db } from '@elygate/db';
import { users, tokens, channels, logs, organizations, healthLogs } from '@elygate/db/schema';
import { eq, and, gte, inArray, sql as drizzleSql } from 'drizzle-orm';
import type { BillingContext } from '../types';
import { calculateCost } from './ratio';
import { enqueueBillingFlush, enqueueWebhookDelivery } from './jobQueue';

const billingQueue: BillingContext[] = [];
let isFlushing = false;
const MAX_QUEUE_SIZE = 10000;
const MAX_RETRY_COUNT = 3;
const FLUSH_INTERVAL_MS = 500;
const QUEUE_WARNING_THRESHOLD = 100;

export function getQueueStats(): { length: number; isFlushing: boolean; warningThreshold: number; maxQueueSize: number } {
    return {
        length: billingQueue.length,
        isFlushing,
        warningThreshold: QUEUE_WARNING_THRESHOLD,
        maxQueueSize: MAX_QUEUE_SIZE
    };
}

export async function preCheckAndDecrement(ctx: {
    userId: number;
    tokenId: number;
    modelName: string;
    userGroup: string;
    maxTokens: number;
    isPackageFree?: boolean;
}): Promise<number> {
    if (ctx.isPackageFree) return 0;
    const estimatedCost = calculateCost(ctx.modelName, ctx.userGroup, 0, ctx.maxTokens || 4096);

    const result = await db.transaction(async (tx) => {
        // CASE-based conditional UPDATE requires raw SQL
        const [user] = await tx.update(users).set({
            quota: drizzleSql`quota - ${estimatedCost}`,
        }).where(and(eq(users.id, ctx.userId), gte(users.quota, estimatedCost))).returning({ id: users.id });
        if (!user) return false;

        const [token] = await tx.execute(drizzleSql`
            UPDATE tokens
            SET remain_quota = CASE
                WHEN unlimited_quota THEN remain_quota
                WHEN remain_quota > 0 THEN remain_quota - ${estimatedCost}
                ELSE remain_quota
            END
            WHERE id = ${ctx.tokenId}
              AND (unlimited_quota OR remain_quota = -1 OR remain_quota >= ${estimatedCost})
            RETURNING id
        `);
        return !!token;
    });

    if (!result) {
        throw new Error("Insufficient quota (Locked/Pre-deducted)");
    }
    return estimatedCost;
}

export async function reconcileQuota(ctx: {
    userId: number;
    tokenId: number;
    preDeducted: number;
    actualCost: number;
}): Promise<void> {
    const diff = ctx.preDeducted - ctx.actualCost;
    if (diff === 0) return;

    await db.transaction(async (tx) => {
        await tx.update(users).set({ quota: drizzleSql`quota + ${diff}` }).where(eq(users.id, ctx.userId));
        await tx.execute(drizzleSql`
            UPDATE tokens
            SET remain_quota = CASE
                WHEN unlimited_quota THEN remain_quota
                WHEN remain_quota >= 0 THEN remain_quota + ${diff}
                ELSE remain_quota
            END
            WHERE id = ${ctx.tokenId}
        `);
    });
}

export async function billAndLog(ctx: BillingContext): Promise<void> {
    try {
        await enqueueBillingFlush(ctx);
        return;
    } catch (err: unknown) {
        log.error('[Billing/Error] Failed to enqueue pg-boss billing job, using local fallback:', getErrorMessage(err));
    }

    enqueueFallbackBilling(ctx);
}

function enqueueFallbackBilling(ctx: BillingContext): void {
    if (billingQueue.length >= MAX_QUEUE_SIZE) {
        log.error(`[Billing/Warning] Queue is full (${billingQueue.length}/${MAX_QUEUE_SIZE}), dropping oldest entry`);
        billingQueue.shift();
    }
    billingQueue.push(ctx);
    
    if (billingQueue.length > QUEUE_WARNING_THRESHOLD) {
        log.warn(`[Billing/Warning] Queue length is ${billingQueue.length}, consider scaling`);
    }
}

async function flushBillingQueue(retryCount = 0) {
    if (isFlushing || billingQueue.length === 0) return;
    isFlushing = true;

    const tasks = billingQueue.splice(0, billingQueue.length);

    try {
        await processBillingJobs(tasks);
    } catch (e: unknown) {
        log.error(`[Billing/Error] Failed to flush fallback queue (attempt ${retryCount + 1}/${MAX_RETRY_COUNT}). Error:`, getErrorMessage(e));

        if (retryCount < MAX_RETRY_COUNT - 1) {
            billingQueue.unshift(...tasks);
            isFlushing = false;
            setTimeout(() => flushBillingQueue(retryCount + 1), 100 * (retryCount + 1));
            return;
        } else {
            log.error(`[Billing/Error] Max retries reached, keeping ${tasks.length} fallback tasks for next flush`);
            billingQueue.push(...tasks);
        }
    } finally {
        isFlushing = false;
    }
}

export async function processBillingJobs(tasks: BillingContext[]): Promise<void> {
    if (tasks.length === 0) return;

    const logInserts: Record<string, any>[] = [];

    for (const task of tasks) {
        const cost = task.isPackageFree ? 0 : calculateCost(
            task.modelName,
            task.userGroup,
            task.promptTokens,
            task.completionTokens
        );

        logInserts.push({
            userId: task.userId,
            tokenId: task.tokenId,
            channelId: task.channelId,
            modelName: task.modelName,
            promptTokens: task.promptTokens,
            completionTokens: task.completionTokens,
            cachedTokens: task.cachedTokens || 0,
            quotaCost: cost,
            isStream: task.isStream,
            statusCode: task.statusCode || 200,
            errorMessage: task.errorMessage || null,
            elapsedMs: task.elapsedMs || 0,
            ip: task.ip || null,
            ua: task.ua || null,
            traceId: task.traceId || null,
            orgId: task.orgId || null,
            externalTaskId: task.externalTaskId || null,
            externalUserId: task.externalUserId || null,
            externalWorkspaceId: task.externalWorkspaceId || null,
            externalFeatureType: task.externalFeatureType || null,
            requestBody: task.requestBody || null,
            responseBody: task.responseBody || null
        });
    }

    const uniqueChannelIds = [...new Set(tasks.map((t: Record<string, any>) => t.channelId).filter(Boolean))];
    const channelRatios: Record<number, number> = {};
    if (uniqueChannelIds.length > 0) {
        const chRows = await db.select({ id: channels.id, priceRatio: channels.priceRatio })
            .from(channels)
            .where(inArray(channels.id, uniqueChannelIds));
        for (const ch of chRows) {
            channelRatios[ch.id] = Number(ch.priceRatio) || 1.0;
        }
    }

    await db.transaction(async (tx) => {
        const correctedUserAgg: Record<number, number> = {};
        const correctedTokenAgg: Record<number, number> = {};
        const correctedOrgAgg: Record<number, number> = {};

        for (const [index, task] of tasks.entries()) {
            const baseCost = task.isPackageFree ? 0 : calculateCost(
                task.modelName,
                task.userGroup,
                task.promptTokens,
                task.completionTokens
            );
            const ratio = task.channelId ? (channelRatios[task.channelId] || 1.0) : 1.0;
            const finalCost = Math.ceil(baseCost * ratio);

            correctedUserAgg[task.userId] = (correctedUserAgg[task.userId] || 0) + finalCost;
            correctedTokenAgg[task.tokenId] = (correctedTokenAgg[task.tokenId] || 0) + finalCost;
            if (task.orgId) {
                correctedOrgAgg[task.orgId] = (correctedOrgAgg[task.orgId] || 0) + finalCost;
            }

            logInserts[index].quotaCost = finalCost;
        }

        // Batch UPDATEs — use raw SQL for += operations
        for (const [id, cost] of Object.entries(correctedTokenAgg)) {
            await tx.update(tokens).set({ usedQuota: drizzleSql`used_quota + ${cost}` }).where(eq(tokens.id, Number(id)));
        }
        for (const [id, cost] of Object.entries(correctedUserAgg)) {
            await tx.update(users).set({ usedQuota: drizzleSql`used_quota + ${cost}` }).where(eq(users.id, Number(id)));
        }
        for (const [id, cost] of Object.entries(correctedOrgAgg)) {
            await tx.update(organizations).set({ usedQuota: drizzleSql`used_quota + ${cost}` }).where(eq(organizations.id, Number(id)));
        }
        for (const log of logInserts) {
            const [inserted] = await tx.insert(logs).values({
                userId: log.userId,
                tokenId: log.tokenId ?? null,
                channelId: log.channelId !== undefined ? log.channelId : null,
                modelName: log.modelName,
                promptTokens: log.promptTokens,
                completionTokens: log.completionTokens,
                cachedTokens: log.cachedTokens,
                quotaCost: log.quotaCost,
                isStream: log.isStream,
                statusCode: log.statusCode,
                errorMessage: log.errorMessage,
                elapsedMs: log.elapsedMs,
                ipAddress: log.ip,
                userAgent: log.ua,
                traceId: log.traceId,
                orgId: log.orgId,
                externalTaskId: log.externalTaskId,
                externalUserId: log.externalUserId,
                externalWorkspaceId: log.externalWorkspaceId,
                externalFeatureType: log.externalFeatureType,
            }).returning({ id: logs.id, createdAt: logs.createdAt });

            if (inserted && (log.requestBody || log.responseBody)) {
                await tx.execute(drizzleSql`
                    INSERT INTO log_details (log_id, log_created_at, request_body, response_body)
                    VALUES (${inserted.id}, ${inserted.createdAt}, ${log.requestBody}, ${log.responseBody})
                    ON CONFLICT (log_id) DO UPDATE
                    SET log_created_at = EXCLUDED.log_created_at,
                        request_body = EXCLUDED.request_body,
                        response_body = EXCLUDED.response_body
                `);
            }
        }
    });

    // Organization-level Quota Alerts
    const uniqueOrgIds = [...new Set(tasks.map((t: Record<string, any>) => t.orgId).filter(Boolean))];
    if (uniqueOrgIds.length > 0) {
        // Complex SELECT with multiple columns — raw SQL for the org-specific fields
        const orgs = await db.select({
            id: organizations.id,
            name: organizations.name,
            quota: organizations.quota,
            usedQuota: organizations.usedQuota,
            alertWebhookUrl: organizations.alertWebhookUrl,
            alertThresholdPct: organizations.alertThresholdPct,
            lastAlertAt: organizations.lastAlertAt,
        }).from(organizations).where(inArray(organizations.id, uniqueOrgIds as number[]));

        for (const org of orgs) {
            if (!org.alertWebhookUrl) continue;

            const threshold = org.alertThresholdPct || 80;
            const usagePct = (Number(org.usedQuota) / Math.max(Number(org.quota), 1)) * 100;

            if (usagePct >= threshold) {
                const lastAlert = org.lastAlertAt ? new Date(org.lastAlertAt).getTime() : 0;
                const oneDay = 24 * 60 * 60 * 1000;

                if (Date.now() - lastAlert > oneDay) {
                    try {
                        log.info(`[Billing/Alert] Queueing quota alert for organization: ${org.name}`);
                        await enqueueWebhookDelivery({
                            event: 'org.quota_alert',
                            url: org.alertWebhookUrl,
                            body: {
                                event: 'org.quota_alert',
                                orgId: org.id,
                                orgName: org.name,
                                usagePct: usagePct.toFixed(1),
                                thresholdPct: threshold,
                                timestamp: new Date().toISOString()
                            },
                            headers: { 'Content-Type': 'application/json' },
                            logLabel: `org quota alert ${org.id}`,
                        });

                        await db.update(organizations).set({ lastAlertAt: new Date() }).where(eq(organizations.id, org.id));
                    } catch (err: unknown) {
                        log.error(`[Billing/Error] Failed to enqueue webhook alert for org ${org.id}:`, getErrorMessage(err));
                    }
                }
            }
        }
    }

    log.info(`[Billing/Flush] Merged & Ingested ${tasks.length} logs successfully.`);
}

setInterval(flushBillingQueue, FLUSH_INTERVAL_MS);

async function rotateLogs() {
    const { optionCache } = await import('./optionCache');
    const days = optionCache.get('LogRetentionDays', 7);
    log.info(`[Billing/Rotation] Cleaning up logs older than ${days} days...`);
    try {
        await db.delete(logs).where(drizzleSql`created_at < NOW() - ${days} * INTERVAL '1 day'`);
        await db.delete(healthLogs).where(drizzleSql`created_at < NOW() - ${days} * INTERVAL '1 day'`);
    } catch (e: unknown) {
        log.error('[Billing/Rotation] Failed:', e);
    }
}

setInterval(rotateLogs, 24 * 60 * 60 * 1000);
