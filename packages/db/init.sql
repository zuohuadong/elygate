-- Database: ai_api
-- This script is used for direct table initialization without Drizzle ORM

CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role INTEGER NOT NULL DEFAULT 1,
    quota BIGINT NOT NULL DEFAULT 0,
    used_quota BIGINT NOT NULL DEFAULT 0,
    "group" VARCHAR(50) NOT NULL DEFAULT 'default',
    status INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS channels (
    id SERIAL PRIMARY KEY,
    type INTEGER NOT NULL,
    name VARCHAR(255) NOT NULL,
    base_url VARCHAR(255),
    key TEXT NOT NULL,
    models JSONB NOT NULL DEFAULT '[]'::jsonb,
    model_mapping JSONB NOT NULL DEFAULT '{}'::jsonb,
    weight INTEGER NOT NULL DEFAULT 1,
    status INTEGER NOT NULL DEFAULT 1,
    test_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS tokens (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    key VARCHAR(255) UNIQUE NOT NULL,
    status INTEGER NOT NULL DEFAULT 1,
    remain_quota BIGINT NOT NULL DEFAULT -1,
    used_quota BIGINT NOT NULL DEFAULT 0,
    expired_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL    
);
CREATE INDEX IF NOT EXISTS idx_tokens_key ON tokens(key);


-- Note: Due to high-frequency writes, for logs table in PG 15+, 
-- it's still recommended to use standard tables with in-memory aggregation.
-- For extreme performance, it can be rewritten as UNLOGGED TABLE logs (...)
CREATE TABLE IF NOT EXISTS logs (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_id INTEGER REFERENCES tokens(id) ON DELETE SET NULL,
    channel_id INTEGER REFERENCES channels(id) ON DELETE SET NULL,
    model_name VARCHAR(255) NOT NULL,
    quota_cost INTEGER NOT NULL DEFAULT 0,
    prompt_tokens INTEGER NOT NULL DEFAULT 0,
    completion_tokens INTEGER NOT NULL DEFAULT 0,
    is_stream BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_logs_user_id ON logs(user_id);
CREATE INDEX IF NOT EXISTS idx_logs_created_at ON logs(created_at);

CREATE TABLE IF NOT EXISTS redemptions (
    id SERIAL PRIMARY KEY,
    code VARCHAR(255) UNIQUE NOT NULL,
    quota BIGINT NOT NULL,
    status INTEGER NOT NULL DEFAULT 1,
    used_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    used_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_redemptions_code ON redemptions(code);

CREATE TABLE IF NOT EXISTS options (
    key VARCHAR(255) PRIMARY KEY,
    value TEXT NOT NULL
);

-- Initial default ratios and configuration parameters (Align with New-API)
INSERT INTO options (key, value) VALUES
('ModelRatio', '{"gpt-3.5-turbo": 1, "gpt-4": 15, "gpt-4o": 5, "claude-3-opus-20240229": 15, "claude-3-sonnet-20240229": 3, "gemini-1.5-pro-latest": 3, "gemini-1.5-flash-latest": 0.5, "text-embedding-3-small": 0.02, "text-embedding-3-large": 0.1, "text-embedding-ada-002": 0.05, "dall-e-2": 20000, "dall-e-3": 40000}'),
('CompletionRatio', '{"gpt-3.5-turbo": 1.33, "gpt-4": 2, "gpt-4o": 3, "claude-3-opus-20240229": 5, "claude-3-sonnet-20240229": 5, "gemini-1.5-pro-latest": 2, "gemini-1.5-flash-latest": 2}'),
('GroupRatio', '{"default": 1, "vip": 0.8, "svip": 0.6, "enterprise": 0.5}')
ON CONFLICT (key) DO NOTHING;

-- Initial administrator account: admin / 123456
INSERT INTO users (id, username, password_hash, role, quota, used_quota, "group", status)
VALUES (
    1, 
    'admin', 
    '$2a$10$wT3wYQ9aH5A5k..H.M3GvOEWn3L5Rk3z0I7D2V6eB5W.56n3R.F9G', 
    10, 
    10000000, 
    0, 
    'vip', 
    1
) ON CONFLICT (id) DO NOTHING;
