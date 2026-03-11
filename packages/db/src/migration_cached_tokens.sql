-- Migration script to add cached_tokens to the logs table
-- Used for recording Prompt Caching usage (OpenAI/Anthropic)

-- 1. Add the column to the partitioned logs master table
ALTER TABLE logs ADD COLUMN IF NOT EXISTS cached_tokens INTEGER NOT NULL DEFAULT 0;

-- Note: In PostgreSQL 11+, adding a column with a constant default to a partitioned table 
-- automatically propagtes to all partitions efficiently without a full table rewrite.

-- 2. Materialized view recalculation is not required yet unless we expose cached_tokens in dashboards.
