CREATE TABLE IF NOT EXISTS "enterprise_org_entitlements" (
    "id" SERIAL PRIMARY KEY,
    "tenant_id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "app_instance_id" TEXT NOT NULL,
    "seat_limit" INTEGER NOT NULL DEFAULT 5,
    "assigned_seats" INTEGER NOT NULL DEFAULT 0,
    "billing_mode" VARCHAR(30) NOT NULL DEFAULT 'prepaid',
    "overage_enabled" BOOLEAN NOT NULL DEFAULT FALSE,
    "overage_unit_price_cents" INTEGER NOT NULL DEFAULT 0,
    "budget_mode" VARCHAR(30) NOT NULL DEFAULT 'hard_limit',
    "default_no_training" BOOLEAN NOT NULL DEFAULT TRUE,
    "data_retention_days" INTEGER NOT NULL DEFAULT 30,
    "provider_compliance_mode" VARCHAR(30) NOT NULL DEFAULT 'strict',
    "allowed_ip_policy" TEXT,
    "status" VARCHAR(30) NOT NULL DEFAULT 'active',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMPTZ DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ DEFAULT NOW()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_enterprise_org_entitlements_scope_unique"
    ON "enterprise_org_entitlements" ("tenant_id", "org_id", "app_instance_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "enterprise_memberships" (
    "id" SERIAL PRIMARY KEY,
    "tenant_id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "app_instance_id" TEXT NOT NULL,
    "user_id" TEXT,
    "email" TEXT,
    "display_name" TEXT,
    "role" VARCHAR(40) NOT NULL DEFAULT 'developer',
    "scopes" JSONB NOT NULL DEFAULT '[]',
    "seat_kind" VARCHAR(30) NOT NULL DEFAULT 'human',
    "seat_status" VARCHAR(30) NOT NULL DEFAULT 'active',
    "invited_by" TEXT,
    "joined_at" TIMESTAMPTZ,
    "last_active_at" TIMESTAMPTZ,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ DEFAULT NOW()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_enterprise_memberships_scope"
    ON "enterprise_memberships" ("tenant_id", "org_id", "app_instance_id", "seat_status");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_enterprise_memberships_user_unique"
    ON "enterprise_memberships" ("tenant_id", "org_id", "app_instance_id", "user_id")
    WHERE "user_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_enterprise_memberships_email_unique"
    ON "enterprise_memberships" ("tenant_id", "org_id", "app_instance_id", "email")
    WHERE "email" IS NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "enterprise_billing_accounts" (
    "id" SERIAL PRIMARY KEY,
    "tenant_id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "app_instance_id" TEXT NOT NULL,
    "billing_name" TEXT NOT NULL,
    "billing_email" TEXT,
    "tax_id" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "payment_terms" VARCHAR(40) NOT NULL DEFAULT 'net_30',
    "status" VARCHAR(30) NOT NULL DEFAULT 'active',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMPTZ DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ DEFAULT NOW()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_enterprise_billing_accounts_scope_unique"
    ON "enterprise_billing_accounts" ("tenant_id", "org_id", "app_instance_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "enterprise_invoices" (
    "id" SERIAL PRIMARY KEY,
    "tenant_id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "app_instance_id" TEXT NOT NULL,
    "billing_account_id" INTEGER REFERENCES "enterprise_billing_accounts"("id") ON DELETE SET NULL,
    "invoice_number" TEXT NOT NULL,
    "period_start" TIMESTAMPTZ NOT NULL,
    "period_end" TIMESTAMPTZ NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "subtotal_cents" BIGINT NOT NULL DEFAULT 0,
    "tax_cents" BIGINT NOT NULL DEFAULT 0,
    "total_cents" BIGINT NOT NULL DEFAULT 0,
    "status" VARCHAR(30) NOT NULL DEFAULT 'draft',
    "due_at" TIMESTAMPTZ,
    "issued_at" TIMESTAMPTZ,
    "paid_at" TIMESTAMPTZ,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ DEFAULT NOW()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_enterprise_invoices_number_unique"
    ON "enterprise_invoices" ("tenant_id", "org_id", "invoice_number");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_enterprise_invoices_scope"
    ON "enterprise_invoices" ("tenant_id", "org_id", "app_instance_id", "period_start" DESC);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "enterprise_invoice_items" (
    "id" SERIAL PRIMARY KEY,
    "invoice_id" INTEGER NOT NULL REFERENCES "enterprise_invoices"("id") ON DELETE CASCADE,
    "item_type" VARCHAR(40) NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(20,4) NOT NULL DEFAULT '1',
    "unit_amount_cents" BIGINT NOT NULL DEFAULT 0,
    "amount_cents" BIGINT NOT NULL DEFAULT 0,
    "source_type" VARCHAR(40),
    "source_id" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ DEFAULT NOW()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_enterprise_invoice_items_invoice"
    ON "enterprise_invoice_items" ("invoice_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "enterprise_metered_usage" (
    "id" SERIAL PRIMARY KEY,
    "tenant_id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "app_instance_id" TEXT NOT NULL,
    "subject_kind" VARCHAR(40) NOT NULL DEFAULT 'org',
    "subject_id" TEXT,
    "metric" VARCHAR(40) NOT NULL DEFAULT 'quota',
    "quantity" BIGINT NOT NULL DEFAULT 0,
    "unit_amount_cents" INTEGER NOT NULL DEFAULT 0,
    "amount_cents" BIGINT NOT NULL DEFAULT 0,
    "source_log_id" INTEGER,
    "invoice_id" INTEGER REFERENCES "enterprise_invoices"("id") ON DELETE SET NULL,
    "occurred_at" TIMESTAMPTZ DEFAULT NOW(),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ DEFAULT NOW()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_enterprise_metered_usage_scope"
    ON "enterprise_metered_usage" ("tenant_id", "org_id", "app_instance_id", "occurred_at" DESC);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "enterprise_provider_compliance" (
    "id" SERIAL PRIMARY KEY,
    "tenant_id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "app_instance_id" TEXT NOT NULL,
    "provider_kind" VARCHAR(60) NOT NULL,
    "provider_id" TEXT NOT NULL,
    "display_name" TEXT,
    "no_training" BOOLEAN NOT NULL DEFAULT FALSE,
    "zero_retention" BOOLEAN NOT NULL DEFAULT FALSE,
    "region" TEXT,
    "status" VARCHAR(30) NOT NULL DEFAULT 'review',
    "evidence_url" TEXT,
    "reviewed_by" TEXT,
    "reviewed_at" TIMESTAMPTZ,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ DEFAULT NOW()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_enterprise_provider_compliance_unique"
    ON "enterprise_provider_compliance" ("tenant_id", "org_id", "app_instance_id", "provider_kind", "provider_id");
