-- Patch: Add mj_tasks table for Midjourney Proxy Integration

CREATE TABLE IF NOT EXISTS mj_tasks (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    uuid VARCHAR(64) UNIQUE NOT NULL,    -- MJ Task ID returned by upstream
    action VARCHAR(32) NOT NULL,         -- IMAGINE, U1, V2, REROLL, etc.
    prompt TEXT NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'SUBMITTED', -- SUBMITTED, IN_PROGRESS, SUCCESS, FAILED
    image_url TEXT,
    progress VARCHAR(16) DEFAULT '0%',
    fail_reason TEXT,
    submit_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    start_time TIMESTAMP,
    finish_time TIMESTAMP
);

-- Index for fast lookup by UUID (for Webhook and Status polling)
CREATE INDEX IF NOT EXISTS idx_mj_tasks_uuid ON mj_tasks(uuid);

-- Index for fast lookup by User ID (for user's task history)
CREATE INDEX IF NOT EXISTS idx_mj_tasks_user_id ON mj_tasks(user_id);
