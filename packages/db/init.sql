-- Database: ai_api
-- 该脚本用于免 Drizzle ORM 环境下的直接建表初始化

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


-- 注意：logs 表因高频写入特点，在 PG 15+ 依然建议采用普通表配合内存聚合，
-- 若追求极致可改写为 UNLOGGED TABLE logs (...)
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

-- 初始管理员账号 admin / 123456
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
