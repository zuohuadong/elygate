-- Elygate Database Initialization Script
-- Run this on first setup to create all required tables.

-- Enable extensions (requires superuser / Supabase equivalent permissions)
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ============================================================
-- Core Tables
-- ============================================================

CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    email TEXT,
    email_verified BOOLEAN DEFAULT FALSE,
    name TEXT,
    password_hash TEXT NOT NULL DEFAULT '',
    image TEXT,
    role INTEGER NOT NULL DEFAULT 1,        -- 1=user, 10=admin
    quota BIGINT NOT NULL DEFAULT 0,        -- available quota (0.001 cent units)
    used_quota BIGINT NOT NULL DEFAULT 0,
    "group" TEXT NOT NULL DEFAULT 'default',
    status INTEGER NOT NULL DEFAULT 1,      -- 1=active, 2=banned
    github_id TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Web Auth Sessions
-- ============================================================

CREATE TABLE IF NOT EXISTS session (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    ip_address TEXT,
    user_agent TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_session_token ON session(token);
CREATE INDEX IF NOT EXISTS idx_session_user_id ON session(user_id);

CREATE TABLE IF NOT EXISTS tokens (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    key TEXT NOT NULL UNIQUE,               -- sk-xxxx
    status INTEGER NOT NULL DEFAULT 1,      -- 1=active, 2=disabled
    remain_quota BIGINT NOT NULL DEFAULT -1, -- -1 = unlimited
    used_quota BIGINT NOT NULL DEFAULT 0,
    models JSONB,                           -- allowed models (null = all)
    subnet TEXT,                            -- IP whitelist
    rate_limit INTEGER NOT NULL DEFAULT 0,  -- RPM limit
    expired_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNLOGGED TABLE IF NOT EXISTS rate_limits (
    key VARCHAR(255) PRIMARY KEY,
    count INTEGER DEFAULT 1,
    expired_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_expired_at ON rate_limits(expired_at);

CREATE TABLE IF NOT EXISTS channels (
    id SERIAL PRIMARY KEY,
    type INTEGER NOT NULL DEFAULT 1,        -- 1=OpenAI, 8=Azure, 14=Anthropic, 23=Gemini
    name TEXT NOT NULL,
    base_url TEXT NOT NULL DEFAULT 'https://api.openai.com',
    key TEXT NOT NULL,                      -- API key(s), \n-separated for multi-key
    models JSONB NOT NULL DEFAULT '[]',
    model_mapping JSONB NOT NULL DEFAULT '{}',
    weight INTEGER NOT NULL DEFAULT 1,
    priority INTEGER NOT NULL DEFAULT 0,
    groups JSONB,                           -- allowed user groups (null = all)
    status INTEGER NOT NULL DEFAULT 1,      -- 1=active, 2=disabled
    key_strategy INTEGER NOT NULL DEFAULT 0, -- 0=load_balance, 1=sequential
    key_status JSONB NOT NULL DEFAULT '{}'::jsonb, -- key exhaustion status
    key_concurrency_limit INTEGER NOT NULL DEFAULT 0, -- 0=unlimited
    price_ratio DECIMAL(10, 4) DEFAULT 1.0, -- price multiplier for dual currency support
    test_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Packages & Subscriptions
-- ============================================================

-- Rate Limit Rules (for packages and models)
CREATE TABLE IF NOT EXISTS rate_limit_rules (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    rpm INT DEFAULT 0, -- requests per minute (0 = unlimited)
    rph INT DEFAULT 0, -- requests per hour
    concurrent INT DEFAULT 0, -- concurrent requests
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Packages / Subscriptions templates
CREATE TABLE IF NOT EXISTS packages (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    price DECIMAL(10,2) NOT NULL,
    duration_days INT NOT NULL DEFAULT 30,
    models JSONB DEFAULT '[]',
    default_rate_limit_id INT REFERENCES rate_limit_rules(id) ON DELETE SET NULL,
    model_rate_limits JSONB DEFAULT '{}', -- {"gpt-4": 1}
    is_public BOOLEAN DEFAULT true,
    added_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- User active subscriptions
CREATE TABLE IF NOT EXISTS user_subscriptions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    package_id INTEGER NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
    start_time TIMESTAMPTZ DEFAULT NOW(),
    end_time TIMESTAMPTZ NOT NULL,
    status INTEGER DEFAULT 1, -- 1: active, 2: expired, 3: disabled
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_subscriptions_user_id ON user_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_end_time ON user_subscriptions(end_time);

-- Login attempts tracking table
CREATE TABLE IF NOT EXISTS login_attempts (
    id SERIAL PRIMARY KEY,
    username TEXT NOT NULL,
    ip_address TEXT,
    success BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add locked_until to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ;

-- Create indexes for login attempts
CREATE INDEX IF NOT EXISTS idx_login_attempts_username ON login_attempts(username, created_at);
CREATE INDEX IF NOT EXISTS idx_login_attempts_ip ON login_attempts(ip_address, created_at);

-- Budget alerts table
CREATE TABLE IF NOT EXISTS budget_alerts (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    username TEXT NOT NULL,
    quota BIGINT NOT NULL,
    used_quota BIGINT NOT NULL,
    usage_percent DECIMAL(5, 4) NOT NULL,
    alert_level TEXT NOT NULL CHECK (alert_level IN ('warning', 'critical', 'exhausted')),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for budget alerts
CREATE INDEX IF NOT EXISTS idx_budget_alerts_user_id ON budget_alerts(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_budget_alerts_level ON budget_alerts(alert_level, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_budget_alerts_unique ON budget_alerts(user_id, alert_level, DATE(created_at));

-- Audit logs table
CREATE TABLE IF NOT EXISTS audit_logs (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    username TEXT NOT NULL,
    action TEXT NOT NULL,
    resource TEXT NOT NULL,
    resource_id INTEGER,
    details JSONB,
    ip_address TEXT,
    user_agent TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for audit logs
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_resource ON audit_logs(resource, resource_id, created_at);

CREATE TABLE IF NOT EXISTS logs (
    id SERIAL,
    user_id INTEGER NOT NULL,
    token_id INTEGER,
    channel_id INTEGER,
    model_name TEXT NOT NULL,
    quota_cost BIGINT NOT NULL DEFAULT 0,
    prompt_tokens INTEGER NOT NULL DEFAULT 0,
    completion_tokens INTEGER NOT NULL DEFAULT 0,
    is_stream BOOLEAN DEFAULT false,
    error_message TEXT,
    status_code INTEGER NOT NULL DEFAULT 200,
    ip TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

-- Create initial log partitions
CREATE TABLE IF NOT EXISTS logs_y2026m03 PARTITION OF logs
    FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');
CREATE TABLE IF NOT EXISTS logs_y2026m04 PARTITION OF logs
    FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');
CREATE TABLE IF NOT EXISTS logs_y2026m05 PARTITION OF logs
    FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');

CREATE TABLE IF NOT EXISTS options (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS payment_orders (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount BIGINT NOT NULL,
    payment_method TEXT NOT NULL,
    transaction_id TEXT UNIQUE,
    status INTEGER NOT NULL DEFAULT 1,
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

CREATE TABLE IF NOT EXISTS redemptions (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    key TEXT NOT NULL UNIQUE,
    quota BIGINT NOT NULL DEFAULT 0,
    count INTEGER NOT NULL DEFAULT 1,
    used_count INTEGER NOT NULL DEFAULT 0,
    status INTEGER NOT NULL DEFAULT 1,      -- 1=active, 2=disabled
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Semantic Cache Table (pgvector)
-- ============================================================

CREATE TABLE IF NOT EXISTS semantic_cache (
    id SERIAL PRIMARY KEY,
    model_name TEXT NOT NULL,
    prompt_hash TEXT NOT NULL,
    prompt TEXT NOT NULL,
    embedding VECTOR(1536),
    response JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (model_name, prompt_hash)
);

-- ============================================================
-- Materialized Views
-- ============================================================

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_system_overview AS
SELECT 
    (SELECT COUNT(*) FROM users) as total_users,
    (SELECT COUNT(*) FROM tokens WHERE status = 1) as active_tokens,
    (SELECT COUNT(*) FROM channels WHERE status = 1) as active_channels,
    (SELECT SUM(quota_cost) FROM logs) as lifetime_usage;

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_model_usage_stats AS
SELECT 
    model_name,
    COUNT(*) as total_requests,
    SUM(quota_cost) as total_cost,
    SUM(prompt_tokens + completion_tokens) as total_tokens,
    MAX(created_at) as last_used_at
FROM logs
GROUP BY model_name;

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_user_daily_stats AS
SELECT 
    user_id,
    DATE(created_at) as stat_date,
    COUNT(*) as request_count,
    SUM(quota_cost) as total_cost
FROM logs
GROUP BY user_id, DATE(created_at);

CREATE OR REPLACE FUNCTION refresh_materialized_views()
RETURNS void AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_system_overview;
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_model_usage_stats;
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_user_daily_stats;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- Indexes
-- ============================================================

-- Logs: BRIN for time-range queries (append-only friendly)
CREATE INDEX IF NOT EXISTS idx_logs_created_at_brin ON logs USING BRIN (created_at);
-- Logs: dashboard queries
CREATE INDEX IF NOT EXISTS idx_logs_user_id ON logs (user_id) INCLUDE (quota_cost, created_at);
-- Logs: pg_trgm fuzzy search on model name
CREATE INDEX IF NOT EXISTS idx_logs_model_trgm ON logs USING gin (model_name gin_trgm_ops);
-- Tokens: lookup by key (hot path)
CREATE INDEX IF NOT EXISTS idx_tokens_key ON tokens (key);
-- Semantic Cache: vector cosine similarity
CREATE INDEX IF NOT EXISTS idx_semantic_cache_embedding ON semantic_cache
    USING hnsw (embedding vector_cosine_ops);

-- View Indexes (for concurrent refresh)
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_system_overview_dummy ON mv_system_overview (total_users, active_tokens, active_channels);
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_model_usage_stats_model ON mv_model_usage_stats (model_name);
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_user_daily_stats_user_date ON mv_user_daily_stats (user_id, stat_date);

-- ============================================================
-- pg_cron Automated Jobs
-- ============================================================

-- Job 1: Hourly cleanup of expired semantic cache entries
SELECT cron.schedule('semantic-cache-cleanup', '0 * * * *',
    'DELETE FROM semantic_cache WHERE created_at < NOW() - INTERVAL ''24 hours''');

-- Job 2: Auto-create next month''s log partition on the 20th at 01:00
SELECT cron.schedule('create-next-log-partition', '0 1 20 * *', $$
    DO $do$
    DECLARE
        s DATE := date_trunc('month', NOW() + INTERVAL '1 month');
        e DATE := date_trunc('month', NOW() + INTERVAL '2 months');
        n TEXT := 'logs_y' || to_char(s, 'YYYYmMM');
    BEGIN
        EXECUTE format('CREATE TABLE IF NOT EXISTS %I PARTITION OF logs FOR VALUES FROM (%L) TO (%L)', n, s, e);
        RAISE NOTICE 'Created partition %', n;
    END $do$
$$);

-- ============================================================
-- Default Admin User (admin / admin123 - CHANGE IMMEDIATELY)
-- ============================================================

INSERT INTO users (username, password_hash, role, quota)
VALUES ('admin', '$argon2id$v=19$m=65536,t=2,p=1$YV3wTB83V0mMIG8xiW2/H4S7fEsz2nxAdFTvBjrIdgI$iJsslt6xW+TqGL+tOwDLxWT0ncdcM4wzogJJz2ppnTY', 10, 100000000)
ON CONFLICT (username) DO NOTHING;

-- Default system options
INSERT INTO options (key, value) VALUES
    ('SystemName', 'Elygate API'),
    ('SemanticCacheEnabled', 'true'),
    ('SemanticCacheThreshold', '0.95'),
    ('SemanticCacheTTLHours', '24'),
    ('LogRetentionDays', '7')
ON CONFLICT (key) DO NOTHING;
