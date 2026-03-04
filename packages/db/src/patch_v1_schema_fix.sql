-- Elygate V1 Schema Fix Patch
-- This script fixes missing columns, tables, and materialized views required for dashboard and stats.

-- 1. Logs Table Enhancements
ALTER TABLE logs ADD COLUMN IF NOT EXISTS error_message TEXT;
ALTER TABLE logs ADD COLUMN IF NOT EXISTS status_code INTEGER NOT NULL DEFAULT 200;
ALTER TABLE logs ADD COLUMN IF NOT EXISTS ip TEXT;

-- 1.1 Tokens Table Security Enhancements
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS subnet TEXT;
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS rate_limit INTEGER NOT NULL DEFAULT 0;

-- 2. Create Missing Tables
CREATE TABLE IF NOT EXISTS payment_orders (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount BIGINT NOT NULL,
    payment_method TEXT NOT NULL,
    transaction_id TEXT UNIQUE,
    status INTEGER NOT NULL DEFAULT 1, -- 1=pending, 2=success, 3=failed
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS oauth_accounts (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    provider_user_id TEXT NOT NULL,
    access_token TEXT,
    refresh_token TEXT,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (user_id, provider),
    UNIQUE (provider, provider_user_id)
);

CREATE TABLE IF NOT EXISTS daily_stats (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    stat_date DATE NOT NULL,
    request_count INTEGER NOT NULL DEFAULT 0,
    total_tokens BIGINT NOT NULL DEFAULT 0,
    total_cost BIGINT NOT NULL DEFAULT 0,
    success_count INTEGER NOT NULL DEFAULT 0,
    error_count INTEGER NOT NULL DEFAULT 0,
    UNIQUE (user_id, stat_date)
);

CREATE TABLE IF NOT EXISTS model_stats (
    id SERIAL PRIMARY KEY,
    model_name TEXT NOT NULL,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    request_count INTEGER NOT NULL DEFAULT 0,
    total_tokens BIGINT NOT NULL DEFAULT 0,
    total_cost BIGINT NOT NULL DEFAULT 0,
    avg_tokens_per_request INTEGER NOT NULL DEFAULT 0,
    last_used_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (model_name, user_id)
);

CREATE TABLE IF NOT EXISTS system_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'general',
    description TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Materialized Views
-- System Overview
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_system_overview AS
SELECT 
    (SELECT COUNT(*) FROM users) as total_users,
    (SELECT COUNT(*) FROM tokens WHERE status = 1) as active_tokens,
    (SELECT COUNT(*) FROM channels WHERE status = 1) as active_channels,
    (SELECT SUM(quota_cost) FROM logs) as lifetime_usage;

-- Model Usage Stats
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_model_usage_stats AS
SELECT 
    model_name,
    COUNT(*) as total_requests,
    SUM(quota_cost) as total_cost,
    SUM(prompt_tokens + completion_tokens) as total_tokens,
    MAX(created_at) as last_used_at
FROM logs
GROUP BY model_name;

-- User Daily Stats
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_user_daily_stats AS
SELECT 
    user_id,
    DATE(created_at) as stat_date,
    COUNT(*) as request_count,
    SUM(quota_cost) as total_cost
FROM logs
GROUP BY user_id, DATE(created_at);

-- 4. Refresh Function
CREATE OR REPLACE FUNCTION refresh_materialized_views()
RETURNS void AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_system_overview;
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_model_usage_stats;
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_user_daily_stats;
END;
$$ LANGUAGE plpgsql;

-- To use CONCURRENTLY, we need unique indexes on the views
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_system_overview_dummy ON mv_system_overview (total_users, active_tokens, active_channels);
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_model_usage_stats_model ON mv_model_usage_stats (model_name);
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_user_daily_stats_user_date ON mv_user_daily_stats (user_id, stat_date);

-- Insert some default system settings
INSERT INTO system_settings (key, value, category) VALUES
    ('PaymentEnabled', 'false', 'billing'),
    ('DiscordClientId', '', 'oauth'),
    ('TelegramBotToken', '', 'bot')
ON CONFLICT (key) DO NOTHING;
