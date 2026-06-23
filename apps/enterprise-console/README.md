# Elygate Enterprise Console

This svadmin-based console is the enterprise UI layer for Elygate.

It is intentionally separate from `apps/admin`:

- `apps/admin` remains the general Elygate Panel for channels, models, API keys, usage, logs, and settings.
- `apps/enterprise-console` handles SupAuth claims, SupaCloud app lifecycle, enterprise policy, tenant isolation, usage budgets, and audit views.

## Development

```bash
bun --cwd apps/enterprise-console dev
```

The dev server runs on port `5175`.

## Production

```bash
bun --cwd apps/enterprise-console build
```

The gateway serves the built console from `/enterprise/`.

## Auth

The console expects a SupAuth JWT in `localStorage.supauth_token`.

Required Elygate platform claims:

```text
tenant_id
org_id
app_id
app_instance_id
roles
scopes
entitlements_version
```

## Resource Screens

The console reads and mutates the enterprise control plane directly:

- Enterprise overview: `/api/enterprise/overview`
- Gateway instances: `/api/enterprise/gateway-instances` with status updates
- Identity and policy: `/api/enterprise/identity-and-policy` and `/api/enterprise/identity-policies` with policy creation
- Usage and budgets: `/api/enterprise/usage-and-budget` and `/api/enterprise/budgets` with budget creation/status updates
- Audit events: `/api/enterprise/audit-events`

All requests send the SupAuth bearer token. Gateway `sk-*` API keys are data-plane credentials and are not accepted by this console.

## Database Smoke

When a real PostgreSQL database is available:

```bash
bun run smoke:enterprise:db
```

The smoke runs from the gateway enterprise composition layer and verifies migration, install projection, instance update, identity policy create, budget create, platform event projection, and audit reads.
