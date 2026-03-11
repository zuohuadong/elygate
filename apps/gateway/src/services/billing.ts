import { sql } from '@elygate/db';
import { type BillingContext } from '../types';
import { calculateCost } from './ratio';
import { webhookService } from './webhook';

// Mocking the global log consumption buffer (channel) in New-API
const billingQueue: BillingContext[] = [];

// Flush status control to prevent concurrent stack-ups
let isFlushing = false;

/**
 * Synchronous Quota Check and Pre-decrement
 * Call this before upstream request to prevent user/token overdraft under high concurrency.
 * Pre-charges based on max_tokens * ratio (worst case scenario).
 */
export async function preCheckAndDecrement(ctx: {
    userId: number;
    tokenId: number;
    modelName: string;
    userGroup: string;
    maxTokens: number;
    isPackageFree?: boolean;
}) {
    if (ctx.isPackageFree) return 0;
    const estimatedCost = calculateCost(ctx.modelName, ctx.userGroup, 0, ctx.maxTokens || 4096);

    // Perform atomic check and deduction
    const result = await sql.begin(async (tx: any) => {
        const [user] = await tx`
            UPDATE users 
            SET quota = quota - ${estimatedCost}
            WHERE id = ${ctx.userId} AND quota >= ${estimatedCost}
            RETURNING id
        `;
        if (!user) return false;

        const [token] = await tx`
            UPDATE tokens
            SET remain_quota = CASE WHEN remain_quota > 0 THEN remain_quota - ${estimatedCost} ELSE remain_quota END
            WHERE id = ${ctx.tokenId} AND (remain_quota = -1 OR remain_quota >= ${estimatedCost})
            RETURNING id
        `;
        return !!token;
    });

    if (!result) {
        throw new Error("Insufficient quota (Locked/Pre-deducted)");
    }
    return estimatedCost;
}

/**
 * Reconcile Quota after request completion.
 * Corrects the pre-deducted amount with the actual usage.
 */
export async function reconcileQuota(ctx: {
    userId: number;
    tokenId: number;
    preDeducted: number;
    actualCost: number;
}) {
    const diff = ctx.preDeducted - ctx.actualCost;
    if (diff === 0) return;

    // Refund the difference (diff can be negative if usage exceeded max_tokens somehow, though unlikely)
    await sql.begin(async (tx: any) => {
        await tx`UPDATE users SET quota = quota + ${diff} WHERE id = ${ctx.userId}`;
        await tx`UPDATE tokens SET remain_quota = CASE WHEN remain_quota >= 0 THEN remain_quota + ${diff} ELSE remain_quota END WHERE id = ${ctx.tokenId}`;
    });
}

/**
 * Receive a consumption request and add it to the billing queue.
 * Always logs, even if token count is 0 (for error tracking).
 */
export async function billAndLog(ctx: BillingContext) {
    billingQueue.push(ctx);
}

/**
 * Background worker: aggregates queue data and flushes to PostgreSQL.
 * Simulates memory merge logic from New-API / One-API.
 */
