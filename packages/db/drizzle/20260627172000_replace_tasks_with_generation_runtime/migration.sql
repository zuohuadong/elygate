--> statement-breakpoint
DROP TABLE IF EXISTS "task_logs";
--> statement-breakpoint
DROP TABLE IF EXISTS "tasks";
--> statement-breakpoint
CREATE TABLE "tasks" (
    "id" TEXT PRIMARY KEY,
    "user_id" INTEGER NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "token_id" INTEGER REFERENCES "tokens"("id") ON DELETE SET NULL,
    "channel_id" INTEGER REFERENCES "channels"("id") ON DELETE SET NULL,
    "model" TEXT NOT NULL,
    "type" VARCHAR(50) NOT NULL,
    "status" VARCHAR(30) NOT NULL DEFAULT 'pending',
    "provider_task_id" TEXT,
    "request_body" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "result" JSONB,
    "error" TEXT,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ DEFAULT NOW()
);
--> statement-breakpoint
CREATE INDEX "idx_tasks_user_status" ON "tasks" ("user_id", "status", "created_at" DESC);
--> statement-breakpoint
CREATE INDEX "idx_tasks_status" ON "tasks" ("status", "created_at" DESC);
--> statement-breakpoint
CREATE INDEX "idx_tasks_type" ON "tasks" ("type", "created_at" DESC);
