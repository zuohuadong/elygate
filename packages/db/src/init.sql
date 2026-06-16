-- Elygate Database Initialization Script
-- Run this on first setup to create all required tables.

-- Enable extensions (requires superuser / Supabase equivalent permissions)
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ============================================================
-- Core Tables
-- ============================================================

CREATE TABLE IF NOT EXISTS user_groups (
    key VARCHAR(50) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    allowed_channel_types JSONB DEFAULT '[]',
    denied_channel_types JSONB DEFAULT '[]',
    allowed_models JSONB DEFAULT '[]',
    denied_models JSONB DEFAULT '[]',
    allowed_packages JSONB DEFAULT '[]',
    status INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO user_groups (key, name, description) VALUES ('default', 'Default Group', 'Standard user group') ON CONFLICT DO NOTHING;
INSERT INTO user_groups (key, name, description, denied_channel_types, denied_models, allowed_models) VALUES ('cn-safe', 'Mainland Safe', 'Only allows CN-registered models', '[1, 14, 23]', '["*"]', '["qwen*", "glm*", "chatglm*", "cogview*", "ernie*", "eb*", "moonshot*", "kimi*", "deepseek*", "doubao*", "hunyuan*", "minimax*", "abab*", "spark*", "yi*", "step*", "baichuan*"]') ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS organizations (
    id SERIAL PRIMARY KEY,
    slug VARCHAR(80) UNIQUE,
    name VARCHAR(120) NOT NULL,
    billing_email TEXT,
    quota BIGINT NOT NULL DEFAULT 0,
    used_quota BIGINT NOT NULL DEFAULT 0,
    allowed_models JSONB NOT NULL DEFAULT '[]',
    denied_models JSONB NOT NULL DEFAULT '[]',
    allowed_subnets TEXT NOT NULL DEFAULT '',
    quota_alarm_threshold INTEGER NOT NULL DEFAULT 80 CHECK (quota_alarm_threshold BETWEEN 1 AND 100),
    alert_threshold_pct INTEGER NOT NULL DEFAULT 80 CHECK (alert_threshold_pct BETWEEN 1 AND 100),
    alert_webhook_url TEXT,
    last_alert_at TIMESTAMPTZ,
    status INTEGER NOT NULL DEFAULT 1 CHECK (status IN (1, 2)),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    email TEXT,
    email_verified BOOLEAN DEFAULT FALSE,
    name TEXT,
    password_hash TEXT NOT NULL DEFAULT '',
    image TEXT,
    role INTEGER NOT NULL DEFAULT 1,        -- 1=user, 5=org_admin, 10=super_admin
    org_id INTEGER REFERENCES organizations(id) ON DELETE SET NULL,
    quota BIGINT NOT NULL DEFAULT 0,        -- available quota (0.001 cent units)
    used_quota BIGINT NOT NULL DEFAULT 0,
    "group" TEXT NOT NULL DEFAULT 'default',
    status INTEGER NOT NULL DEFAULT 1,      -- 1=active, 2=banned
    currency TEXT NOT NULL DEFAULT 'USD' CHECK (currency IN ('USD', 'RMB')),
    github_id TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_org_id ON users(org_id);

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
    org_id INTEGER REFERENCES organizations(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    key TEXT NOT NULL UNIQUE,               -- sk-xxxx
    status INTEGER NOT NULL DEFAULT 1,      -- 1=active, 2=disabled
    remain_quota BIGINT NOT NULL DEFAULT -1, -- -1 = unlimited
    used_quota BIGINT NOT NULL DEFAULT 0,
    models JSONB,                           -- allowed models (null = all)
    subnet TEXT,                            -- IP whitelist
    allow_ips TEXT,                         -- New API compatible IP whitelist alias
    rate_limit INTEGER NOT NULL DEFAULT 0,  -- RPM limit
    unlimited_quota BOOLEAN NOT NULL DEFAULT FALSE,
    model_limits_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    token_group TEXT,
    cross_group_retry BOOLEAN NOT NULL DEFAULT FALSE,
    accessed_at TIMESTAMPTZ,
    expired_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tokens_org_id ON tokens(org_id);
CREATE INDEX IF NOT EXISTS idx_tokens_accessed_at ON tokens(accessed_at);

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
    status INTEGER NOT NULL DEFAULT 1,      -- 1=active, 2=manual disabled, 3=circuit broken, 4=half-open, 5=busy
    status_message TEXT,                    -- detailed error or status message
    key_strategy INTEGER NOT NULL DEFAULT 0, -- 0=load_balance, 1=sequential
    key_status JSONB NOT NULL DEFAULT '{}'::jsonb, -- key exhaustion status
    key_concurrency_limit INTEGER NOT NULL DEFAULT 0, -- 0=unlimited
    endpoint_type TEXT NOT NULL DEFAULT 'auto', -- 'auto'|'chat'|'images'|'video'|'draw'
    price_ratio DECIMAL(10, 4) DEFAULT 1.0, -- price multiplier for dual currency support
    test_model TEXT,
    openai_organization TEXT,
    balance DECIMAL(20, 8),
    balance_updated_at TIMESTAMPTZ,
    response_time INTEGER,
    status_code_mapping JSONB NOT NULL DEFAULT '{}'::jsonb,
    auto_ban INTEGER NOT NULL DEFAULT 1,
    tag TEXT,
    setting JSONB NOT NULL DEFAULT '{}'::jsonb,
    param_override JSONB NOT NULL DEFAULT '{}'::jsonb,
    header_override JSONB NOT NULL DEFAULT '{}'::jsonb,
    remark TEXT,
    channel_info JSONB NOT NULL DEFAULT '{}'::jsonb,
    test_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS api_files (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_id INTEGER REFERENCES tokens(id) ON DELETE SET NULL,
    object TEXT NOT NULL DEFAULT 'file',
    bytes BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    filename TEXT NOT NULL,
    purpose TEXT NOT NULL DEFAULT 'assistants',
    status TEXT NOT NULL DEFAULT 'processed',
    status_details JSONB NOT NULL DEFAULT '{}'::jsonb,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_api_files_user_id ON api_files(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS api_batches (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_id INTEGER REFERENCES tokens(id) ON DELETE SET NULL,
    object TEXT NOT NULL DEFAULT 'batch',
    endpoint TEXT NOT NULL,
    input_file_id TEXT REFERENCES api_files(id) ON DELETE SET NULL,
    completion_window TEXT NOT NULL DEFAULT '24h',
    status TEXT NOT NULL DEFAULT 'validating',
    output_file_id TEXT REFERENCES api_files(id) ON DELETE SET NULL,
    error_file_id TEXT REFERENCES api_files(id) ON DELETE SET NULL,
    request_counts JSONB NOT NULL DEFAULT '{"total":0,"completed":0,"failed":0}'::jsonb,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    errors JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    in_progress_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    failed_at TIMESTAMPTZ,
    expired_at TIMESTAMPTZ,
    cancelling_at TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ,
    finalizing_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_api_batches_user_id ON api_batches(user_id, created_at DESC);

ALTER TABLE tokens ADD COLUMN IF NOT EXISTS allow_ips TEXT;
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS unlimited_quota BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS model_limits_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS token_group TEXT;
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS cross_group_retry BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS accessed_at TIMESTAMPTZ;

ALTER TABLE channels ADD COLUMN IF NOT EXISTS test_model TEXT;
ALTER TABLE channels ADD COLUMN IF NOT EXISTS openai_organization TEXT;
ALTER TABLE channels ADD COLUMN IF NOT EXISTS balance DECIMAL(20, 8);
ALTER TABLE channels ADD COLUMN IF NOT EXISTS balance_updated_at TIMESTAMPTZ;
ALTER TABLE channels ADD COLUMN IF NOT EXISTS response_time INTEGER;
ALTER TABLE channels ADD COLUMN IF NOT EXISTS status_code_mapping JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE channels ADD COLUMN IF NOT EXISTS auto_ban INTEGER NOT NULL DEFAULT 1;
ALTER TABLE channels ADD COLUMN IF NOT EXISTS tag TEXT;
ALTER TABLE channels ADD COLUMN IF NOT EXISTS setting JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE channels ADD COLUMN IF NOT EXISTS param_override JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE channels ADD COLUMN IF NOT EXISTS header_override JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE channels ADD COLUMN IF NOT EXISTS remark TEXT;
ALTER TABLE channels ADD COLUMN IF NOT EXISTS channel_info JSONB NOT NULL DEFAULT '{}'::jsonb;

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
    cycle_quota BIGINT DEFAULT 0, -- amount to refill each cycle
    cycle_interval INTEGER DEFAULT 1, -- numeric interval
    cycle_unit TEXT DEFAULT 'day', -- hour, day, week, month
    cache_policy JSONB DEFAULT '{"mode": "default"}', -- default, isolated, refresh_on_count, disabled
    is_public BOOLEAN DEFAULT true,
    allowed_groups JSONB DEFAULT '[]', -- Package visibility: empty means visible to all groups
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
    quota_granted BIGINT DEFAULT 0,
    quota_used BIGINT DEFAULT 0,
    last_reset_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_subscriptions_user_id ON user_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_end_time ON user_subscriptions(end_time);

ALTER TABLE user_subscriptions ADD COLUMN IF NOT EXISTS quota_granted BIGINT DEFAULT 0;
ALTER TABLE user_subscriptions ADD COLUMN IF NOT EXISTS quota_used BIGINT DEFAULT 0;

-- Invite codes
CREATE TABLE IF NOT EXISTS invite_codes (
    id SERIAL PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    max_uses INTEGER NOT NULL DEFAULT 1,
    used_count INTEGER NOT NULL DEFAULT 0,
    gift_quota BIGINT NOT NULL DEFAULT 0,
    status INTEGER NOT NULL DEFAULT 1,
    expires_at TIMESTAMPTZ,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_invite_codes_status ON invite_codes(status, created_at DESC);

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
ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_secret TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_pending_secret TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_backup_codes JSONB DEFAULT '[]';
ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_pending_backup_codes JSONB DEFAULT '[]';

-- Create indexes for login attempts
CREATE INDEX IF NOT EXISTS idx_login_attempts_username ON login_attempts(username, created_at);
CREATE INDEX IF NOT EXISTS idx_login_attempts_ip ON login_attempts(ip_address, created_at);

CREATE TABLE IF NOT EXISTS two_factor_login_challenges (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_two_factor_login_challenges_user_id ON two_factor_login_challenges(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_two_factor_login_challenges_expires_at ON two_factor_login_challenges(expires_at);

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

CREATE TABLE IF NOT EXISTS org_budget_alerts (
    id SERIAL PRIMARY KEY,
    org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    quota BIGINT NOT NULL,
    used_quota BIGINT NOT NULL,
    usage_percent DECIMAL(5, 4) NOT NULL,
    alert_level TEXT NOT NULL CHECK (alert_level IN ('warning', 'critical', 'exhausted')),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_org_budget_alerts_org_id ON org_budget_alerts(org_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_org_budget_alerts_unique ON org_budget_alerts(org_id, alert_level, DATE(created_at));

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
    cached_tokens INTEGER NOT NULL DEFAULT 0,
    elapsed_ms INTEGER NOT NULL DEFAULT 0,
    is_stream BOOLEAN DEFAULT false,
    error_message TEXT,
    status_code INTEGER NOT NULL DEFAULT 200,
    ip_address VARCHAR(45),
    user_agent TEXT,
    trace_id TEXT,
    org_id INTEGER REFERENCES organizations(id) ON DELETE SET NULL,
    external_task_id TEXT,
    external_user_id TEXT,
    external_workspace_id TEXT,
    external_feature_type TEXT,
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

CREATE INDEX IF NOT EXISTS idx_logs_org_id ON logs(org_id);
CREATE INDEX IF NOT EXISTS idx_logs_trace_id ON logs(trace_id);
CREATE INDEX IF NOT EXISTS idx_logs_external_task_id ON logs(external_task_id);
CREATE INDEX IF NOT EXISTS idx_logs_external_user_id ON logs(external_user_id);

CREATE TABLE IF NOT EXISTS log_details (
    id SERIAL PRIMARY KEY,
    log_id INTEGER NOT NULL UNIQUE,
    log_created_at TIMESTAMPTZ,
    request_body TEXT,
    response_body TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT log_details_log_ref_fkey
        FOREIGN KEY (log_id, log_created_at)
        REFERENCES logs(id, created_at)
        ON DELETE CASCADE
        DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX IF NOT EXISTS idx_log_details_log_ref ON log_details(log_id, log_created_at);

CREATE TABLE IF NOT EXISTS health_logs (
    id SERIAL PRIMARY KEY,
    channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    status INTEGER NOT NULL CHECK (status IN (0, 1)),
    latency INTEGER,
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_health_logs_channel_id ON health_logs(channel_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_health_logs_created_at ON health_logs(created_at DESC);

-- ============================================================
-- Idempotency Keys
-- ============================================================

CREATE TABLE IF NOT EXISTS idempotency_keys (
    id SERIAL PRIMARY KEY,
    key_hash TEXT NOT NULL UNIQUE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    response_code INTEGER,
    response_body JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_idempotency_keys_expires_at ON idempotency_keys(expires_at);
CREATE INDEX IF NOT EXISTS idx_idempotency_keys_user_key ON idempotency_keys(user_id, key_hash);

-- ============================================================
-- ComfyUI Workflow Templates
-- ============================================================

CREATE TABLE IF NOT EXISTS workflow_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    description TEXT,
    group_name TEXT DEFAULT 'default',
    template_json JSONB NOT NULL,
    input_parameters JSONB NOT NULL DEFAULT '[]',
    provider_type INTEGER NOT NULL DEFAULT 100,
    user_id UUID,
    is_public BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workflow_templates_name ON workflow_templates(name);
CREATE INDEX IF NOT EXISTS idx_workflow_templates_group ON workflow_templates(group_name);


-- ============================================================
-- Model Metadata (type, tags, display name, pricing metadata)
-- ============================================================

CREATE TABLE IF NOT EXISTS model_metadata (
    id SERIAL PRIMARY KEY,
    model_name TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL DEFAULT 'chat',  -- chat, image, video, audio, embedding, rerank, moderation
    endpoint TEXT,                      -- /v1/chat/completions etc.
    display_name TEXT,
    tags JSONB DEFAULT '[]',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_model_metadata_type ON model_metadata(type);
CREATE INDEX IF NOT EXISTS idx_model_metadata_name_trgm ON model_metadata USING gin (model_name gin_trgm_ops);


-- ============================================================
-- User Checkin
-- ============================================================

CREATE TABLE IF NOT EXISTS user_checkins (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    checkin_date DATE NOT NULL,
    reward BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (user_id, checkin_date)
);

CREATE INDEX IF NOT EXISTS idx_user_checkins_user ON user_checkins(user_id, checkin_date DESC);

-- ============================================================
-- User Affiliate / Invite
-- ============================================================

CREATE TABLE IF NOT EXISTS user_aff (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    code TEXT NOT NULL UNIQUE,
    reward BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_aff_rewards (
    id SERIAL PRIMARY KEY,
    referrer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    referee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reward BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_aff_rewards_referrer ON user_aff_rewards(referrer_id);

CREATE TABLE IF NOT EXISTS options (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS payment_orders (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount BIGINT NOT NULL,
    payment_method TEXT NOT NULL,
    order_type TEXT NOT NULL DEFAULT 'topup',
    target_type TEXT,
    target_id INTEGER,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    transaction_id TEXT UNIQUE,
    status INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS order_type TEXT NOT NULL DEFAULT 'topup';
ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS target_type TEXT;
ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS target_id INTEGER;
ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

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

CREATE TABLE IF NOT EXISTS custom_oauth_providers (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    issuer TEXT,
    discovery_url TEXT,
    client_id TEXT,
    client_secret TEXT,
    authorization_endpoint TEXT,
    token_endpoint TEXT,
    userinfo_endpoint TEXT,
    jwks_uri TEXT,
    scopes JSONB DEFAULT '[]',
    enabled BOOLEAN NOT NULL DEFAULT true,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_custom_oauth_providers_enabled ON custom_oauth_providers(enabled, created_at DESC);

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
-- Semantic Cache Table (pgvector) - UNLOGGED for performance
-- ============================================================

CREATE UNLOGGED TABLE IF NOT EXISTS semantic_cache (
    id SERIAL PRIMARY KEY,
    model_name TEXT NOT NULL,
    prompt_hash TEXT NOT NULL,
    prompt TEXT NOT NULL,
    embedding VECTOR(1024),
    response JSONB NOT NULL,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (model_name, prompt_hash)
);

-- ============================================================
-- Exact Match Response Cache Table - UNLOGGED for performance
-- ============================================================

CREATE UNLOGGED TABLE IF NOT EXISTS response_cache (
    hash TEXT PRIMARY KEY,
    model_name TEXT NOT NULL,
    response JSONB NOT NULL,
    usage JSONB,
    created_by INT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    expired_at TIMESTAMP WITH TIME ZONE,
    last_read_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_response_cache_model_created ON response_cache (model_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_response_cache_expired ON response_cache (expired_at);
CREATE INDEX IF NOT EXISTS idx_response_cache_last_read ON response_cache (last_read_at);

-- ============================================================
-- Agent Memory Table (pgvector) - durable long-term memory
-- ============================================================

CREATE TABLE IF NOT EXISTS agent_memories (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_id INTEGER REFERENCES tokens(id) ON DELETE CASCADE,
    org_id INTEGER REFERENCES organizations(id) ON DELETE CASCADE,
    thread_id TEXT,
    scope TEXT NOT NULL DEFAULT 'user',
    kind TEXT NOT NULL DEFAULT 'fact',
    content TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    embedding VECTOR(1024),
    confidence DECIMAL(5,4) NOT NULL DEFAULT 1.0000,
    source_trace_id TEXT,
    metadata JSONB NOT NULL DEFAULT '{}',
    expires_at TIMESTAMPTZ,
    deleted_at TIMESTAMPTZ,
    last_read_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (user_id, scope, kind, content_hash)
);

CREATE INDEX IF NOT EXISTS idx_agent_memories_user_scope ON agent_memories (user_id, scope, deleted_at, expires_at);
CREATE INDEX IF NOT EXISTS idx_agent_memories_token ON agent_memories (token_id);
CREATE INDEX IF NOT EXISTS idx_agent_memories_org ON agent_memories (org_id);
CREATE INDEX IF NOT EXISTS idx_agent_memories_thread ON agent_memories (thread_id);
CREATE INDEX IF NOT EXISTS idx_agent_memories_content_tsv ON agent_memories USING gin (to_tsvector('simple', content));
CREATE INDEX IF NOT EXISTS idx_agent_memories_embedding ON agent_memories USING hnsw (embedding vector_cosine_ops);

-- ============================================================
-- Token Cache Table - UNLOGGED for performance
-- ============================================================

CREATE UNLOGGED TABLE IF NOT EXISTS token_cache (
    key_hash TEXT PRIMARY KEY,
    token_data JSONB NOT NULL,
    user_id INTEGER NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    expired_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_token_cache_user ON token_cache (user_id);
CREATE INDEX IF NOT EXISTS idx_token_cache_expired ON token_cache (expired_at);

-- ============================================================
-- User Quota Cache Table - UNLOGGED for performance
-- ============================================================

CREATE UNLOGGED TABLE IF NOT EXISTS user_quota_cache (
    user_id INTEGER PRIMARY KEY,
    quota BIGINT NOT NULL,
    used_quota BIGINT NOT NULL DEFAULT 0,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- LRU Eviction Procedure for Response Cache
-- ============================================================

CREATE OR REPLACE PROCEDURE expire_cache_rows(retention_period INTERVAL) AS $$
BEGIN
    DELETE FROM response_cache WHERE expired_at < NOW();
    DELETE FROM semantic_cache WHERE created_at < NOW() - retention_period;
    DELETE FROM token_cache WHERE expired_at < NOW();
    DELETE FROM idempotency_keys WHERE expires_at < NOW();
    COMMIT;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE PROCEDURE lru_eviction(eviction_count INTEGER) AS $$
BEGIN
    DELETE FROM response_cache
    WHERE ctid IN (
        SELECT ctid FROM response_cache
        ORDER BY last_read_at ASC
        LIMIT eviction_count
    );
    COMMIT;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- Maintenance Procedures
-- ============================================================

CREATE OR REPLACE PROCEDURE cleanup_old_logs(retention_days INTEGER DEFAULT 90)
LANGUAGE plpgsql
AS $$
BEGIN
    DELETE FROM log_details
    WHERE log_created_at < NOW() - (retention_days || ' days')::INTERVAL;
    DELETE FROM logs
    WHERE created_at < NOW() - (retention_days || ' days')::INTERVAL;
    RAISE NOTICE 'Cleaned up logs older than % days.', retention_days;
END;
$$;

CREATE OR REPLACE PROCEDURE optimize_tables()
LANGUAGE plpgsql
AS $$
BEGIN
    VACUUM ANALYZE logs;
    VACUUM ANALYZE log_details;
    VACUUM ANALYZE organizations;
    VACUUM ANALYZE users;
END;
$$;

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

-- ============================================================
-- Task Management (Async Jobs)
-- ============================================================

CREATE TABLE IF NOT EXISTS tasks (
    id SERIAL PRIMARY KEY,
    type VARCHAR(50) NOT NULL, -- 'data_export', 'data_import', 'cache_clear', 'batch_operation'
    name TEXT NOT NULL,
    description TEXT,
    status INTEGER NOT NULL DEFAULT 0, -- 0: pending, 1: running, 2: completed, 3: failed, 4: cancelled
    priority INTEGER NOT NULL DEFAULT 0, -- higher = more important
    progress INTEGER NOT NULL DEFAULT 0, -- 0-100
    total_items INTEGER DEFAULT 0,
    processed_items INTEGER DEFAULT 0,
    result JSONB,
    error_message TEXT,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_type ON tasks(type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_created_by ON tasks(created_by, created_at DESC);

-- Task execution logs
CREATE TABLE IF NOT EXISTS task_logs (
    id SERIAL PRIMARY KEY,
    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    level VARCHAR(20) NOT NULL, -- 'info', 'warning', 'error'
    message TEXT NOT NULL,
    details JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Subscription / Billing Feature Parity
-- ============================================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS billing_preference TEXT NOT NULL DEFAULT 'subscription_first';
ALTER TABLE users ADD COLUMN IF NOT EXISTS quota_display_type TEXT NOT NULL DEFAULT 'USD';

ALTER TABLE packages ADD COLUMN IF NOT EXISTS subtitle TEXT;
ALTER TABLE packages ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'USD';
ALTER TABLE packages ADD COLUMN IF NOT EXISTS duration_unit TEXT NOT NULL DEFAULT 'day';
ALTER TABLE packages ADD COLUMN IF NOT EXISTS duration_value INTEGER NOT NULL DEFAULT 30;
ALTER TABLE packages ADD COLUMN IF NOT EXISTS custom_seconds BIGINT NOT NULL DEFAULT 0;
ALTER TABLE packages ADD COLUMN IF NOT EXISTS total_amount BIGINT NOT NULL DEFAULT 0;
ALTER TABLE packages ADD COLUMN IF NOT EXISTS quota_reset_period TEXT NOT NULL DEFAULT 'never';
ALTER TABLE packages ADD COLUMN IF NOT EXISTS quota_reset_custom_seconds BIGINT NOT NULL DEFAULT 0;
ALTER TABLE packages ADD COLUMN IF NOT EXISTS enabled BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE packages ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE packages ADD COLUMN IF NOT EXISTS stripe_price_id TEXT;
ALTER TABLE packages ADD COLUMN IF NOT EXISTS creem_product_id TEXT;
ALTER TABLE packages ADD COLUMN IF NOT EXISTS waffo_pancake_product_id TEXT;
ALTER TABLE packages ADD COLUMN IF NOT EXISTS max_purchase_per_user INTEGER NOT NULL DEFAULT 0;
ALTER TABLE packages ADD COLUMN IF NOT EXISTS upgrade_group TEXT;

ALTER TABLE user_subscriptions ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'order';
ALTER TABLE user_subscriptions ADD COLUMN IF NOT EXISTS amount_total BIGINT NOT NULL DEFAULT 0;
ALTER TABLE user_subscriptions ADD COLUMN IF NOT EXISTS amount_used BIGINT NOT NULL DEFAULT 0;
ALTER TABLE user_subscriptions ADD COLUMN IF NOT EXISTS next_reset_at TIMESTAMPTZ;
ALTER TABLE user_subscriptions ADD COLUMN IF NOT EXISTS upgrade_group TEXT;
ALTER TABLE user_subscriptions ADD COLUMN IF NOT EXISTS prev_user_group TEXT;

ALTER TABLE redemptions ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE redemptions ADD COLUMN IF NOT EXISTS used_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE redemptions ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
ALTER TABLE redemptions ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS subscription_orders (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    package_id INTEGER NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
    amount INTEGER NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'USD',
    money DECIMAL(10,2) NOT NULL DEFAULT 0,
    trade_no TEXT NOT NULL UNIQUE,
    payment_method TEXT NOT NULL,
    payment_provider TEXT NOT NULL DEFAULT '',
    transaction_id TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    provider_payload TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subscription_orders_user_id ON subscription_orders(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_subscription_orders_status ON subscription_orders(status, created_at DESC);

CREATE TABLE IF NOT EXISTS topup_logs (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    payment_order_id INTEGER REFERENCES payment_orders(id) ON DELETE SET NULL,
    subscription_order_id INTEGER REFERENCES subscription_orders(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    payment_method TEXT,
    payment_provider TEXT,
    amount BIGINT NOT NULL DEFAULT 0,
    money DECIMAL(10,2) NOT NULL DEFAULT 0,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_topup_logs_user_id ON topup_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_packages_enabled_sort ON packages(enabled, sort_order DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_task_logs_task_id ON task_logs(task_id, created_at DESC);

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
    ('SEO_Title', 'Elygate - Smart AI API Gateway'),
    ('SEO_Description', 'A powerful, high-performance AI API gateway with semantic caching, multi-channel load balancing, and advanced analytics.'),
    ('SEO_Keywords', 'AI, API, Gateway, OpenAI, Claude, Gemini, Semantic Cache, LLM, Proxy'),
    ('SemanticCacheEnabled', 'true'),
    ('SemanticCacheThreshold', '0.95'),
    ('SemanticCacheTTLHours', '24'),
    ('MemoryEnabled', 'false'),
    ('MemoryReadDefault', 'false'),
    ('MemoryWriteDefault', 'false'),
    ('MemoryMaxInjectedItems', '6'),
    ('MemoryMinWriteChars', '24'),
    ('MemoryScope', 'user'),
    ('MemoryEmbeddingModel', ''),
    ('LogRetentionDays', '7'),
    ('Logo_URL', ''),
    ('Footer_HTML', ''),
    ('Custom_CSS', ''),
    ('Custom_JS', ''),
    ('WebhookURL', ''),
    ('Notify_On_Channel_Offline', 'true'),
    ('SemanticCacheDefaultMode', 'default'),
    ('Timezone', 'UTC'),
    ('UPSTREAM_TIMEOUT_MS', '30000'),
    ('CIRCUIT_BREAKER_WINDOW_MS', '300000'),
    ('CIRCUIT_BREAKER_FAILURE_RATE', '0.5'),
    ('CIRCUIT_BREAKER_MIN_REQUESTS', '3'),
    ('CIRCUIT_BREAKER_RECOVERY_THRESHOLD', '3'),
    ('LATENCY_THRESHOLD_MS', '30000'),
    ('HEALTH_CHECK_INTERVAL', '60000'),
    ('ChannelSelectionStrategy', 'priority'),
    ('AutoGroups', '["vip","premium","default"]'),
    ('ChannelAffinityEnabled', 'false'),
    ('ModelRequestRateLimitEnabled', 'false'),
    ('ModelRequestRateLimitCount', '0'),
    ('ModelRequestRateLimitSuccessCount', '0'),
    ('ModelRequestRateLimitDurationMinutes', '1'),
    ('GroupModelRateLimits', '{}'),
    ('CheckinEnabled', 'false'),
    ('CheckinReward', '100000'),
    ('Notice', 'Welcome to Elygate AI Gateway.'),
    ('About', ''),
    ('PrivacyPolicy', ''),
    ('UserAgreement', ''),
    ('HomePageContent', ''),
    ('FAQ', ''),
    ('PricingContent', ''),
    ('Favicon', ''),
    ('DisplayInCurrency', 'false'),
    ('QuotaPerUnit', '500000'),
    ('CacheRatio', '0.5'),
    ('model_deployment.ionet.enabled', 'false'),
    ('model_deployment.ionet.api_key', ''),
    ('model_deployment.ionet.public_base_url', 'https://api.io.solutions/v1/io-cloud/caas'),
    ('model_deployment.ionet.enterprise_base_url', 'https://api.io.solutions/enterprise/v1/io-cloud/caas')
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- Channel indexes for tag/status/group queries (New API parity)
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_channels_tag ON channels(tag) WHERE tag IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_channels_status ON channels(status);
CREATE INDEX IF NOT EXISTS idx_channels_type ON channels(type);

CREATE INDEX IF NOT EXISTS idx_tokens_user_id ON tokens(user_id);

-- ============================================================
-- Vendors table (New API parity)
-- ============================================================
-- Announcements (New API parity)
CREATE TABLE IF NOT EXISTS announcements (
    id SERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    tag TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS vendors (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    type INTEGER DEFAULT 0,
    base_url TEXT DEFAULT '',
    logo_url TEXT DEFAULT '',
    description TEXT DEFAULT '',
    config JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vendors_type ON vendors(type);

-- ============================================================
-- Channel type compatibility migration
-- New API reserves 34/35/42 for Cohere/MiniMax/Mistral. Older Elygate
-- builds used those values for Flux/Udio/Dakka, so move recognizable legacy
-- channels to the private 1000+ range.
-- ============================================================
UPDATE channels
SET type = 1002
WHERE type = 34
  AND (
    name ILIKE '%flux%'
    OR base_url ILIKE '%replicate%'
    OR base_url ILIKE '%fal.ai%'
    OR models::text ILIKE '%flux%'
  );

UPDATE channels
SET type = 1003
WHERE type = 35
  AND (
    name ILIKE '%udio%'
    OR base_url ILIKE '%udio%'
    OR models::text ILIKE '%udio%'
  );

UPDATE channels
SET type = 1004
WHERE type = 42
  AND (
    name ILIKE '%dakka%'
    OR base_url ILIKE '%dakka%'
    OR models::text ILIKE '%nano-banana%'
    OR models::text ILIKE '%veo%'
  );

-- ============================================================
-- Enterprise Team / Project / Member
-- ============================================================

CREATE TABLE IF NOT EXISTS teams (
    id SERIAL PRIMARY KEY,
    org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(120) NOT NULL,
    slug VARCHAR(80),
    description TEXT,
    leader_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    budget BIGINT NOT NULL DEFAULT 0,
    used_budget BIGINT NOT NULL DEFAULT 0,
    allowed_models JSONB NOT NULL DEFAULT '[]',
    denied_models JSONB NOT NULL DEFAULT '[]',
    status INTEGER NOT NULL DEFAULT 1,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_teams_org_id ON teams(org_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_teams_slug_org ON teams(slug, org_id) WHERE slug IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS projects (
    id SERIAL PRIMARY KEY,
    org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    team_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
    name VARCHAR(120) NOT NULL,
    slug VARCHAR(80),
    description TEXT,
    budget BIGINT NOT NULL DEFAULT 0,
    used_budget BIGINT NOT NULL DEFAULT 0,
    allowed_models JSONB NOT NULL DEFAULT '[]',
    denied_models JSONB NOT NULL DEFAULT '[]',
    status INTEGER NOT NULL DEFAULT 1,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_projects_org_id ON projects(org_id);
CREATE INDEX IF NOT EXISTS idx_projects_team_id ON projects(team_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_slug_org ON projects(slug, org_id) WHERE slug IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS team_members (
    id SERIAL PRIMARY KEY,
    team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(30) NOT NULL DEFAULT 'member',
    joined_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_team_members_unique ON team_members(team_id, user_id);

-- ============================================================
-- Soft-delete support for organizations and tokens
-- ============================================================

ALTER TABLE organizations ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- ============================================================
-- Deleted Records (Recycle Bin)
-- ============================================================

CREATE TABLE IF NOT EXISTS deleted_records (
    id SERIAL PRIMARY KEY,
    resource_type VARCHAR(60) NOT NULL,
    resource_id INTEGER NOT NULL,
    snapshot JSONB NOT NULL,
    deleted_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    restored_at TIMESTAMPTZ,
    restored_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    purge_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_deleted_records_type ON deleted_records(resource_type);
CREATE INDEX IF NOT EXISTS idx_deleted_records_purge ON deleted_records(purge_at) WHERE restored_at IS NULL;

-- ============================================================
-- Email Verification / Password Reset Codes
-- ============================================================

CREATE TABLE IF NOT EXISTS verification_codes (
    id SERIAL PRIMARY KEY,
    type VARCHAR(40) NOT NULL,
    target TEXT NOT NULL,
    code VARCHAR(64) NOT NULL,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    ip_address TEXT,
    consumed BOOLEAN NOT NULL DEFAULT FALSE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_verification_codes_target ON verification_codes(type, target) WHERE consumed = FALSE;
CREATE INDEX IF NOT EXISTS idx_verification_codes_user ON verification_codes(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_verification_codes_expiry ON verification_codes(expires_at);

-- ============================================================
-- Assistants / Threads / Vector Stores / Fine-tuning
-- ============================================================

CREATE TABLE IF NOT EXISTS assistants (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_id INTEGER,
    object VARCHAR(30) DEFAULT 'assistant',
    name TEXT,
    description TEXT,
    model TEXT NOT NULL,
    instructions TEXT,
    tools JSONB DEFAULT '[]',
    file_ids JSONB DEFAULT '[]',
    metadata JSONB DEFAULT '{}',
    temperature DECIMAL(5,2),
    top_p DECIMAL(5,4),
    status VARCHAR(20) DEFAULT 'active',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS threads (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_id INTEGER,
    object VARCHAR(30) DEFAULT 'thread',
    metadata JSONB DEFAULT '{}',
    tool_resources JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS thread_messages (
    id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL,
    object VARCHAR(30) DEFAULT 'thread.message',
    role VARCHAR(20) NOT NULL DEFAULT 'user',
    content JSONB DEFAULT '[]',
    assistant_id TEXT,
    run_id TEXT,
    attachments JSONB DEFAULT '[]',
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_thread_messages_thread ON thread_messages(thread_id);

CREATE TABLE IF NOT EXISTS thread_runs (
    id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    assistant_id TEXT,
    user_id INTEGER NOT NULL,
    object VARCHAR(30) DEFAULT 'thread.run',
    status VARCHAR(30) NOT NULL DEFAULT 'queued',
    model TEXT,
    instructions TEXT,
    tools JSONB DEFAULT '[]',
    metadata JSONB DEFAULT '{}',
    temperature DECIMAL(5,2),
    top_p DECIMAL(5,4),
    max_prompt_tokens INTEGER,
    max_completion_tokens INTEGER,
    truncation_strategy JSONB,
    tool_choice JSONB,
    response_format JSONB,
    required_action JSONB,
    last_error JSONB,
    usage JSONB,
    started_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ,
    failed_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_thread_runs_thread ON thread_runs(thread_id);
CREATE INDEX IF NOT EXISTS idx_thread_runs_status ON thread_runs(status);

CREATE TABLE IF NOT EXISTS vector_stores (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_id INTEGER,
    object VARCHAR(30) DEFAULT 'vector_store',
    name TEXT,
    file_counts JSONB DEFAULT '{"in_progress":0,"completed":0,"failed":0,"cancelled":0,"total":0}',
    status VARCHAR(20) DEFAULT 'completed',
    usage_bytes BIGINT NOT NULL DEFAULT 0,
    metadata JSONB DEFAULT '{}',
    expires_after JSONB,
    expires_at TIMESTAMPTZ,
    last_active_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS vector_store_files (
    id TEXT PRIMARY KEY,
    vector_store_id TEXT NOT NULL REFERENCES vector_stores(id) ON DELETE CASCADE,
    file_id TEXT,
    object VARCHAR(30) DEFAULT 'vector_store.file',
    status VARCHAR(20) DEFAULT 'completed',
    usage_bytes BIGINT NOT NULL DEFAULT 0,
    last_error JSONB,
    chunking_strategy JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_vs_files_store ON vector_store_files(vector_store_id);

CREATE TABLE IF NOT EXISTS fine_tuning_jobs (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_id INTEGER,
    object VARCHAR(30) DEFAULT 'fine_tuning.job',
    model TEXT NOT NULL,
    training_file TEXT,
    validation_file TEXT,
    hyperparameters JSONB DEFAULT '{}',
    status VARCHAR(40) NOT NULL DEFAULT 'validating_files',
    fine_tuned_model TEXT,
    organization_id TEXT,
    result_files JSONB DEFAULT '[]',
    trained_tokens INTEGER,
    error JSONB,
    epochs INTEGER,
    suffix TEXT,
    integrations JSONB DEFAULT '[]',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    finished_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
