import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { getErrorMessage } from '../src/utils/error';
import { sql } from '@elygate/db';

describe('Database Enhancement Tests', () => {
    test('should have payment_orders table', async () => {
        const [result] = await sql`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_schema = 'public' 
                AND table_name = 'payment_orders'
            ) as exists
        `;
        
        expect(result.exists).toBe(true);
    });

    test('should have oauth_accounts table', async () => {
        const [result] = await sql`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_schema = 'public' 
                AND table_name = 'oauth_accounts'
            ) as exists
        `;
        
        expect(result.exists).toBe(true);
    });

    test('should have daily_stats table', async () => {
        const [result] = await sql`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_schema = 'public' 
                AND table_name = 'daily_stats'
            ) as exists
        `;
        
        expect(result.exists).toBe(true);
    });

    test('should have model_stats table', async () => {
        const [result] = await sql`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_schema = 'public' 
                AND table_name = 'model_stats'
            ) as exists
        `;
        
        expect(result.exists).toBe(true);
    });

    test('should have system_settings table', async () => {
        const [result] = await sql`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_schema = 'public' 
                AND table_name = 'system_settings'
            ) as exists
        `;
        
        expect(result.exists).toBe(true);
    });

    test('should have mv_user_daily_stats materialized view', async () => {
        const [result] = await sql`
            SELECT EXISTS (
                SELECT FROM pg_matviews 
                WHERE matviewname = 'mv_user_daily_stats'
            ) as exists
        `;
        
        expect(result.exists).toBe(true);
    });

    test('should have mv_model_usage_stats materialized view', async () => {
        const [result] = await sql`
            SELECT EXISTS (
                SELECT FROM pg_matviews 
                WHERE matviewname = 'mv_model_usage_stats'
            ) as exists
        `;
        
        expect(result.exists).toBe(true);
    });

    test('should have mv_system_overview materialized view', async () => {
        const [result] = await sql`
            SELECT EXISTS (
                SELECT FROM pg_matviews 
                WHERE matviewname = 'mv_system_overview'
            ) as exists
        `;
        
        expect(result.exists).toBe(true);
    });

    test('should have refresh_materialized_views function', async () => {
        const [result] = await sql`
            SELECT EXISTS (
                SELECT FROM pg_proc 
                WHERE proname = 'refresh_materialized_views'
            ) as exists
        `;
        
        expect(result.exists).toBe(true);
    });

    test('should have payment_orders indexes', async () => {
        const indexes = await sql`
            SELECT indexname 
            FROM pg_indexes 
            WHERE tablename = 'payment_orders'
        `;
        
        expect(indexes.length).toBeGreaterThan(0);
        expect(indexes.some((idx: any) => idx.indexname.includes('user'))).toBe(true);
        expect(indexes.some((idx: any) => idx.indexname.includes('status'))).toBe(true);
    });

    test('should have oauth_accounts indexes', async () => {
        const indexes = await sql`
            SELECT indexname 
            FROM pg_indexes 
            WHERE tablename = 'oauth_accounts'
        `;
        
        expect(indexes.length).toBeGreaterThan(0);
        expect(indexes.some((idx: any) => idx.indexname.includes('user'))).toBe(true);
        expect(indexes.some((idx: any) => idx.indexname.includes('provider'))).toBe(true);
    });

    test('should have daily_stats indexes', async () => {
        const indexes = await sql`
            SELECT indexname 
            FROM pg_indexes 
            WHERE tablename = 'daily_stats'
        `;
        
        expect(indexes.length).toBeGreaterThan(0);
        expect(indexes.some((idx: any) => idx.indexname.includes('user_date'))).toBe(true);
    });

    test('should have model_stats indexes', async () => {
        const indexes = await sql`
            SELECT indexname 
            FROM pg_indexes 
            WHERE tablename = 'model_stats'
        `;
        
        expect(indexes.length).toBeGreaterThan(0);
        expect(indexes.some((idx: any) => idx.indexname.includes('user'))).toBe(true);
        expect(indexes.some((idx: any) => idx.indexname.includes('model'))).toBe(true);
    });

    test('should have default system settings', async () => {
        const settings = await sql`
            SELECT key, value, category 
            FROM system_settings 
            ORDER BY category, key
        `;
        
        expect(settings.length).toBeGreaterThan(0);
        expect(settings.some((s: any) => s.key === 'PaymentEnabled')).toBe(true);
        expect(settings.some((s: any) => s.key === 'DiscordClientId')).toBe(true);
        expect(settings.some((s: any) => s.key === 'TelegramBotToken')).toBe(true);
    });

    test('should have pg_cron jobs', async () => {
        const jobs = await sql`
            SELECT jobname, schedule 
            FROM cron.job 
            ORDER BY jobname
        `;
        
        expect(jobs.length).toBeGreaterThan(0);
        expect(jobs.some((job: any) => job.jobname.includes('stats'))).toBe(true);
        expect(jobs.some((job: any) => job.jobname.includes('oauth'))).toBe(true);
    });

    test('should refresh materialized views', async () => {
        await sql`SELECT refresh_materialized_views()`;
        
        const [overview] = await sql`
            SELECT * FROM mv_system_overview LIMIT 1
        `;
        
        expect(overview).toBeDefined();
        expect(typeof overview.total_users).toBe('number');
        expect(typeof overview.active_tokens).toBe('number');
        expect(typeof overview.active_channels).toBe('number');
    });

    test('should query user daily stats view', async () => {
        const stats = await sql`
            SELECT * FROM mv_user_daily_stats LIMIT 10
        `;
        
        expect(Array.isArray(stats)).toBe(true);
    });

    test('should query model usage stats view', async () => {
        const stats = await sql`
            SELECT * FROM mv_model_usage_stats LIMIT 10
        `;
        
        expect(Array.isArray(stats)).toBe(true);
    });

    test('should have payment_orders columns', async () => {
        const columns = await sql`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'payment_orders'
            ORDER BY ordinal_position
        `;
        
        expect(columns.some((col: any) => col.column_name === 'user_id')).toBe(true);
        expect(columns.some((col: any) => col.column_name === 'amount')).toBe(true);
        expect(columns.some((col: any) => col.column_name === 'payment_method')).toBe(true);
        expect(columns.some((col: any) => col.column_name === 'transaction_id')).toBe(true);
        expect(columns.some((col: any) => col.column_name === 'status')).toBe(true);
    });

    test('should have oauth_accounts columns', async () => {
        const columns = await sql`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'oauth_accounts'
            ORDER BY ordinal_position
        `;
        
        expect(columns.some((col: any) => col.column_name === 'user_id')).toBe(true);
        expect(columns.some((col: any) => col.column_name === 'provider')).toBe(true);
        expect(columns.some((col: any) => col.column_name === 'provider_user_id')).toBe(true);
        expect(columns.some((col: any) => col.column_name === 'access_token')).toBe(true);
        expect(columns.some((col: any) => col.column_name === 'refresh_token')).toBe(true);
        expect(columns.some((col: any) => col.column_name === 'expires_at')).toBe(true);
    });

    test('should have daily_stats columns', async () => {
        const columns = await sql`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'daily_stats'
            ORDER BY ordinal_position
        `;
        
        expect(columns.some((col: any) => col.column_name === 'user_id')).toBe(true);
        expect(columns.some((col: any) => col.column_name === 'stat_date')).toBe(true);
        expect(columns.some((col: any) => col.column_name === 'request_count')).toBe(true);
        expect(columns.some((col: any) => col.column_name === 'total_tokens')).toBe(true);
        expect(columns.some((col: any) => col.column_name === 'total_cost')).toBe(true);
        expect(columns.some((col: any) => col.column_name === 'success_count')).toBe(true);
        expect(columns.some((col: any) => col.column_name === 'error_count')).toBe(true);
    });

    test('should have model_stats columns', async () => {
        const columns = await sql`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'model_stats'
            ORDER BY ordinal_position
        `;
        
        expect(columns.some((col: any) => col.column_name === 'model_name')).toBe(true);
        expect(columns.some((col: any) => col.column_name === 'user_id')).toBe(true);
        expect(columns.some((col: any) => col.column_name === 'request_count')).toBe(true);
        expect(columns.some((col: any) => col.column_name === 'total_tokens')).toBe(true);
        expect(columns.some((col: any) => col.column_name === 'total_cost')).toBe(true);
        expect(columns.some((col: any) => col.column_name === 'avg_tokens_per_request')).toBe(true);
        expect(columns.some((col: any) => col.column_name === 'last_used_at')).toBe(true);
    });

    test('should enforce unique constraint on oauth_accounts', async () => {
        const [user] = await sql`
            INSERT INTO users (username, password_hash, role, quota, status)
            VALUES ('test_oauth_constraint', 'test', 1, 100000, 1)
            RETURNING id
        `;
        
        await sql`
            INSERT INTO oauth_accounts (user_id, provider, provider_user_id)
            VALUES (${user.id}, 'test_provider', 'test_user_id')
        `;
        
        try {
            await sql`
                INSERT INTO oauth_accounts (user_id, provider, provider_user_id)
                VALUES (${user.id}, 'test_provider', 'test_user_id_2')
            `;
            expect(true).toBe(false);
        } catch (error: unknown) {
            expect(getErrorMessage(error)).toContain('unique');
        }
        
        await sql`DELETE FROM oauth_accounts WHERE user_id = ${user.id}`;
        await sql`DELETE FROM users WHERE id = ${user.id}`;
    });

    test('should enforce unique constraint on daily_stats', async () => {
        const [user] = await sql`
            INSERT INTO users (username, password_hash, role, quota, status)
            VALUES ('test_daily_stats_constraint', 'test', 1, 100000, 1)
            RETURNING id
        `;
        
        await sql`
            INSERT INTO daily_stats (user_id, stat_date, request_count)
            VALUES (${user.id}, CURRENT_DATE, 100)
        `;
        
        try {
            await sql`
                INSERT INTO daily_stats (user_id, stat_date, request_count)
                VALUES (${user.id}, CURRENT_DATE, 200)
            `;
            expect(true).toBe(false);
        } catch (error: unknown) {
            expect(getErrorMessage(error)).toContain('unique');
        }
        
        await sql`DELETE FROM daily_stats WHERE user_id = ${user.id}`;
        await sql`DELETE FROM users WHERE id = ${user.id}`;
    });

    test('should enforce unique constraint on model_stats', async () => {
        const [user] = await sql`
            INSERT INTO users (username, password_hash, role, quota, status)
            VALUES ('test_model_stats_constraint', 'test', 1, 100000, 1)
            RETURNING id
        `;
        
        await sql`
            INSERT INTO model_stats (model_name, user_id, request_count)
            VALUES ('test-model', ${user.id}, 50)
        `;
        
        try {
            await sql`
                INSERT INTO model_stats (model_name, user_id, request_count)
                VALUES ('test-model', ${user.id}, 100)
            `;
            expect(true).toBe(false);
        } catch (error: unknown) {
            expect(getErrorMessage(error)).toContain('unique');
        }
        
        await sql`DELETE FROM model_stats WHERE user_id = ${user.id}`;
        await sql`DELETE FROM users WHERE id = ${user.id}`;
    });
});
