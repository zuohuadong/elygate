-- Patch: Add Phase 7 Advanced Security fields

-- Add IP Whitelist to tokens. Comma separated list of IPs or CIDR blocks.
-- If NULL or empty, allow all.
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS subnet TEXT;

-- Add rate limiting to tokens to protect upstream (requests per minute max)
-- 0 means inherited from user group or unlimited
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS rate_limit INTEGER NOT NULL DEFAULT 0;

-- Track concurrent connections at the user level (New-API Parity)
ALTER TABLE users ADD COLUMN IF NOT EXISTS max_ips INTEGER NOT NULL DEFAULT 0; -- 0 means no limit

-- Alter channels table to track consecutive test failures for auto-disable
ALTER TABLE channels ADD COLUMN IF NOT EXISTS test_errors INTEGER NOT NULL DEFAULT 0;
