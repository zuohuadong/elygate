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
            // Batch update Tokens quota using UPDATE ... FROM (VALUES ...)
            if (Object.keys(tokenAgg).length > 0) {
                const tokenValues = Object.entries(tokenAgg).map(([id, cost]) => [Number(id), cost]);
                await tx`
                    UPDATE tokens AS t
                    SET used_quota = t.used_quota + v.cost,
                        remain_quota = CASE WHEN t.remain_quota > 0 THEN t.remain_quota - v.cost ELSE t.remain_quota END
                    FROM (VALUES ${tokenValues}) AS v(id, cost)
                    WHERE t.id = v.id
                `;
            }

            // Batch update Users quota using UPDATE ... FROM (VALUES ...)
            if (Object.keys(userAgg).length > 0) {
                const userValues = Object.entries(userAgg).map(([id, cost]) => [Number(id), cost]);
                await tx`
                    UPDATE users AS u
                    SET used_quota = u.used_quota + v.cost,
                        quota = u.quota - v.cost
                    FROM (VALUES ${userValues}) AS v(id, cost)
                    WHERE u.id = v.id
                `;
            }

            // Batch INSERT log records (Postgres native multi-row insert)
            if (logInserts.length > 0) {
                const values = logInserts.map(log => [
                    log.userId,
                    log.tokenId || null,
                    log.channelId || null,
                    log.modelName,
                    log.promptTokens,
                    log.completionTokens,
                    log.quotaCost,
                    log.isStream
                ]);

                await tx`
                    INSERT INTO logs (user_id, token_id, channel_id, model_name, prompt_tokens, completion_tokens, quota_cost, is_stream)
                    VALUES ${values}
                `;
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
        // Fallback to DELETE for non-partitioned tables or safety.
        // For partitioned tables, the query optimizer in PG 12+ will prune partitions automatically.
        await sql`DELETE FROM logs WHERE created_at < NOW() - INTERVAL '${sql.unsafe(days.toString())} days'`;

        // Potential future enhancement if partition naming is predictable:
        // await sql`DROP TABLE IF EXISTS ${sql.unsafe(`logs_old_partition_name`)}`;
    } catch (e) {
        console.error('[Billing/Rotation] Failed:', e);
    }
}

// Run every 24 hours
setInterval(rotateLogs, 24 * 60 * 60 * 1000);
