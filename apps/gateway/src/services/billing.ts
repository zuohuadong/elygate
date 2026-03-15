import { sql } from '@elygate/db';
import { type BillingContext } from '../types';
import { calculateCost } from './ratio';
import { webhookService } from './webhook';

const billingQueue: BillingContext[] = [];
let isFlushing = false;
const MAX_QUEUE_SIZE = 10000;
const MAX_RETRY_COUNT = 3;
const FLUSH_INTERVAL_MS = 500;
const QUEUE_WARNING_THRESHOLD = 100;

export function getQueueStats() {
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
}) {
    if (ctx.isPackageFree) return 0;
    const estimatedCost = calculateCost(ctx.modelName, ctx.userGroup, 0, ctx.maxTokens || 4096);

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

export async function reconcileQuota(ctx: {
    userId: number;
    tokenId: number;
    preDeducted: number;
    actualCost: number;
}) {
    const diff = ctx.preDeducted - ctx.actualCost;
    if (diff === 0) return;

    await sql.begin(async (tx: any) => {
        await tx`UPDATE users SET quota = quota + ${diff} WHERE id = ${ctx.userId}`;
        await tx`UPDATE tokens SET remain_quota = CASE WHEN remain_quota >= 0 THEN remain_quota + ${diff} ELSE remain_quota END WHERE id = ${ctx.tokenId}`;
    });
}

export async function billAndLog(ctx: BillingContext) {
    if (billingQueue.length >= MAX_QUEUE_SIZE) {
        console.error(`[Billing/Warning] Queue is full (${billingQueue.length}/${MAX_QUEUE_SIZE}), dropping oldest entry`);
        billingQueue.shift();
    }
    billingQueue.push(ctx);
    
    if (billingQueue.length > QUEUE_WARNING_THRESHOLD) {
        console.warn(`[Billing/Warning] Queue length is ${billingQueue.length}, consider scaling`);
    }
}

async function flushBillingQueue(retryCount = 0) {
    if (isFlushing || billingQueue.length === 0) return;
    isFlushing = true;

    const tasks = billingQueue.splice(0, billingQueue.length);

    const userAgg: Record<number, number> = {};
    const tokenAgg: Record<number, number> = {};
    const logInserts: any[] = [];

    for (const task of tasks) {
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

    try {
        const uniqueChannelIds = [...new Set(tasks.map((t: any) => t.channelId).filter(Boolean))];
        const channelRatios: Record<number, number> = {};
        if (uniqueChannelIds.length > 0) {
            const channels = await sql`SELECT id, price_ratio FROM channels WHERE id IN ${sql(uniqueChannelIds)}`;
            for (const ch of channels) {
                channelRatios[ch.id] = Number(ch.price_ratio) || 1.0;
            }
        }

        await sql.begin(async (tx: any) => {
            const correctedUserAgg: Record<number, number> = {};
            const correctedTokenAgg: Record<number, number> = {};
            const correctedOrgAgg: Record<number, number> = {};

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
                if (task.orgId) {
                    correctedOrgAgg[task.orgId] = (correctedOrgAgg[task.orgId] || 0) + finalCost;
                }

                const log = logInserts.find(l =>
                    l.userId === task.userId &&
                    l.tokenId === task.tokenId &&
                    l.channelId === task.channelId &&
                    l.modelName === task.modelName &&
                    l.promptTokens === task.promptTokens &&
                    l.completionTokens === task.completionTokens &&
                    l.isStream === task.isStream
                );
                if (log) log.quotaCost = finalCost;
            }

            for (const [id, cost] of Object.entries(correctedTokenAgg)) {
                await tx`UPDATE tokens SET used_quota = used_quota + ${cost} WHERE id = ${Number(id)}`;
            }
            for (const [id, cost] of Object.entries(correctedUserAgg)) {
                await tx`UPDATE users SET used_quota = used_quota + ${cost} WHERE id = ${Number(id)}`;
            }
            for (const [id, cost] of Object.entries(correctedOrgAgg)) {
                await tx`UPDATE organizations SET used_quota = used_quota + ${cost} WHERE id = ${Number(id)}`;
            }
            for (const log of logInserts) {
                const [inserted] = await tx`
                    INSERT INTO logs (user_id, token_id, channel_id, model_name, prompt_tokens, completion_tokens, cached_tokens, quota_cost, is_stream, status_code, error_message, elapsed_ms, ip_address, user_agent, trace_id, org_id, external_task_id, external_user_id, external_workspace_id, external_feature_type)
                    VALUES (${log.userId}, ${log.tokenId ?? null}, ${log.channelId !== undefined ? log.channelId : null}, ${log.modelName}, ${log.promptTokens}, ${log.completionTokens}, ${log.cachedTokens}, ${log.quotaCost}, ${log.isStream}, ${log.statusCode}, ${log.errorMessage}, ${log.elapsedMs}, ${log.ip}, ${log.ua}, ${log.traceId}, ${log.orgId}, ${log.externalTaskId}, ${log.externalUserId}, ${log.externalWorkspaceId}, ${log.externalFeatureType})
                    RETURNING id, created_at
                `;

                if (inserted && (log.requestBody || log.responseBody)) {
                    await tx`
                        INSERT INTO log_details (log_id, log_created_at, request_body, response_body)
                        VALUES (${inserted.id}, ${inserted.created_at}, ${log.requestBody}, ${log.responseBody})
                        ON CONFLICT (log_id) DO UPDATE
                        SET log_created_at = EXCLUDED.log_created_at,
                            request_body = EXCLUDED.request_body,
                            response_body = EXCLUDED.response_body
                    `;
                }
            }
        });

        // 5. Organization-level Quota Alerts
        const uniqueOrgIds = [...new Set(tasks.map((t: any) => t.orgId).filter(Boolean))];
        if (uniqueOrgIds.length > 0) {
            const orgs = await sql`
                SELECT id, name, quota, used_quota, alert_webhook_url, alert_threshold_pct, last_alert_at
                FROM organizations
                WHERE id IN ${sql(uniqueOrgIds)}
            `;

            for (const org of orgs) {
                if (!org.alert_webhook_url) continue;

                const threshold = org.alert_threshold_pct || 80;
                const usagePct = (Number(org.used_quota) / Math.max(Number(org.quota), 1)) * 100;

                if (usagePct >= threshold) {
                    const lastAlert = org.last_alert_at ? new Date(org.last_alert_at).getTime() : 0;
                    const oneDay = 24 * 60 * 60 * 1000;

                    if (Date.now() - lastAlert > oneDay) {
                        try {
                            console.log(`[Billing/Alert] Sending quota alert for organization: ${org.name}`);
                            await fetch(org.alert_webhook_url, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    event: 'org.quota_alert',
                                    orgId: org.id,
                                    orgName: org.name,
                                    usagePct: usagePct.toFixed(1),
                                    thresholdPct: threshold,
                                    timestamp: new Date().toISOString()
                                })
                            });

                            await sql`
                                UPDATE organizations 
                                SET last_alert_at = NOW() 
                                WHERE id = ${org.id}
                            `;
                        } catch (err: any) {
                            console.error(`[Billing/Error] Failed to send webhook alert for org ${org.id}:`, err.message);
                        }
                    }
                }
            }
        }

        console.log(`[Billing/Flush] Merged & Ingested ${tasks.length} logs successfully.`);
    } catch (e: any) {
        console.error(`[Billing/Error] Failed to flush queue (attempt ${retryCount + 1}/${MAX_RETRY_COUNT}). Error:`, e.message);
        
        if (retryCount < MAX_RETRY_COUNT - 1) {
            billingQueue.unshift(...tasks);
            isFlushing = false;
            setTimeout(() => flushBillingQueue(retryCount + 1), 100 * (retryCount + 1));
            return;
        } else {
            console.error(`[Billing/Error] Max retries reached, dropping ${tasks.length} tasks`);
            billingQueue.push(...tasks);
        }
    } finally {
        isFlushing = false;
    }
}

setInterval(flushBillingQueue, FLUSH_INTERVAL_MS);

async function rotateLogs() {
    const { optionCache } = await import('./optionCache');
    const days = optionCache.get('LogRetentionDays', 7);
    console.log(`[Billing/Rotation] Cleaning up logs older than ${days} days...`);
    try {
        await sql`DELETE FROM logs WHERE created_at < NOW() - (${days} * INTERVAL '1 day')`;
        await sql`DELETE FROM health_logs WHERE created_at < NOW() - (${days} * INTERVAL '1 day')`;
    } catch (e) {
        console.error('[Billing/Rotation] Failed:', e);
    }
}

setInterval(rotateLogs, 24 * 60 * 60 * 1000);
