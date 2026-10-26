# Management Audit Coverage

Updated: 2026-10-27. This is a coverage inventory, not a claim that every
administrator mutation has transactional audit enforcement.

## Persistence Boundaries

- Control-plane project, application, binding, application-key and budget
  mutations append their control-plane audit row in the mutation transaction.
- Virtual-key governance mutations can append the existing signed governance
  chain when signing is configured. The control-plane feed also reads that
  chain.
- Employee administrator creation, import, update/disable, import rollback and
  password reset now append audit inside the employee mutation transaction.
  Without encryption they write a compact control-plane row; with encryption
  they write the signed governance chain. Each path produces one feed row.
  Missing handler audit wiring or persistence failure rolls the mutation back,
  including bindings, batch state, passwords and session revocations. Unlike
  the post-commit bridge, these failures return an error without exposing a
  new temporary credential.
- Management routes registered by `RegisterAPIRoutes` now persist the upstream
  `RecordAuditChange` records into the control-plane audit table after the
  handler runs. This bridge works without an audit signing key.
- The bridge stores actor, event, resource type, resource ID and UTC timestamp,
  not request bodies, target names or before/after snapshots. Cache resource
  IDs are SHA-256 digests because the key may contain user input.
- Trusted authentication context supplies identity. Auth-disabled or
  whitelisted requests are anonymous. Basic credentials supply an audit-only
  actor after verification; this marker grants no additional permission.
- All recorded changes in one request are inserted in one transaction, in
  batches of 100. A later HTTP error or panic does not erase changes that a
  handler already recorded after committing its mutation.
- Bridge failure logs a content-free error and emits
  `X-Elygate-Audit-Status: failed`, including after panic recovery. It preserves
  the mutation's response, which may contain a one-time credential. It does
  not claim the mutation was rolled back or suggest a blind retry.

## Producer Inventory

The following groups already produce typed upstream change records and are
now consumed by the bridge. Producer inventory is based on current code;
bridge tests do not independently prove every handler's successful and failed
write paths.

| Resource Group | Producer | Verification Boundary |
| --- | --- | --- |
| Providers and provider keys | `providers.go`, `provider_keys.go` | Existing producer tests plus bridge persistence contracts |
| Virtual keys, teams, customers and governance policies | `governance.go` | Existing governance tests; signed and compact rows may both appear |
| Client config, metadata, proxy and pricing sync | `config.go` | Existing producer records; no raw config snapshots persisted by bridge |
| Plugins | `plugins.go` | Existing producer tests; later reload errors must not hide committed changes |
| MCP clients, library and virtual MCPs | `mcp.go`, `virtualmcp.go` | Existing producer records; no credential-bearing snapshots persisted |
| MCP credentials, OAuth consent and sessions | `mcpheaders.go`, `mcpsessions.go`, `mcpoauth2*.go` | Existing producer records; token values excluded by bridge |
| Logs, mappings and recalculation jobs | `logging.go` | Existing producer records |
| Routing and complexity configuration | `routing.go` | Existing producer records |
| Prompts, folders, versions and sessions | `prompts.go` | Existing producer records |
| Skills and uploaded files | `skills.go` | Existing producer records |
| Agents, push configurations and agent logs | `agentgateway.go` | Existing producer records |
| Webhooks, rotation and redelivery | `webhooks.go` | Existing producer tests |
| Feature flags, cache, notification publication and sidekiq cancellation | Respective management handlers | Existing producer records; cache IDs hashed |
| Warp configuration and backfill | `warp.go` | Existing producer records; topic/conversation coverage remains to audit |
| RSS feeds and global news setting | `rssfeeds.go` | Added create/update/delete/setting snapshots, redaction and failure-path tests |
| Employee administrator mutations | `employees/store.go`, `server/employee_audit.go` | Transactional appender; locked update before-state; idempotent import/rollback skip duplicate events; rollback and route regression tests |

## Remaining Acceptance

1. Convert sensitive post-commit producers to mutation-and-audit atomicity or
   a transactional outbox. A process crash between mutation commit and bridge
   persistence can still lose an event.
2. Audit all route mutations against this inventory, including session/admin
   authentication configuration, Warp topics/conversations and future
   upstream routes. No 100% sensitive-route coverage claim is made.
3. Employee login, logout and self-service password changes are outside the
   administrator mutation audit contract. Richer employee change details and
   real PostgreSQL concurrent execution still require separate acceptance;
   focused SQLite tests alone do not prove row-lock behavior.
4. Add request/trace correlation and deliberate outcome/detail contracts,
   including resource-specific snapshot redaction, before storing richer
   events. Deduplicate signed-chain and bridge representations if the feed
   should show one logical row per virtual-key action.
5. Prove real PostgreSQL, deployed runtime, restart/recovery and operator
   visibility acceptance separately from focused SQLite tests.

The broader roadmap remains **Partial**.
