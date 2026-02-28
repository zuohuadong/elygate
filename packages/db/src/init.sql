-- Elygate Database Initialization Script
-- Run this on first setup to create all required tables.

-- Enable extensions (requires superuser / Supabase equivalent permissions)
CREATE EXTENSION IF NOT EXISTS pgvector;
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_bigm;

-- ============================================================
-- Core Tables
-- ============================================================

CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL DEFAULT '',
    role INTEGER NOT NULL DEFAULT 1,        -- 1=user, 10=admin
    quota BIGINT NOT NULL DEFAULT 0,        -- available quota (0.001 cent units)
    used_quota BIGINT NOT NULL DEFAULT 0,
    "group" TEXT NOT NULL DEFAULT 'default',
    status INTEGER NOT NULL DEFAULT 1,      -- 1=active, 2=banned
    github_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tokens (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    key TEXT NOT NULL UNIQUE,               -- sk-xxxx
    status INTEGER NOT NULL DEFAULT 1,      -- 1=active, 2=disabled
    remain_quota BIGINT NOT NULL DEFAULT -1, -- -1 = unlimited
    used_quota BIGINT NOT NULL DEFAULT 0,
    models JSONB,                           -- allowed models (null = all)
    expired_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

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
    test_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

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
-- Indexes
-- ============================================================

-- Logs: BRIN for time-range queries (append-only friendly)
CREATE INDEX IF NOT EXISTS idx_logs_created_at_brin ON logs USING BRIN (created_at);
-- Logs: dashboard queries
CREATE INDEX IF NOT EXISTS idx_logs_user_id ON logs (user_id) INCLUDE (quota_cost, created_at);
-- Logs: pg_bigm fuzzy search on model name
CREATE INDEX IF NOT EXISTS idx_logs_model_bigm ON logs (model_name) USING gin (model_name gin_bigm_ops);
-- Tokens: lookup by key (hot path)
CREATE INDEX IF NOT EXISTS idx_tokens_key ON tokens (key);
-- Semantic Cache: vector cosine similarity
CREATE INDEX IF NOT EXISTS idx_semantic_cache_embedding ON semantic_cache
    USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

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
VALUES ('admin', '$2b$10$placeholder_change_this_hash', 10, 100000000)
ON CONFLICT (username) DO NOTHING;

-- Default system options
INSERT INTO options (key, value) VALUES
    ('SystemName', 'Elygate API'),
    ('SemanticCacheEnabled', 'true'),
    ('SemanticCacheThreshold', '0.95'),
    ('SemanticCacheTTLHours', '24'),
    ('LogRetentionDays', '7')
ON CONFLICT (key) DO NOTHING;
