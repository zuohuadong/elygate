--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "assistants" (
    "id" TEXT PRIMARY KEY,
    "user_id" INTEGER NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "token_id" INTEGER,
    "object" TEXT DEFAULT 'assistant',
    "name" TEXT,
    "description" TEXT,
    "model" TEXT NOT NULL,
    "instructions" TEXT,
    "tools" JSONB DEFAULT '[]',
    "file_ids" JSONB DEFAULT '[]',
    "metadata" JSONB DEFAULT '{}',
    "temperature" DECIMAL(5,2),
    "top_p" DECIMAL(5,4),
    "status" TEXT DEFAULT 'active',
    "created_at" TIMESTAMPTZ DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ DEFAULT NOW()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "threads" (
    "id" TEXT PRIMARY KEY,
    "user_id" INTEGER NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "token_id" INTEGER,
    "object" TEXT DEFAULT 'thread',
    "metadata" JSONB DEFAULT '{}',
    "tool_resources" JSONB DEFAULT '{}',
    "created_at" TIMESTAMPTZ DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ DEFAULT NOW()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "thread_messages" (
    "id" TEXT PRIMARY KEY,
    "thread_id" TEXT NOT NULL REFERENCES "threads"("id") ON DELETE CASCADE,
    "user_id" INTEGER NOT NULL,
    "object" TEXT DEFAULT 'thread.message',
    "role" TEXT NOT NULL DEFAULT 'user',
    "content" JSONB DEFAULT '[]',
    "assistant_id" TEXT,
    "run_id" TEXT,
    "attachments" JSONB DEFAULT '[]',
    "metadata" JSONB DEFAULT '{}',
    "created_at" TIMESTAMPTZ DEFAULT NOW()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_thread_messages_thread" ON "thread_messages" ("thread_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "thread_runs" (
    "id" TEXT PRIMARY KEY,
    "thread_id" TEXT NOT NULL REFERENCES "threads"("id") ON DELETE CASCADE,
    "assistant_id" TEXT,
    "user_id" INTEGER NOT NULL,
    "object" TEXT DEFAULT 'thread.run',
    "status" TEXT NOT NULL DEFAULT 'queued',
    "model" TEXT,
    "instructions" TEXT,
    "tools" JSONB DEFAULT '[]',
    "metadata" JSONB DEFAULT '{}',
    "temperature" DECIMAL(5,2),
    "top_p" DECIMAL(5,4),
    "max_prompt_tokens" INTEGER,
    "max_completion_tokens" INTEGER,
    "truncation_strategy" JSONB,
    "tool_choice" JSONB,
    "response_format" JSONB,
    "required_action" JSONB,
    "last_error" JSONB,
    "usage" JSONB,
    "started_at" TIMESTAMPTZ,
    "expires_at" TIMESTAMPTZ,
    "cancelled_at" TIMESTAMPTZ,
    "failed_at" TIMESTAMPTZ,
    "completed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ DEFAULT NOW()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_thread_runs_thread" ON "thread_runs" ("thread_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_thread_runs_status" ON "thread_runs" ("status");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "vector_stores" (
    "id" TEXT PRIMARY KEY,
    "user_id" INTEGER NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "token_id" INTEGER,
    "object" TEXT DEFAULT 'vector_store',
    "name" TEXT,
    "file_counts" JSONB DEFAULT '{"in_progress":0,"completed":0,"failed":0,"cancelled":0,"total":0}',
    "status" TEXT DEFAULT 'completed',
    "usage_bytes" BIGINT NOT NULL DEFAULT 0,
    "metadata" JSONB DEFAULT '{}',
    "expires_after" JSONB,
    "expires_at" TIMESTAMPTZ,
    "last_active_at" TIMESTAMPTZ DEFAULT NOW(),
    "created_at" TIMESTAMPTZ DEFAULT NOW()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "vector_store_files" (
    "id" TEXT PRIMARY KEY,
    "vector_store_id" TEXT NOT NULL REFERENCES "vector_stores"("id") ON DELETE CASCADE,
    "file_id" TEXT,
    "object" TEXT DEFAULT 'vector_store.file',
    "status" TEXT DEFAULT 'completed',
    "usage_bytes" BIGINT NOT NULL DEFAULT 0,
    "last_error" JSONB,
    "chunking_strategy" JSONB,
    "created_at" TIMESTAMPTZ DEFAULT NOW()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_vs_files_store" ON "vector_store_files" ("vector_store_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fine_tuning_jobs" (
    "id" TEXT PRIMARY KEY,
    "user_id" INTEGER NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "token_id" INTEGER,
    "object" TEXT DEFAULT 'fine_tuning.job',
    "model" TEXT NOT NULL,
    "training_file" TEXT,
    "validation_file" TEXT,
    "hyperparameters" JSONB DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'validating_files',
    "fine_tuned_model" TEXT,
    "organization_id" TEXT,
    "result_files" JSONB DEFAULT '[]',
    "trained_tokens" INTEGER,
    "error" JSONB,
    "epochs" INTEGER,
    "suffix" TEXT,
    "integrations" JSONB DEFAULT '[]',
    "created_at" TIMESTAMPTZ DEFAULT NOW(),
    "finished_at" TIMESTAMPTZ,
    "updated_at" TIMESTAMPTZ DEFAULT NOW()
);
