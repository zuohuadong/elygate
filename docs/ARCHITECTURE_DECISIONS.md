# Elygate Architecture Decisions

## ADR-2026-06-23-01: Keep Three Product Layers

Status: accepted

Elygate remains a three-layer monorepo:

- Basic Gateway: OpenAI-compatible data plane, provider routing, billing, rate limit, cache, memory, and background workers.
- Panel: general svadmin-based gateway administration for standalone and private deployments.
- Enterprise: SupaCloud + SupAuth + svadmin control plane for app lifecycle, identity, policy, budget, audit, and gateway-instance governance.

Enterprise code may live in `apps/gateway/src/enterprise/*`, `apps/enterprise-console`, and `packages/enterprise-*`. Basic gateway hot-path modules and the general Panel must not import enterprise packages directly. The only basic data-plane integration point is the neutral runtime governance hook in `apps/gateway/src/services/runtimeGovernance.ts`.

## ADR-2026-06-23-02: Enterprise Resource Views Are Projection Views

Status: accepted

Enterprise resource APIs under `/api/enterprise/*` use SupAuth scopes and return a `gateway_instance` scope object. Core gateway tables predate SupAuth tenancy, so resource APIs distinguish two boundaries:

- `gateway_instance_projection`: rows are filtered by available projection keys such as numeric `org_id`, `project_id`, or `app_instance_id` mapped to existing core columns.
- `global_provider_catalog`: provider channels and model routes are gateway-level catalogs, not tenant-owned rows.

This avoids claiming stronger isolation than the current schema can prove. Org-scoped views that only have legacy numeric `org_id` columns must return an empty page when SupAuth `org_id` cannot be projected to a positive integer; they must not silently fall back to an unscoped table scan. Request logs may also use `project_id` / `app_instance_id` as workspace projection keys. If strict tenant isolation is required later, add explicit `tenant_id` / `app_instance_id` ownership columns or a projection table before exposing write operations.

Enterprise runtime governance is intentionally fail-closed when enterprise mode is fully configured. If the gateway can build data-plane claims but cannot read the enterprise projection tables, requests fail with HTTP 503 instead of bypassing policy or budget checks. Production rollout must therefore run enterprise migrations and the control-plane smoke before routing traffic to an enterprise-enabled gateway.

## ADR-2026-06-23-03: Standardize Cache Dependencies on `@postgresx/noredis`

Status: accepted

Cache-related third-party runtime dependencies must converge on `@postgresx/noredis`.
Do not add `lru-cache`, Redis clients, cache-manager adapters, or other cache libraries to runtime packages.
If Elygate needs a missing cache primitive, add it upstream to `@postgresx/noredis` first and then consume the released package.

`@postgresx/noredis` is present as a narrow gateway bridge in `apps/gateway/src/services/postgresxInfra.ts`. It must not replace authentication, rate limit, billing, response cache, pg-boss jobs, or LISTEN/NOTIFY paths until all gates pass:

- benchmark against the existing PostgreSQL-native implementation on a representative `DATABASE_URL`;
- feature parity check for TTL, cleanup, invalidation, concurrency, queue behavior, and failure semantics;
- feature flag or reversible adapter boundary for one subsystem at a time;
- runtime smoke proving no startup schema creation happens without explicit opt-in;
- rollback note and `bun run check` evidence.

Until those gates pass, the existing PostgreSQL-native code remains the production hot path.
Local in-memory business indexes are still allowed when they are not external dependencies and remain derived from PostgreSQL state.
