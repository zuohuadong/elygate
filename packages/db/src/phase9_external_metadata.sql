-- Phase 9: External Metadata and Idempotency Support

-- 1. Add external metadata fields to logs table
ALTER TABLE logs ADD COLUMN IF NOT EXISTS external_task_id TEXT;
ALTER TABLE logs ADD COLUMN IF NOT EXISTS external_user_id TEXT;
ALTER TABLE logs ADD COLUMN IF NOT EXISTS external_workspace_id TEXT;
ALTER TABLE logs ADD COLUMN IF NOT EXISTS external_feature_type TEXT;

-- 2. Create idempotency_keys table
CREATE TABLE IF NOT EXISTS idempotency_keys (
    id SERIAL PRIMARY KEY,
    key_hash TEXT NOT NULL UNIQUE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    response_code INTEGER,
    response_body JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
);

-- Index for expiration cleanup
CREATE INDEX IF NOT EXISTS idx_idempotency_keys_expires_at ON idempotency_keys(expires_at);

-- Index for user-specific lookups
CREATE INDEX IF NOT EXISTS idx_idempotency_keys_user_key ON idempotency_keys(user_id, key_hash);

-- 3. Update existing log partitions (optional but recommended for consistency)
-- Note: In PostgreSQL, adding columns to the parent table propagates to partitions.
-- However, if partitions were created manually without inheritance (unlikely here given PARTITION BY RANGE), they might need manual updates.
-- Based on init.sql, they are standard partitions.

-- 4. Add indexes for external fields to improve reconciliation performance
CREATE INDEX IF NOT EXISTS idx_logs_external_task_id ON logs(external_task_id);
CREATE INDEX IF NOT EXISTS idx_logs_external_user_id ON logs(external_user_id);
