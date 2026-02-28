-- PostgreSQL Advanced Optimization Script
-- This script implements Table Partitioning for the logs table and adds BRIN indexes.

-- 1. Create a new log table with RANGE partitioning
CREATE TABLE IF NOT EXISTS logs_new (
    id SERIAL,
    user_id INTEGER NOT NULL,
    token_id INTEGER,
    channel_id INTEGER,
    model_name TEXT NOT NULL,
    quota_cost BIGINT NOT NULL,
    prompt_tokens INTEGER NOT NULL,
    completion_tokens INTEGER NOT NULL,
    is_stream BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

-- 2. Create historical and future partitions
-- Current Month (March 2026)
CREATE TABLE IF NOT EXISTS logs_y2026m03 PARTITION OF logs_new
    FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');

-- Next Month (April 2026)
CREATE TABLE IF NOT EXISTS logs_y2026m04 PARTITION OF logs_new
    FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');

-- 3. Create High Performance Indexes
-- BRIN index is perfect for time-series data like logs
CREATE INDEX IF NOT EXISTS idx_logs_created_at_brin ON logs_new USING BRIN (created_at);
-- Covering index for common user queries
CREATE INDEX IF NOT EXISTS idx_logs_user_id ON logs_new (user_id) INCLUDE (quota_cost, created_at);

-- 4. Instructions for Manual Migration (Run these within a transaction when ready)
/*
BEGIN;
INSERT INTO logs_new SELECT * FROM logs;
ALTER TABLE logs RENAME TO logs_backup;
ALTER TABLE logs_new RENAME TO logs;
COMMIT;
*/
