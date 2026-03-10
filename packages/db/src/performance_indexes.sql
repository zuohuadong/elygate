-- Elygate Performance Optimization Indexes
-- Run this script to add missing indexes for better query performance
-- Compatible with PostgreSQL 18.3

-- ============================================================
-- Log Table Indexes
-- ============================================================

-- Optimize log queries for active users (most common query pattern)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_logs_user_created 
ON logs (user_id, created_at DESC) 
WHERE status_code = 200;

-- Optimize log queries by model and time
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_logs_model_created 
ON logs (model_name, created_at DESC);

-- Optimize log queries by channel for monitoring
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_logs_channel_created 
ON logs (channel_id, created_at DESC) 
WHERE channel_id IS NOT NULL;

-- Optimize log queries by status code for error tracking
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_logs_status_created 
ON logs (status_code, created_at DESC) 
WHERE status_code >= 400;

-- ============================================================
-- Channel Table Indexes
-- ============================================================

-- Optimize channel status queries (hot path in cache refresh)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_channels_status_type 
ON channels (status, type) 
WHERE status = 1;

-- Optimize channel group queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_channels_groups 
ON channels USING gin (groups) 
WHERE groups IS NOT NULL;

-- Optimize channel model queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_channels_models 
ON channels USING gin (models) 
WHERE status = 1;

-- ============================================================
-- User Table Indexes
-- ============================================================

-- Optimize quota check queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_quota_status 
ON users (quota, status) 
WHERE status = 1;

-- Optimize user group queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_group_status 
ON users ("group", status) 
WHERE status = 1;

-- Optimize user email queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_email 
ON users (email) 
WHERE email IS NOT NULL;

-- ============================================================
-- Token Table Indexes
-- ============================================================

-- Optimize token status queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tokens_user_status 
ON tokens (user_id, status) 
WHERE status = 1;

-- Optimize token expiration queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tokens_expired 
ON tokens (expired_at) 
WHERE expired_at IS NOT NULL;

-- ============================================================
-- Semantic Cache Indexes
-- ============================================================

-- Optimize semantic cache queries by model and time
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_semantic_cache_model_created 
ON semantic_cache (model_name, created_at DESC);

-- Optimize semantic cache cleanup
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_semantic_cache_created 
ON semantic_cache (created_at DESC);

-- ============================================================
-- Payment and Billing Indexes
-- ============================================================

-- Optimize payment order queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payment_orders_user_status 
ON payment_orders (user_id, status, created_at DESC);

-- Optimize payment order transaction lookup
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payment_orders_transaction 
ON payment_orders (transaction_id) 
WHERE transaction_id IS NOT NULL;

-- ============================================================
-- Statistics Indexes
-- ============================================================

-- Optimize daily stats queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_daily_stats_user_date 
ON daily_stats (user_id, stat_date DESC);

-- Optimize model stats queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_model_stats_model_user 
ON model_stats (model_name, user_id);

-- ============================================================
-- Session and Auth Indexes
-- ============================================================

-- Optimize session expiration cleanup
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_session_expires 
ON session (expires_at) 
WHERE expires_at < NOW();

-- Optimize account provider queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_account_provider 
ON account (provider_id, account_id);

-- ============================================================
-- Redemption Indexes
-- ============================================================

-- Optimize redemption key lookup
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_redemptions_key_status 
ON redemptions (key, status) 
WHERE status = 1;

-- ============================================================
-- Partial Indexes for Common Queries
-- ============================================================

-- Optimize active token count queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tokens_active_count 
ON tokens (user_id) 
WHERE status = 1;

-- Optimize active channel count queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_channels_active_count 
ON channels (type) 
WHERE status = 1;

-- ============================================================
-- Analyze tables after index creation
-- ============================================================

ANALYZE logs;
ANALYZE channels;
ANALYZE users;
ANALYZE tokens;
ANALYZE semantic_cache;
ANALYZE payment_orders;
ANALYZE daily_stats;
ANALYZE model_stats;
ANALYZE session;
ANALYZE account;
ANALYZE redemptions;

-- ============================================================
-- Index Usage Monitoring Query
-- ============================================================

-- Run this query to check index usage:
-- SELECT 
--     schemaname,
--     tablename,
--     indexname,
--     idx_scan as index_scans,
--     idx_tup_read as tuples_read,
--     idx_tup_fetch as tuples_fetched
-- FROM pg_stat_user_indexes
-- ORDER BY idx_scan DESC;

-- ============================================================
-- Unused Index Detection Query
-- ============================================================

-- Run this query to find unused indexes:
-- SELECT 
--     schemaname || '.' || relname AS table,
--     indexrelname AS index,
--     pg_size_pretty(pg_relation_size(i.indexrelid)) AS index_size,
--     idx_scan as index_scans
-- FROM pg_stat_user_indexes ui
-- JOIN pg_index i ON ui.indexrelid = i.indexrelid
-- WHERE NOT i.indisunique 
--   AND idx_scan < 50 
--   AND pg_relation_size(i.indexrelid) > 1024 * 1024
-- ORDER BY pg_relation_size(i.indexrelid) DESC;
