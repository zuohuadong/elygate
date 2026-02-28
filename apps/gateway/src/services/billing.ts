import { sql } from '@elygate/db';
import { calculateCost } from './ratio';

export interface BillingContext {
    userId: number;
    tokenId: number;
    channelId: number;
    modelName: string;
    promptTokens: number;
    completionTokens: number;
    userGroup: string; // User group for discount ratio mapping
    isStream: boolean;
}

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
}) {
    const estimatedCost = calculateCost(ctx.modelName, ctx.userGroup, 0, ctx.maxTokens || 4096);

    // Perform atomic check and deduction
    const result = await sql.begin(async (tx) => {
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
    await sql.begin(async (tx) => {
        await tx`UPDATE users SET quota = quota + ${diff} WHERE id = ${ctx.userId}`;
        await tx`UPDATE tokens SET remain_quota = CASE WHEN remain_quota >= 0 THEN remain_quota + ${diff} ELSE remain_quota END WHERE id = ${ctx.tokenId}`;
    });
}

/**
 * Receive a consumption request...
 */
export async function billAndLog(ctx: BillingContext) {
    if ((ctx.promptTokens + ctx.completionTokens) <= 0) return;
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
        const cost = calculateCost(
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
            quotaCost: cost,
            isStream: task.isStream
        });
    }

    try {
        // 2. Atomic update using native SQL transaction
        await sql.begin(async (tx) => {
            // Batch update Tokens quota
            for (const [tokenId, cost] of Object.entries(tokenAgg)) {
                await tx`
                    UPDATE tokens
                    SET used_quota = used_quota + ${cost},
                        remain_quota = CASE WHEN remain_quota > 0 THEN remain_quota - ${cost} ELSE remain_quota END
                    WHERE id = ${Number(tokenId)}
                `;
            }

            // Batch update Users quota
            for (const [userId, cost] of Object.entries(userAgg)) {
                await tx`
                    UPDATE users
                    SET used_quota = used_quota + ${cost},
                        quota = quota - ${cost}
                    WHERE id = ${Number(userId)}
                `;
            }

            // Batch INSERT log records
            if (logInserts.length > 0) {
                for (const log of logInserts) {
                    await tx`
                        INSERT INTO logs (user_id, token_id, channel_id, model_name, prompt_tokens, completion_tokens, quota_cost, is_stream)
                        VALUES (${log.userId}, ${log.tokenId || null}, ${log.channelId || null}, ${log.modelName}, 
                                ${log.promptTokens}, ${log.completionTokens}, ${log.quotaCost}, ${log.isStream})
                    `;
                }
            }
        });

        // 3. Post-flush check for Quota Alarms
        for (const [userIdStr, cost] of Object.entries(userAgg)) {
            const userId = Number(userIdStr);
            const [user] = await sql`SELECT quota, username FROM users WHERE id = ${userId}`;
            if (user && user.quota < 500000) { // Threshold: e.g. 0.5M quota units
                const { notificationService } = await import('./notification');
                await notificationService.send(
                    'Quota Alarm',
                    `User ${user.username} (ID: ${userId}) has low quota: ${user.quota}. Please top up soon.`
                );
            }
        }

        console.log(`[Billing/Flush] Merged & Ingested ${tasks.length} logs successfully.`);
    } catch (e: any) {
        console.error(`[Billing/Error] Failed to flush queue, re-queueing ${tasks.length} tasks. Error:`, e.message);
        // Re-queue tasks on failure (deadlock or phantom read)
        billingQueue.unshift(...tasks);
    } finally {
        isFlushing = false;
    }
}

// Start background daemon: flushes the queue every 1000ms (1 second)
setInterval(flushBillingQueue, 1000);

/**
 * Log Rotation Worker
 * Deletes logs older than LogRetentionDays (default 7 days) every 24 hours.
 */
async function rotateLogs() {
    const { optionCache } = await import('./optionCache');
    const days = optionCache.get('LogRetentionDays', 7);
    console.log(`[Billing/Rotation] Cleaning up logs older than ${days} days...`);
    try {
        await sql`DELETE FROM logs WHERE created_at < NOW() - INTERVAL '${sql.unsafe(days.toString())} days'`;
    } catch (e) {
        console.error('[Billing/Rotation] Failed:', e);
    }
}

// Run every 24 hours
setInterval(rotateLogs, 24 * 60 * 60 * 1000);
