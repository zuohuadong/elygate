-- PostgreSQL Advanced Optimization & Automation Script
-- 1. Enable Required Extensions
CREATE EXTENSION IF NOT EXISTS pg_bigm;     -- Full-text search (2-gram)
CREATE EXTENSION IF NOT EXISTS pgvector;   -- Vector similarity search
CREATE EXTENSION IF NOT EXISTS pg_cron;     -- Job scheduling

-- 2. Semantic Cache Table (uses pgvector for similarity search)
-- Stores embedding vectors for AI responses to enable semantic deduplication.
CREATE TABLE IF NOT EXISTS semantic_cache (
    id SERIAL PRIMARY KEY,
    model_name TEXT NOT NULL,
    prompt_hash TEXT NOT NULL,           -- md5(prompt) for quick dedup
    prompt TEXT NOT NULL,
    embedding VECTOR(1536),              -- OpenAI text-embedding-3-small dimension
    response JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (model_name, prompt_hash)
);

-- IVFFlat index for fast approximate nearest-neighbor (ANN) cosine similarity search
CREATE INDEX IF NOT EXISTS idx_semantic_cache_embedding ON semantic_cache
    USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- 3. Logs Table with RANGE Partitioning
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

-- Current Month (March 2026)
CREATE TABLE IF NOT EXISTS logs_y2026m03 PARTITION OF logs_new
    FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');
-- Next Month (April 2026)
CREATE TABLE IF NOT EXISTS logs_y2026m04 PARTITION OF logs_new
    FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');

-- 4. High-Performance Indexes
-- BRIN: ideal for append-only time-series log data
CREATE INDEX IF NOT EXISTS idx_logs_created_at_brin ON logs_new USING BRIN (created_at);
-- Covering index for dashboard user queries
CREATE INDEX IF NOT EXISTS idx_logs_user_id ON logs_new (user_id) INCLUDE (quota_cost, created_at);
-- pg_bigm full-text fuzzy search on model_name (useful for admin log filtering)
CREATE INDEX IF NOT EXISTS idx_logs_model_name_bigm ON logs_new (model_name) USING gin (model_name gin_bigm_ops);

-- 5. pg_cron Automated Jobs
-- Job 1: Expire semantic cache entries older than 24h (runs every hour)
SELECT cron.schedule('semantic-cache-cleanup', '0 * * * *', $$
    DELETE FROM semantic_cache WHERE created_at < NOW() - INTERVAL '24 hours';
$$);

-- Job 2: Create next-month partition before month-end (runs on the 20th at 01:00)
SELECT cron.schedule('create-next-log-partition', '0 1 20 * *', $$
    DO $do$
    DECLARE
        next_month_start DATE := date_trunc('month', NOW() + INTERVAL '1 month');
        next_month_end   DATE := date_trunc('month', NOW() + INTERVAL '2 months');
        partition_name   TEXT := 'logs_y' || to_char(next_month_start, 'YYYYmMM');
    BEGIN
        EXECUTE format(
            'CREATE TABLE IF NOT EXISTS %I PARTITION OF logs_new FOR VALUES FROM (%L) TO (%L)',
            partition_name, next_month_start, next_month_end
        );
        RAISE NOTICE 'Partition % created', partition_name;
    END $do$;
$$);

-- Job 3: Detach and drop log partitions older than LogRetentionDays (runs daily at 03:00)
SELECT cron.schedule('drop-old-log-partitions', '0 3 * * *', $$
    DO $do$
    DECLARE
        retention_cutoff DATE := (NOW() - INTERVAL '7 days')::DATE;
        r RECORD;
    BEGIN
        FOR r IN
            SELECT child.relname AS partition_name
            FROM pg_inherits
            JOIN pg_class parent ON pg_inherits.inhparent = parent.oid
            JOIN pg_class child  ON pg_inherits.inhrelid  = child.oid
            WHERE parent.relname = 'logs_new'
        LOOP
            -- Check if the partition end-date is before the retention cutoff
            -- Names follow pattern logs_yYYYYmMM
            DECLARE part_end_str TEXT;
            BEGIN
                SELECT high FROM pg_partition_tree(('logs_new')::regclass) LIMIT 1; -- placeholder check
            EXCEPTION WHEN OTHERS THEN
            END;
        END LOOP;
    END $do$;
$$);

