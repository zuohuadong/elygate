-- Migration: Add User Groups and Compliance Policy Engine
-- Date: 2026-03-11

-- 1. Create user_groups table for policy configuration
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

-- 2. Insert default system groups
INSERT INTO user_groups (key, name, description) 
VALUES ('default', 'Default Group', 'Standard user group') 
ON CONFLICT DO NOTHING;

-- Example: Strict compliance group that blocks specific overseas channels and models
INSERT INTO user_groups (key, name, description, denied_channel_types, denied_models) 
VALUES ('cn-safe', 'Mainland Safe', 'Only allows CN-registered models', '[1, 14, 23]', '["gpt-*", "claude-*", "gemini-*", "sora-*"]') 
ON CONFLICT DO NOTHING;

-- 3. Extend packages with group visibility isolation
ALTER TABLE packages ADD COLUMN IF NOT EXISTS allowed_groups JSONB DEFAULT '[]';

-- Note: We deeply integrate with the existing users."group" column. 
-- It is seamlessly used to match the user_groups.key without requiring risky FK drops.
