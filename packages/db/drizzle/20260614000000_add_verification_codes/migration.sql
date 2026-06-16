--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "verification_codes" (
    "id" SERIAL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "user_id" INTEGER REFERENCES "users"("id") ON DELETE CASCADE,
    "ip_address" TEXT,
    "consumed" BOOLEAN NOT NULL DEFAULT FALSE,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ DEFAULT NOW()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_verification_codes_target" ON "verification_codes" ("type", "target") WHERE "consumed" = FALSE;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_verification_codes_user" ON "verification_codes" ("user_id") WHERE "user_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_verification_codes_expiry" ON "verification_codes" ("expires_at");
