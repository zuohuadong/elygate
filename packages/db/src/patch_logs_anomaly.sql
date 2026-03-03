-- Add IP and Error status to logs table
ALTER TABLE logs ADD COLUMN IF NOT EXISTS ip TEXT;
ALTER TABLE logs ADD COLUMN IF NOT EXISTS status_code INTEGER DEFAULT 200;
ALTER TABLE logs ADD COLUMN IF NOT EXISTS error_message TEXT;

-- Create an index for anomaly monitoring performance
CREATE INDEX IF NOT EXISTS idx_logs_errors ON logs (created_at DESC, status_code) WHERE status_code >= 400;