async function flushBillingQueue() {
    if (isFlushing || billingQueue.length === 0) return;
    isFlushing = true;

    // Current tasks extracted and queue cleared for new requests
    const tasks = billingQueue.splice(0, billingQueue.length);

    // 1. In-memory billing aggregation: merge concurrent deductions for the same user/token
    const userAgg: Record<number, number> = {};
    const tokenAgg: Record<number, number> = {};
    const logInserts: any[] = [];

    for (const task of tasks) {
        // Use abstract ratio engine to calculate the actual quota cost based on model and user group factors
        const cost = task.isPackageFree ? 0 : calculateCost(
            task.modelName,
            task.userGroup,
            task.promptTokens,
            task.completionTokens
        );

        userAgg[task.userId] = (userAgg[task.userId] || 0) + cost;
        tokenAgg[task.tokenId] = (tokenAgg[task.tokenId] || 0) + cost;

        logInserts.push({
            userId: task.userId,
            tokenId: task.tokenId,
            channelId: task.channelId,
            modelName: task.modelName,
            promptTokens: task.promptTokens,
            completionTokens: task.completionTokens,
            cachedTokens: task.cachedTokens || 0,
            quotaCost: cost,
            isStream: task.isStream
        });
    }

    try {
        // Fetch price ratios for all channels involved in this batch
        const uniqueChannelIds = [...new Set(tasks.map((t: any) => t.channelId).filter(Boolean))];
        const channelRatios: Record<number, number> = {};
        if (uniqueChannelIds.length > 0) {
            const channels = await sql`SELECT id, price_ratio FROM channels WHERE id IN ${uniqueChannelIds}`;
            for (const ch of channels) {
                channelRatios[ch.id] = Number(ch.price_ratio) || 1.0;
            }
        }

        // 2. Atomic update using native SQL transaction
        await sql.begin(async (tx: any) => {
            const correctedUserAgg: Record<number, number> = {};
            const correctedTokenAgg: Record<number, number> = {};

            for (const task of tasks) {
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

                // Update quotaCost in logInserts
                const log = logInserts.find(l =>
                    l.userId === task.userId &&
                    l.channelId === task.channelId &&
                    l.modelName === task.modelName &&
                    l.promptTokens === task.promptTokens &&
                    l.completionTokens === task.completionTokens
                );
                if (log) log.quotaCost = finalCost;
            }

            for (const [id, cost] of Object.entries(correctedTokenAgg)) {
                await tx`UPDATE tokens SET used_quota = used_quota + ${cost} WHERE id = ${Number(id)}`;
            }
            for (const [id, cost] of Object.entries(correctedUserAgg)) {
                await tx`UPDATE users SET used_quota = used_quota + ${cost} WHERE id = ${Number(id)}`;
            }
            for (const log of logInserts) {
                await tx`
                    INSERT INTO logs (user_id, token_id, channel_id, model_name, prompt_tokens, completion_tokens, cached_tokens, quota_cost, is_stream)
                    VALUES (${log.userId}, ${log.tokenId || null}, ${log.channelId || null}, ${log.modelName}, ${log.promptTokens}, ${log.completionTokens}, ${log.cachedTokens}, ${log.quotaCost}, ${log.isStream})
                `;
            }
        });

        // 3. Post-flush check for Quota Alarms
        const alarmThreshold = (await import('./optionCache')).optionCache.get('QuotaAlarmThreshold', 500000);
        for (const [userIdStr, cost] of Object.entries(userAgg)) {
            const userId = Number(userIdStr);
            const [user] = await sql`SELECT quota, username FROM users WHERE id = ${userId}`;
            if (user && user.quota < alarmThreshold) {
                const { notificationService } = await import('./notification');
                await notificationService.send(
                    'Quota Alarm',
                    `User ${user.username} (ID: ${userId}) has low quota: ${user.quota}. Please top up soon.`
                );
                await webhookService.trigger('user.low_quota', { userId, username: user.username, quota: user.quota });
            }
        }

        console.log(`[Billing/Flush] Merged & Ingested ${tasks.length} logs successfully.`);
    } catch (e: any) {
        console.error(`[Billing/Error] Failed to flush queue, re-queueing ${tasks.length} tasks. Error:`, e.message);
        // Fallback: push back to the end of the queue to maintain sequence and prevent unordered insertion
        billingQueue.push(...tasks);
    } finally {
        isFlushing = false;
    }
}

// Start background daemon: flushes the queue every 1000ms (1 second)
setInterval(flushBillingQueue, 1000);

/**
 * Log Rotation Worker
 * Deletes logs older than LogRetentionDays (default 7 days) every 24 hours.
 * 
 * NOTE: If using Table Partitioning (see packages/db/src/optimize_logs.sql):
 * It's recommended to handle this via pg_cron or a dedicated script using:
 * "DROP TABLE logs_yXXXXmXX" or "ALTER TABLE logs DETACH PARTITION ..."
 * This is much faster than DELETE and avoids disk fragmentation.
 */
async function rotateLogs() {
    const { optionCache } = await import('./optionCache');
    const days = optionCache.get('LogRetentionDays', 7);
    console.log(`[Billing/Rotation] Cleaning up logs older than ${days} days...`);
    try {
        // Use safe parameterized interval arithmetic (no sql.unsafe needed)
        await sql`DELETE FROM logs WHERE created_at < NOW() - (${days} * INTERVAL '1 day')`;
        // Cleanup health logs as well to prevent DB bloat
        await sql`DELETE FROM health_logs WHERE created_at < NOW() - (${days} * INTERVAL '1 day')`;
    } catch (e) {
        console.error('[Billing/Rotation] Failed:', e);
    }
}

// Run every 24 hours
setInterval(rotateLogs, 24 * 60 * 60 * 1000);
