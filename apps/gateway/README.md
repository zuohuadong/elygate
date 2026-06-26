# Elygate Gateway

This is the high-performance API gateway for the Elygate project, built with [Elysia.js](https://elysiajs.com/) and running on the [Bun](https://bun.sh/) runtime.

## Features

- **Blazing Fast**: Leverages Bun's native asynchronous I/O and Elysia's optimized routing.
- **Semantic Caching**: Integrated vector similarity search using `pgvector` to deduplicate and cache expensive AI requests.
- **Atomic Billing**: O(1) batch processing eliminates SQL lock contention for high-throughput accounting.
- **Enterprise Control Plane**: optional `/api/enterprise/*` routes for SupaCloud install/uninstall callbacks, SupAuth claims, app manifest, lifecycle events, resources, and health. Gateway `sk-*` keys remain data-plane only, with an enterprise runtime guard registered through the basic runtime governance hook when enterprise instance identity is configured.

## Development

To run the gateway in development mode with hot-reloading:

```bash
cd ../.. # Go to project root
bun run dev
```

Alternatively, from within this directory:

```bash
bun install
bun run dev
```

## Enterprise Mode

Enterprise mode is enabled by SupaCloud/SupAuth environment variables:

```bash
ELYGATE_LAYER=enterprise
ELYGATE_APP_INSTANCE_ID=agi_xxx
ELYGATE_TENANT_ID=tenant_xxx
ELYGATE_ORG_ID=org_xxx
ELYGATE_PUBLIC_BASE_URL=https://gateway.example.com
ELYGATE_ADMIN_BASE_URL=https://gateway.example.com/enterprise/
SUPAUTH_ISSUER_URL=https://auth.example.com
SUPAUTH_JWKS_URL=https://auth.example.com/.well-known/jwks.json
SUPAUTH_AUDIENCE=http://localhost:3000
```

Production requires `SUPAUTH_JWKS_URL`; unsigned development JWTs are accepted only outside production when `ENTERPRISE_AUTH_MODE` is not `strict`.

When `ELYGATE_LAYER=enterprise`, `ELYGATE_TENANT_ID`, `ELYGATE_ORG_ID`, and `ELYGATE_APP_INSTANCE_ID` are set, the gateway installs the enterprise runtime guard. The guard reads only Elygate enterprise projection tables, blocks inactive instances, policy denies, and budget limit denies before cache/upstream dispatch, lazily rolls over due enterprise budget periods, records successful request quota back into matched enterprise budgets after core billing succeeds, and records budget warnings as audit/log signals without letting the basic dispatcher depend on SupaCloud or SupAuth internals.

Enterprise resource APIs are claims-scoped by `tenant_id` and `org_id`:

- `GET /api/enterprise/manifest`
- `GET /api/enterprise/health`
- `GET /api/enterprise/me`
- `POST /api/enterprise/install`
- `POST /api/enterprise/uninstall`
- `POST /api/enterprise/events`
- `GET /api/enterprise/overview`
- `GET|POST|PUT /api/enterprise/gateway-instances`
- `GET /api/enterprise/identity-and-policy`
- `GET|POST|PUT /api/enterprise/identity-policies`
- `POST /api/enterprise/policy-evaluations`
- `GET /api/enterprise/usage-and-budget`
- `GET /api/enterprise/usage-attribution`
- `GET|POST|PUT /api/enterprise/budgets`
- `POST /api/enterprise/budget-evaluations`
- `GET /api/enterprise/provider-channels`
- `GET /api/enterprise/model-routes`
- `GET /api/enterprise/gateway-api-keys`
- `GET /api/enterprise/request-logs`
- `GET /api/enterprise/agent-memories`
- `GET /api/enterprise/audit-events`
- `GET /api/enterprise/audit-events/export`

Gateway `sk-*` keys are rejected by these control-plane routes and remain valid only for data-plane AI requests.

To verify the enterprise migration and Postgres-backed control-plane CRUD against a real local database:

```bash
bun run smoke:enterprise:db
```

The smoke reads `DATABASE_URL` from the project root `.env`, applies migrations, exercises the enterprise control-plane projection tables, verifies due budget rollover before evaluation, verifies filtered audit export, and removes its smoke rows unless `KEEP_ENTERPRISE_SMOKE_DATA=1` is set.

## Postgresx Pilot Bridge

The gateway includes a narrow `@postgresx/noredis` bridge in `src/services/postgresxInfra.ts`.
It is currently a non-invasive pilot entry point for future Postgres-native cache, metrics, outbox,
and migration-alias experiments.

Current boundaries:

- It is not enabled on the request hot path.
- It does not create new PostgreSQL tables during startup.
- `bun --cwd apps/gateway test:postgresx` verifies package import, Bun SQL adapter wiring, Elygate namespace/table prefix defaults, and L1 cache settings.
- Production rollout should be gated by a real `DATABASE_URL` benchmark and a feature flag before replacing existing auth, rate-limit, billing, or cache paths.

The full replacement gate is tracked in `../../docs/ARCHITECTURE_DECISIONS.md`.
