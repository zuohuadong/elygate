# New API Absorption Plan

## Decision

Elygate keeps its current PostgreSQL-native kernel. New API is used as a product and protocol reference, not as the runtime kernel to fork or replace.

Selected public API surfaces should be compatible where compatibility reduces customer migration cost. New API runtime compatibility is a non-goal: Elygate must not adopt New API database internals, Redis requirements, queue/cache assumptions, or deployment topology to achieve that API compatibility.

This preserves the existing Elygate stack boundary:

- Basic Gateway: Bun, Elysia, PostgreSQL, pg-boss, and PostgreSQL-native cache/rate-limit/listen primitives.
- Panel and Enterprise: absorb mature operation surfaces from New API where they fit Elygate ownership boundaries.
- Redis-free remains a product and deployment differentiator. Redis must not become a default runtime dependency.

## Source Snapshot

New API reference checked on 2026-06-27:

- Repository: `QuantumNous/new-api`
- Commit: `6c35e1ef2671be8bd3c230882e4ff5a885e89c57`
- Evidence reviewed: feature table, API support list, deployment database requirements, and Redis cache configuration in `README.zh_CN.md`.

The latest snapshot lists the product areas worth tracking: dashboard/statistics, token groups and model limits, recharge/quota allocation, OAuth/OIDC login, OpenAI Responses/Realtime, Claude Messages, Gemini, Rerank, Midjourney/Suno task-style providers, weighted routing, failure retry, and user-level model rate limits.

## Absorption Matrix

The machine-readable source of truth is `docs/new-api-absorption.matrix.json`.

Use it for each New API parity task:

1. Pick one `domains[].id`.
2. Add or update `elygateEvidence` before changing behavior.
3. Implement the smallest reversible PostgreSQL-native slice.
4. Add route, handler, migration, smoke, or UI tests matching the domain.
5. Keep `redisFreeGate` true before marking the slice done.

## Engineering Gates

Every absorbed capability must pass these gates:

- Existing Elygate stack wins unless the user explicitly asks for a migration.
- Every public New API route surface must either be implemented compatibly or tracked as a strict-gate blocker.
- New API runtime, database, Redis, queue, and cache internals are not compatibility targets.
- PostgreSQL is the default persistence and coordination system.
- Redis server/client/cache packages are forbidden as default runtime dependencies.
- `@postgresx/noredis` stays a pilot until the ADR gates pass.
- Hot-path changes to auth, rate limit, billing, cache, queue, or LISTEN/NOTIFY require benchmark, feature parity check, feature flag, runtime smoke, rollback note, and `bun run check`.
- Protocol work must verify request shape, response shape, streaming behavior when applicable, and billing/logging side effects.

## Phase 1 Closure

The Phase 1 compatibility debt is closed for the pinned New API snapshot:

1. Protocol parity has golden tests for Responses compact behavior, streaming status propagation, files content retrieval, billing/logging normalization, and pg-boss batch execution.
2. Route parity is closed in `docs/new-api-route-parity.matrix.json`; root `bun run check` now runs `bun run check:new-api-route-parity-strict`.
3. Operations parity has regression tests for channel copy, upstream model sync, key strategy, status-code mapping, retry group selection, and rate-limit accounting.
4. Provider breadth covers Claude, Gemini, Dify/custom upstream mapping, and task-style media routes through PostgreSQL job state and pg-boss-compatible boundaries.
5. Identity and billing keep public recharge behind explicit compliance/product configuration while covering enterprise quota, subscription lifecycle, webhook idempotency, and payment signature fixtures.
6. Security controls are mapped to Panel/Enterprise ownership with mocked email/captcha/OIDC/two-factor/passkey tests and PostgreSQL-backed session/revocation state.

The remaining work is maintenance, not a blocker for the pinned compatibility gate: keep scheduled upstream drift monitoring green and add new provider/product slices only when there is active customer need.

## Upstream Drift Monitoring

Pinned route compatibility is checked by `bun run check:new-api-route-parity-strict`.

Use the networked upstream monitor for scheduled CI or manual refresh checks:

```bash
bun run check:new-api-upstream-routes
```

That command fetches `QuantumNous/new-api`, parses the pinned router source files, and fails when upstream `HEAD` differs from the matrix snapshot or when any extracted route is not covered by an exact or wildcard matrix pattern. It is intentionally not part of root `bun run check` because it depends on GitHub availability.

CI runs `.github/workflows/new-api-public-api-sync.yml` on a daily schedule and by manual dispatch. It fetches the selected `QuantumNous/new-api` ref, writes `public-api-sync-report.json` as a workflow artifact, and fails when any public upstream route is not covered by `docs/new-api-route-parity.matrix.json`. Scheduled runs allow pinned commit drift when route coverage still passes, so ordinary upstream commits do not block the compatibility signal.

To produce the same JSON report locally:

```bash
bun run scripts/check-new-api-upstream-routes.ts --allow-newer-commit --report-path artifacts/new-api/public-api-sync-report.json
```

When GitHub is unavailable, validate the parser and coverage against the cached reference checkout:

```bash
bun run scripts/check-new-api-upstream-routes.ts --offline
```

## Verification

Run:

```bash
bun run check:new-api-absorption
```

The root `bun run check` includes this gate, so drift in the absorption matrix or accidental Redis runtime dependencies fails locally before release.
