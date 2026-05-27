ALTER TABLE users ADD COLUMN IF NOT EXISTS billing_preference TEXT NOT NULL DEFAULT 'subscription_first';
ALTER TABLE users ADD COLUMN IF NOT EXISTS quota_display_type TEXT NOT NULL DEFAULT 'USD';
--> statement-breakpoint

ALTER TABLE packages ADD COLUMN IF NOT EXISTS subtitle TEXT;
ALTER TABLE packages ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'USD';
ALTER TABLE packages ADD COLUMN IF NOT EXISTS duration_unit TEXT NOT NULL DEFAULT 'day';
ALTER TABLE packages ADD COLUMN IF NOT EXISTS duration_value INTEGER NOT NULL DEFAULT 30;
ALTER TABLE packages ADD COLUMN IF NOT EXISTS custom_seconds BIGINT NOT NULL DEFAULT 0;
ALTER TABLE packages ADD COLUMN IF NOT EXISTS total_amount BIGINT NOT NULL DEFAULT 0;
ALTER TABLE packages ADD COLUMN IF NOT EXISTS quota_reset_period TEXT NOT NULL DEFAULT 'never';
ALTER TABLE packages ADD COLUMN IF NOT EXISTS quota_reset_custom_seconds BIGINT NOT NULL DEFAULT 0;
ALTER TABLE packages ADD COLUMN IF NOT EXISTS enabled BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE packages ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE packages ADD COLUMN IF NOT EXISTS stripe_price_id TEXT;
ALTER TABLE packages ADD COLUMN IF NOT EXISTS creem_product_id TEXT;
ALTER TABLE packages ADD COLUMN IF NOT EXISTS waffo_pancake_product_id TEXT;
ALTER TABLE packages ADD COLUMN IF NOT EXISTS max_purchase_per_user INTEGER NOT NULL DEFAULT 0;
ALTER TABLE packages ADD COLUMN IF NOT EXISTS upgrade_group TEXT;
--> statement-breakpoint

ALTER TABLE user_subscriptions ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'order';
ALTER TABLE user_subscriptions ADD COLUMN IF NOT EXISTS amount_total BIGINT NOT NULL DEFAULT 0;
ALTER TABLE user_subscriptions ADD COLUMN IF NOT EXISTS amount_used BIGINT NOT NULL DEFAULT 0;
ALTER TABLE user_subscriptions ADD COLUMN IF NOT EXISTS next_reset_at TIMESTAMPTZ;
ALTER TABLE user_subscriptions ADD COLUMN IF NOT EXISTS upgrade_group TEXT;
ALTER TABLE user_subscriptions ADD COLUMN IF NOT EXISTS prev_user_group TEXT;
--> statement-breakpoint

ALTER TABLE redemptions ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE redemptions ADD COLUMN IF NOT EXISTS used_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE redemptions ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
ALTER TABLE redemptions ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS subscription_orders (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    package_id INTEGER NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
    amount INTEGER NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'USD',
    money DECIMAL(10,2) NOT NULL DEFAULT 0,
    trade_no TEXT NOT NULL UNIQUE,
    payment_method TEXT NOT NULL,
    payment_provider TEXT NOT NULL DEFAULT '',
    transaction_id TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    provider_payload TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_subscription_orders_user_id ON subscription_orders(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_subscription_orders_status ON subscription_orders(status, created_at DESC);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS topup_logs (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    payment_order_id INTEGER REFERENCES payment_orders(id) ON DELETE SET NULL,
    subscription_order_id INTEGER REFERENCES subscription_orders(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    payment_method TEXT,
    payment_provider TEXT,
    amount BIGINT NOT NULL DEFAULT 0,
    money DECIMAL(10,2) NOT NULL DEFAULT 0,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_topup_logs_user_id ON topup_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_packages_enabled_sort ON packages(enabled, sort_order DESC, id DESC);
