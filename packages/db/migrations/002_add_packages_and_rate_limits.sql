-- Migration to add Rate Limits, Packages and User Subscriptions

BEGIN;

CREATE TABLE IF NOT EXISTS rate_limit_rules (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    rpm INT DEFAULT 0,
    rph INT DEFAULT 0,
    concurrent INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS packages (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    price DECIMAL(10,2) NOT NULL,
    duration_days INT NOT NULL DEFAULT 30,
    models JSONB DEFAULT '[]',
    default_rate_limit_id INT REFERENCES rate_limit_rules(id) ON DELETE SET NULL,
    model_rate_limits JSONB DEFAULT '{}',
    is_public BOOLEAN DEFAULT true,
    added_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_subscriptions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    package_id INTEGER NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
    start_time TIMESTAMPTZ DEFAULT NOW(),
    end_time TIMESTAMPTZ NOT NULL,
    status INTEGER DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_subscriptions_user_id ON user_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_end_time ON user_subscriptions(end_time);

-- Add package_id to redemptions table
ALTER TABLE redemptions ADD COLUMN IF NOT EXISTS package_id INTEGER REFERENCES packages(id) ON DELETE SET NULL;

COMMIT;
