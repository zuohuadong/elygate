-- Migration: Switch from pg_bigm to pg_trgm for PG18 stability
-- Date: 2026-03-11

-- 1. Create the new extension
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 2. Drop the old bigm index
DROP INDEX IF EXISTS idx_logs_model_bigm;

-- 3. Create the new trigram index
-- Note: Requires logs to have data to build effectively
CREATE INDEX IF NOT EXISTS idx_logs_model_trgm ON logs USING gin (model_name gin_trgm_ops);

-- 4. Clean up old extension (optional, only if sure no other indexes use it)
-- DROP EXTENSION IF EXISTS pg_bigm;
