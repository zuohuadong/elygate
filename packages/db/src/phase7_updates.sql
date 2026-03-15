-- Phase 7: Enterprise Domain & Runtime Compatibility Schema
-- Adds organizations as a first-class domain concept while keeping the
-- gateway, web, and portal on one coherent PostgreSQL model.

CREATE TABLE IF NOT EXISTS organizations (
    id SERIAL PRIMARY KEY,
    name VARCHAR(120) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE organizations ADD COLUMN IF NOT EXISTS slug VARCHAR(80);
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS billing_email TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS quota BIGINT NOT NULL DEFAULT 0;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS used_quota BIGINT NOT NULL DEFAULT 0;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS allowed_models JSONB NOT NULL DEFAULT '[]';
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS denied_models JSONB NOT NULL DEFAULT '[]';
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS allowed_subnets TEXT NOT NULL DEFAULT '';
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS quota_alarm_threshold INTEGER NOT NULL DEFAULT 80;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS status INTEGER NOT NULL DEFAULT 1;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS idx_organizations_slug ON organizations(slug);

-- Users: organization membership and explicit billing currency.
ALTER TABLE users ADD COLUMN IF NOT EXISTS org_id INTEGER REFERENCES organizations(id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'USD';
CREATE INDEX IF NOT EXISTS idx_users_org_id ON users(org_id);

-- role 5 = Org Admin, role 10 = Super Admin
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN (1, 5, 10));

-- Tokens: denormalized org ownership for fast auth and audit paths.
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS org_id INTEGER REFERENCES organizations(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_tokens_org_id ON tokens(org_id);

-- Logs: organization isolation, tracing, and cached token accounting.
ALTER TABLE logs ADD COLUMN IF NOT EXISTS org_id INTEGER;
ALTER TABLE logs ADD COLUMN IF NOT EXISTS trace_id TEXT;
ALTER TABLE logs ADD COLUMN IF NOT EXISTS cached_tokens INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_logs_org_id ON logs(org_id);
CREATE INDEX IF NOT EXISTS idx_logs_trace_id ON logs(trace_id);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'logs_org_id_fkey'
    ) THEN
        ALTER TABLE logs
        ADD CONSTRAINT logs_org_id_fkey
        FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE SET NULL;
    END IF;
END $$;

-- Organization-level budget alert history.
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

-- Health monitoring history used by the admin dashboard.
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

-- Log details stay separate from the hot log table. We keep the partition key
-- so new writes can reference the parent log row safely.
CREATE TABLE IF NOT EXISTS log_details (
    id SERIAL PRIMARY KEY,
    log_id INTEGER NOT NULL,
    log_created_at TIMESTAMPTZ,
    request_body TEXT,
    response_body TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE log_details ADD COLUMN IF NOT EXISTS log_created_at TIMESTAMPTZ;

UPDATE log_details ld
SET log_created_at = l.created_at
FROM logs l
WHERE ld.log_created_at IS NULL
  AND l.id = ld.log_id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_log_details_log_id ON log_details(log_id);
CREATE INDEX IF NOT EXISTS idx_log_details_log_ref ON log_details(log_id, log_created_at);

-- Note: We intentionally do NOT add a foreign key constraint here because
-- 'logs' is a partitioned table, and PostgreSQL does not support foreign keys
-- referencing partitioned tables. Instead, we rely on application-level
-- consistency (the billing service inserts both log and log_details in the
-- same transaction).
