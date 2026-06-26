--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "enterprise_gateway_instances" (
    "id" SERIAL PRIMARY KEY,
    "tenant_id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "app_id" TEXT NOT NULL,
    "app_instance_id" TEXT NOT NULL,
    "project_id" TEXT,
    "status" VARCHAR(30) NOT NULL DEFAULT 'provisioning',
    "public_base_url" TEXT,
    "admin_base_url" TEXT,
    "database_url_secret_name" TEXT,
    "supauth_issuer_url" TEXT,
    "supauth_jwks_url" TEXT,
    "supauth_audience" TEXT,
    "entitlements_version" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ DEFAULT NOW()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_enterprise_gateway_instances_unique"
    ON "enterprise_gateway_instances" ("tenant_id", "org_id", "app_instance_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_enterprise_gateway_instances_scope"
    ON "enterprise_gateway_instances" ("tenant_id", "org_id", "status");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "enterprise_identity_policies" (
    "id" SERIAL PRIMARY KEY,
    "tenant_id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "app_instance_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "target_kind" VARCHAR(40) NOT NULL DEFAULT 'org',
    "target_id" TEXT,
    "effect" VARCHAR(20) NOT NULL DEFAULT 'allow',
    "rules" JSONB NOT NULL DEFAULT '{}',
    "status" VARCHAR(30) NOT NULL DEFAULT 'active',
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMPTZ DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ DEFAULT NOW()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_enterprise_identity_policies_scope"
    ON "enterprise_identity_policies" ("tenant_id", "org_id", "app_instance_id", "status");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "enterprise_budgets" (
    "id" SERIAL PRIMARY KEY,
    "tenant_id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "app_instance_id" TEXT NOT NULL,
    "subject_kind" VARCHAR(40) NOT NULL DEFAULT 'org',
    "subject_id" TEXT,
    "period" VARCHAR(30) NOT NULL DEFAULT 'monthly',
    "limit_quota" BIGINT NOT NULL DEFAULT 0,
    "used_quota" BIGINT NOT NULL DEFAULT 0,
    "alert_threshold_pct" INTEGER NOT NULL DEFAULT 80,
    "reset_at" TIMESTAMPTZ,
    "status" VARCHAR(30) NOT NULL DEFAULT 'active',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMPTZ DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ DEFAULT NOW()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_enterprise_budgets_scope"
    ON "enterprise_budgets" ("tenant_id", "org_id", "app_instance_id", "status");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "enterprise_audit_events" (
    "id" SERIAL PRIMARY KEY,
    "tenant_id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "app_instance_id" TEXT NOT NULL,
    "actor_type" VARCHAR(40) NOT NULL DEFAULT 'user',
    "actor_id" TEXT,
    "action" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "resource_id" TEXT,
    "details" JSONB NOT NULL DEFAULT '{}',
    "ip_address" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ DEFAULT NOW()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_enterprise_audit_events_scope"
    ON "enterprise_audit_events" ("tenant_id", "org_id", "app_instance_id", "created_at" DESC);
