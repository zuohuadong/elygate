-- Phase 8: Organization alerting
-- Keeps alerting concerns isolated from the core enterprise domain migration.

ALTER TABLE organizations ADD COLUMN IF NOT EXISTS alert_webhook_url TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS alert_threshold_pct INTEGER;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS last_alert_at TIMESTAMPTZ;

UPDATE organizations
SET alert_threshold_pct = COALESCE(alert_threshold_pct, quota_alarm_threshold, 80)
WHERE alert_threshold_pct IS NULL;

ALTER TABLE organizations
    ALTER COLUMN alert_threshold_pct SET DEFAULT 80;
