import type { ElysiaCtx } from '../../types';
import { Elysia } from 'elysia';
import { sql } from '@elygate/db';
import { memoryCache } from '../../services/cache';
import { getAffinityStats, clearAffinityCache } from '../../services/channelAffinity';
import { circuitBreaker } from '../../services/circuitBreaker';
import { getQueueStats } from '../../services/billing';
import { optionCache } from '../../services/optionCache';

/**
 * Performance monitoring and admin operations.
 */
export const performanceRouter = new Elysia()
    // --- System performance stats ---
    .get('/performance/stats', async () => {
        const cacheStats = memoryCache.getStats();
        const cbStats = circuitBreaker.getStats();
        const affinityStats = getAffinityStats();

        const [dbSize] = await sql`
            SELECT
                pg_database_size(current_database()) as db_bytes,
                (SELECT COUNT(*) FROM logs) as total_logs,
                (SELECT COUNT(*) FROM channels) as total_channels,
                (SELECT COUNT(*) FROM tokens WHERE status = 1) as active_tokens,
                (SELECT COUNT(*) FROM users) as total_users
        `;

        return {
            success: true,
            data: {
                cache: cacheStats,
                circuitBreaker: cbStats,
                affinity: affinityStats,
                billingQueue: getQueueStats(),
                database: {
                    sizeBytes: Number(dbSize?.db_bytes || 0),
                    totalLogs: Number(dbSize?.total_logs || 0),
                    totalChannels: Number(dbSize?.total_channels || 0),
                    activeTokens: Number(dbSize?.active_tokens || 0),
                    totalUsers: Number(dbSize?.total_users || 0),
                },
                uptime: process.uptime(),
                memory: process.memoryUsage(),
            }
        };
    })

    // --- Force GC ---
    .post('/performance/gc', async () => {
        if (typeof globalThis.gc === 'function') {
            globalThis.gc();
        }
        return { success: true, message: 'GC triggered (if exposed)', memory: process.memoryUsage() };
    })

    // --- Clear caches ---
    .delete('/performance/caches', async () => {
        // Clear response cache
        await sql`DELETE FROM response_cache`;
        // Clear semantic cache
        await sql`DELETE FROM semantic_cache`;
        // Clear token cache
        await sql`DELETE FROM token_cache`;
        // Clear user quota cache
        await sql`DELETE FROM user_quota_cache`;
        // Clear affinity
        const affinityCleared = clearAffinityCache();
        // Refresh memory
        await memoryCache.refresh();

        return {
            success: true,
            message: 'All caches cleared',
            affinityCleared,
            memoryAfter: process.memoryUsage(),
        };
    })

    // --- Reset stats counters ---
    .post('/performance/reset-stats', () => {
        memoryCache.resetStats();
        return { success: true, message: 'Stats reset' };
    })

    // --- Ratio config (for pricing page) ---
    .get('/ratio-config', async () => {
        const modelRatio = optionCache.get('ModelRatio', {}) as Record<string, number>;
        const completionRatio = optionCache.get('CompletionRatio', {}) as Record<string, number>;
        const groupRatio = optionCache.get('GroupRatio', {}) as Record<string, number>;
        const groupModelRatio = optionCache.get('GroupModelRatio', {}) as Record<string, Record<string, number>>;
        const fixedCostModels = optionCache.get('FixedCostModels', {}) as Record<string, number>;

        return {
            success: true,
            data: { modelRatio, completionRatio, groupRatio, groupModelRatio, fixedCostModels }
        };
    })

    // --- Update ratio config ---
    .put('/ratio-config', async ({ body, set }: ElysiaCtx) => {
        const b = body as Record<string, any>;
        const updates: Record<string, any> = {};
        if (b.modelRatio !== undefined) updates.ModelRatio = b.modelRatio;
        if (b.completionRatio !== undefined) updates.CompletionRatio = b.completionRatio;
        if (b.groupRatio !== undefined) updates.GroupRatio = b.groupRatio;
        if (b.groupModelRatio !== undefined) updates.GroupModelRatio = b.groupModelRatio;
        if (b.fixedCostModels !== undefined) updates.FixedCostModels = b.fixedCostModels;

        for (const [key, value] of Object.entries(updates)) {
            await sql`
                INSERT INTO options (key, value) VALUES (${key}, ${JSON.stringify(value)})
                ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
            `;
        }
        await memoryCache.refresh();
        await optionCache.refresh();
        return { success: true };
    })

    // --- Missing models from pricing ---
    .get('/ratio-config/missing', async () => {
        const modelRatio = optionCache.get('ModelRatio', {}) as Record<string, number>;
        // Get all models that are active but not in ratio config
        const rows = await sql`
            SELECT DISTINCT model_name FROM logs
            WHERE created_at > NOW() - INTERVAL '7 days'
            ORDER BY model_name
        `;
        const missing = rows
            .map((r: Record<string, any>) => r.model_name)
            .filter((m: string) => !modelRatio[m]);
        return { success: true, data: missing, count: missing.length };
    });
