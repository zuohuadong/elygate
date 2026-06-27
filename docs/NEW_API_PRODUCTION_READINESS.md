# New API Production Readiness

This document is the production gate for absorbing New API product and protocol capabilities into Elygate while preserving the PostgreSQL-native, Redis-free kernel.

## Current Verdict

Status: `production-ready`

All ten production-readiness capabilities are currently marked production-ready. Full New API compatibility is gated by strict route parity, deployment evidence, PostgreSQL route smokes, and enterprise runtime smoke for the pinned New API snapshot. Production promotion is still a separate operational action that requires explicit target environment, credentials, rollback artifact, and authorization.

The source of truth is `docs/new-api-production-readiness.matrix.json`.

Reference snapshot: `QuantumNous/new-api@6c35e1ef2671be8bd3c230882e4ff5a885e89c57`, checked on 2026-06-27.

## Production-Ready Means

A capability is production-ready only when all of these are true:

1. It is implemented in the Elygate stack without replacing Bun, Elysia, or PostgreSQL.
2. Every public New API route surface remains client-compatible without requiring New API internals.
3. It does not add Redis as a default runtime dependency.
4. Its persistence and migration path are explicit.
5. It has automated tests for request shape, response shape, error behavior, billing/logging side effects, and rollback where applicable.
6. Database-backed or async behavior has a runtime smoke.
7. UI surfaces have typecheck and browser smoke coverage.
8. Production deployment readiness has a documented target profile, secrets checklist, migration plan, backup/restore drill, rollback runbook, and reproducible live smoke evidence; actual production promotion still requires explicit authorization.

## Strict Gate

Use the strict gate when deciding whether the whole absorption program is done:

```bash
bun run check:new-api-production-ready
```

This command must pass before the New API absorption program can be claimed complete.

The non-strict gate is included in root `bun run check`:

```bash
bun run check:new-api-production-readiness
```

It validates that the production-readiness matrix is structurally sound and that the Redis-free platform boundary is still enforced.

Deployment evidence has its own structural gate:

```bash
bun run check:new-api-deployment-evidence
```

The root check also runs the seeded New API route smokes and enterprise runtime smoke. These commands apply temporary PostgreSQL migrations, exercise protocol/admin state routes, build the panel and enterprise console, start a temporary PostgreSQL-backed gateway, verify admin API CRUD, and open authenticated admin/enterprise browser pages:

```bash
bun run smoke:new-api:protocol-db
bun run smoke:new-api:enterprise-route-db
bun run smoke:new-api:task-route-db
bun run smoke:new-api:admin-channel-route-db
bun run smoke:enterprise:runtime
```

Route parity has its own strict completion gate:

```bash
bun run check:new-api-route-parity-strict
```

## Persistence And Rollback Evidence

Files, Batches, Assistants, Threads, Vector Stores, and Fine-tuning state are PostgreSQL-native and are covered by temporary PostgreSQL smoke commands:

```bash
bun run smoke:new-api:protocol-db
bun run smoke:new-api:enterprise-route-db
bun run smoke:new-api:task-route-db
bun run smoke:enterprise:db
```

Relevant migrations are idempotent:

- `packages/db/drizzle/20260614010000_add_file_content/migration.sql` uses `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` for `api_files.content`.
- `packages/db/drizzle/20260614020000_add_assistants_threads_vectorstores/migration.sql` uses `CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS` for OpenAI enterprise-compatible state tables.
- `packages/db/drizzle/20260627143228_remove_semantic_cache/migration.sql` removes the deprecated semantic cache table and options after the request hot path has moved to exact response cache plus PostgreSQL-native state.
- `packages/db/drizzle/20260627172000_replace_tasks_with_generation_runtime/migration.sql` replaces the old admin task table with the PostgreSQL-native generation task runtime table; this is intentionally destructive because legacy task-table compatibility is not a product requirement.

Rollback policy:

1. Roll back the application version and disable the affected routes before accepting new traffic.
2. Preserve PostgreSQL data by default; the forward-compatible app rollback does not require dropping OpenAI enterprise state tables.
3. Only in disposable or fully backed-up environments should a destructive down migration drop `fine_tuning_jobs`, `vector_store_files`, `vector_stores`, `thread_runs`, `thread_messages`, `threads`, `assistants`, and `api_files.content`, in dependency order.
4. After rollback, rerun `bun run smoke:new-api:protocol-db` and the non-strict readiness gate before reopening traffic.

## Release-Time Work Queue

Public recharge is disabled by default as the compliance decision for production readiness; it is enabled only when `PaymentEnabled=true` is explicitly configured and provider webhook signatures pass their sandbox fixtures.

1. Keep `bun run check`, `bun run smoke:new-api:protocol-db`, `bun run smoke:new-api:enterprise-route-db`, `bun run smoke:new-api:task-route-db`, `bun run smoke:new-api:admin-channel-route-db`, `bun run smoke:enterprise:db`, and `bun run smoke:enterprise:runtime` green before a release candidate.
2. Run production promotion and live production smoke only after target environment, credentials, rollback artifact, and authorization are explicit.
