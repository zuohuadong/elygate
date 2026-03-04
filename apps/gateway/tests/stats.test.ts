import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { sql } from '@elygate/db';

describe('Statistics System Tests', () => {
    let testUserId: number;
    let testTokenId: number;

    beforeAll(async () => {
        const [user] = await sql`
            INSERT INTO users (username, password_hash, role, quota, status)
            VALUES ('test_stats_user', 'test_hash', 1, 100000, 1)
            RETURNING id
        `;
        testUserId = user.id;

        const [token] = await sql`
            INSERT INTO tokens (user_id, name, key, status, remain_quota)
            VALUES (${testUserId}, 'Test Token', 'sk-test-stats-key', 1, -1)
            RETURNING id
        `;
        testTokenId = token.id;

        await sql`
            INSERT INTO daily_stats (user_id, stat_date, request_count, total_tokens, total_cost, success_count, error_count)
            VALUES 
                (${testUserId}, CURRENT_DATE - 2, 100, 5000, 1000, 95, 5),
                (${testUserId}, CURRENT_DATE - 1, 150, 7500, 1500, 145, 5),
                (${testUserId}, CURRENT_DATE, 200, 10000, 2000, 195, 5)
        `;

        await sql`
            INSERT INTO model_stats (model_name, user_id, request_count, total_tokens, total_cost, avg_tokens_per_request, last_used_at)
            VALUES 
                ('gpt-3.5-turbo', ${testUserId}, 300, 15000, 3000, 50, NOW()),
                ('gpt-4', ${testUserId}, 150, 7500, 1500, 50, NOW() - INTERVAL '1 hour')
        `;
    });

    afterAll(async () => {
        await sql`DELETE FROM daily_stats WHERE user_id = ${testUserId}`;
        await sql`DELETE FROM model_stats WHERE user_id = ${testUserId}`;
        await sql`DELETE FROM tokens WHERE id = ${testTokenId}`;
        await sql`DELETE FROM users WHERE id = ${testUserId}`;
    });

    test('should query daily stats', async () => {
        const stats = await sql`
            SELECT * FROM daily_stats
            WHERE user_id = ${testUserId}
            ORDER BY stat_date DESC
        `;
        
        expect(stats.length).toBe(3);
        expect(stats[0].request_count).toBe(200);
        expect(stats[1].request_count).toBe(150);
    });

    test('should calculate success rate', async () => {
        const [stats] = await sql`
            SELECT 
                request_count,
                success_count,
                ROUND((success_count::NUMERIC / request_count) * 100, 2) as success_rate
            FROM daily_stats
            WHERE user_id = ${testUserId} AND stat_date = CURRENT_DATE
        `;
        
        expect(stats.request_count).toBe(200);
        expect(stats.success_count).toBe(195);
        expect(parseFloat(stats.success_rate)).toBeCloseTo(97.5, 1);
    });

    test('should query model stats', async () => {
        const models = await sql`
            SELECT * FROM model_stats
            WHERE user_id = ${testUserId}
            ORDER BY request_count DESC
        `;
        
        expect(models.length).toBe(2);
        expect(models[0].model_name).toBe('gpt-3.5-turbo');
        expect(models[0].request_count).toBe(300);
    });

    test('should aggregate user summary', async () => {
        const [summary] = await sql`
            SELECT 
                SUM(request_count) as total_requests,
                SUM(total_tokens) as total_tokens,
                SUM(total_cost) as total_cost,
                AVG(success_count::NUMERIC / request_count * 100) as avg_success_rate
            FROM daily_stats
            WHERE user_id = ${testUserId}
        `;
        
        expect(parseInt(summary.total_requests)).toBe(450);
        expect(parseInt(summary.total_tokens)).toBe(22500);
        expect(parseInt(summary.total_cost)).toBe(4500);
    });

    test('should refresh materialized views', async () => {
        await sql`SELECT refresh_materialized_views()`;
        
        const [overview] = await sql`
            SELECT * FROM mv_system_overview LIMIT 1
        `;
        
        expect(overview).toBeDefined();
        expect(overview.total_users).toBeGreaterThanOrEqual(0);
    });

    test('should query heatmap data', async () => {
        const heatmap = await sql`
            SELECT 
                EXTRACT(HOUR FROM created_at) as hour,
                EXTRACT(DOW FROM created_at) as day_of_week,
                COUNT(*) as request_count
            FROM logs
            WHERE created_at >= NOW() - INTERVAL '30 days'
            GROUP BY EXTRACT(HOUR FROM created_at), EXTRACT(DOW FROM created_at)
            ORDER BY day_of_week, hour
        `;
        
        expect(Array.isArray(heatmap)).toBe(true);
    });

    test('should calculate error statistics', async () => {
        const errors = await sql`
            SELECT 
                model_name,
                COUNT(*) as error_count
            FROM logs
            WHERE created_at >= NOW() - INTERVAL '24 hours'
            AND quota_cost = 0
            GROUP BY model_name
            ORDER BY error_count DESC
            LIMIT 10
        `;
        
        expect(Array.isArray(errors)).toBe(true);
    });

    test('should get realtime stats', async () => {
        const [realtime] = await sql`
            SELECT 
                COUNT(*) as requests_per_minute,
                COUNT(DISTINCT user_id) as active_users,
                COUNT(DISTINCT model_name) as active_models
            FROM logs
            WHERE created_at >= NOW() - INTERVAL '1 minute'
        `;
        
        expect(realtime).toBeDefined();
        expect(parseInt(realtime.requests_per_minute)).toBeGreaterThanOrEqual(0);
    });
});
