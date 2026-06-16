--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_memories" (
    "id" TEXT PRIMARY KEY,
    "user_id" INTEGER NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "token_id" INTEGER REFERENCES "tokens"("id") ON DELETE CASCADE,
    "org_id" INTEGER REFERENCES "organizations"("id") ON DELETE CASCADE,
    "thread_id" TEXT,
    "scope" TEXT NOT NULL DEFAULT 'user',
    "kind" TEXT NOT NULL DEFAULT 'fact',
    "content" TEXT NOT NULL,
    "content_hash" TEXT NOT NULL,
    "embedding" VECTOR(1024),
    "confidence" DECIMAL(5,4) NOT NULL DEFAULT '1.0000',
    "source_trace_id" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "expires_at" TIMESTAMPTZ,
    "deleted_at" TIMESTAMPTZ,
    "last_read_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE ("user_id", "scope", "kind", "content_hash")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_agent_memories_user_scope" ON "agent_memories" ("user_id", "scope", "deleted_at", "expires_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_agent_memories_token" ON "agent_memories" ("token_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_agent_memories_org" ON "agent_memories" ("org_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_agent_memories_thread" ON "agent_memories" ("thread_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_agent_memories_content_tsv" ON "agent_memories" USING gin (to_tsvector('simple', "content"));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_agent_memories_embedding" ON "agent_memories" USING hnsw ("embedding" vector_cosine_ops);
