# Management Audit Coverage

Updated: 2026-10-27. This is a coverage inventory, not a claim that every
administrator mutation has transactional audit enforcement.

## Persistence Boundaries

- Control-plane project, application, binding, application-key and budget
  mutations append their control-plane audit row in the mutation transaction.
- Dashboard password-verified login and explicit logout use a narrow
  ConfigStore wrapper injected only into SessionHandler. Session creation or
  deletion commits with `dashboard_session.created/deleted` in the same
  transaction; audit failure rolls the session mutation back. Resource IDs
  are SHA-256 token digests captured before encryption, never tokens or
  ciphertext. Creation and valid-session deletion use fixed `local-admin`;
  expired-session deletion is anonymous. Empty, unknown, ciphertext and
  repeated logout tokens add no event. Public write errors contain no database
  diagnostics. This does not audit bulk FlushSessions, setup/WS tickets,
  failed login attempts or employee sessions.
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
- Employee self-service password changes now update credentials, revoke other
  existing sessions and append `employee.password_changed` in one transaction.
  A conditional employee write rechecks the verified password hash and active
  state before locking and revalidating the retained, unexpired session.
  Expiry is compared as a decoded Go time after locking the matching session;
  SQLite timestamp text with different UTC offsets is not used for ordering.
  Missing self-service audit wiring, write/audit failure or context cancellation
  before commit rolls the mutation back. A lost database commit acknowledgement
  remains an indeterminate result, not proof of rollback. Compact and signed
  events use `employee:<id>` from the
  authenticated employee, not administrator markers, headers or JSON fields.
  No password, hash, session or CSRF value is included in the event.
- Employee password-verified login conditionally locks the employee with the
  verified hash and active state, then rejects a live lockout using a typed
  time comparison under that lock before updating login
  metadata, inserting the session and appending `employee_session.created`
  in one transaction. Reset/change/disable uses the same employee-first
  ordering: either login is rejected or the later mutation revokes its
  committed session. Explicit logout locks employee then the matching
  authenticated session and commits deletion with `employee_session.deleted`;
  an already-deleted snapshot is a no-op without another event. Resource IDs
  are random session UUIDs, never token digests or credential content.
  Missing audit wiring and write/audit failures fail closed. Authentication
  query errors return 500 without clearing recovery cookies; unknown/expired
  credentials retain the 401 cleanup boundary. Cookies are issued/cleared only
  after successful login/logout commit. Signed events use fixed internal
  `employee-password` or `employee-session` metadata with the employee actor,
  never request-supplied administrator identity. A lost commit acknowledgement
  remains indeterminate. Failed-login audit, automatic expiry cleanup and
  per-session events for bulk revocation are not covered by these events.
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
- Dashboard authentication config saves produce `auth_config.updated` for
  `auth_config/dashboard` after the save callback succeeds, before session
  invalidation. The producer snapshot whitelists only `is_enabled`,
  `username_configured` and `password_configured` booleans; usernames,
  passwords, hashes, secret references and setup/current passwords are not
  included. No actual save or a failed save produces no authentication event.
  The bridge still stores identities only, not these snapshots.
- Warp background-job records distinguish `warp_backfill.started/cancelled`
  from `warp_topics.started/cancelled`, with matching resource types. A
  successful enqueue or actual cancellation records one event, including when
  the response reread fails; a rejected start or terminal no-op does not.
- Explicit Warp conversation deletion records `warp_conversation.deleted`
  only after the existing owner-scoped store deletion succeeds. Its producer
  includes the conversation ID only; no title, owner ID, transcript, tool
  arguments or error content is read or copied into the audit snapshot.
  Conversation data remains in the log store and audit in the config store:
  these are not one atomic transaction.
- Bridge failure logs a content-free error and emits
  `X-Elygate-Audit-Status: failed`, including after panic recovery. It preserves
  the mutation's response, which may contain a one-time credential. It does
  not claim the mutation was rolled back or suggest a blind retry.

## Producer Inventory

The following groups produce typed upstream change records consumed by the
bridge or transactional compact rows read by the same feed. Inventory is based on current code;
bridge tests do not independently prove every handler's successful and failed
write paths.

| Resource Group | Producer | Verification Boundary |
| --- | --- | --- |
| Providers and provider keys | `providers.go`, `provider_keys.go` | Existing producer tests plus bridge persistence contracts |
| Virtual keys, teams, customers and governance policies | `governance.go` | Existing governance tests; signed and compact rows may both appear |
| Client config, metadata, proxy and pricing sync | `config.go` | Existing producer records; no raw config snapshots persisted by bridge |
| Dashboard administrator authentication config | `config.go`, `auditchange.go` | Successful-save producer; first setup, enable/disable, credential changes/preservation, rejected/failed save and post-save session-flush failure regressions; real authenticated route/bridge and SQLite reopen coverage |
| Dashboard administrator login and explicit logout | `controlplane/sessionaudit.go`, SessionHandler-only server wiring | Transactional session and audit writes; registered login/logout and protected feed, rollback and error redaction, encrypted/upstream plaintext lookup, concurrent valid/expired logout and real close/reopen regressions on SQLite and PostgreSQL |
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
| Warp configuration, backfill and topic clustering | `warp.go` | Explicit per-kind identities; focused race regressions cover start/restart, explicit/implicit/repeated cancel, post-write reread failures, rejected/failed writes, authenticated audit-feed routes and SQLite reopen |
| Explicit Warp conversation deletion | `warpconversations.go` | ID-only successful-deletion producer; 14 new leaf scenarios cover ownership, failure, repeated-delete, auth/bridge/feed and SQLite reopen; all 53 Warp top-level tests pass with race detection, handlers vet and metadata-record microbenchmark pass |
| RSS feeds and global news setting | `rssfeeds.go` | Added create/update/delete/setting snapshots, redaction and failure-path tests |
| Employee administrator mutations | `employees/store.go`, `server/employee_audit.go` | Transactional appender; locked update before-state; idempotent import/rollback skip duplicate events; rollback and route regression tests |
| Employee self-service password changes | `employees/store.go`, separate self-service handler/server appender | SQLite/PostgreSQL race regressions for conditional credentials, retained-session UTC-offset validity, rollback and concurrent changes; real Commit cancellation and SQLite close/reopen; limiter completion and compact/signed identity |
| Employee password-verified login and explicit logout | `employees/store.go`, self-service handler/server appender | Atomic metadata/session/audit failure matrix; stale admission and reset/change/disable lock orderings; concurrent logout uniqueness; real Commit cancellation and SQLite reopen; registered compact/signed lifecycle and feed guard tests. Execution evidence is recorded separately in employee-session results |

The final 2026-10-27 employee candidate passes 37 SQLite top-level tests and
103 subtests with race detection. The same employee binary passes the
PostgreSQL password/session selection: 18 PostgreSQL top-level tests and
82 subtests, plus 5 explicitly SQLite-only top-level tests and 12 subtests.
Server employee audit race tests, focused vet, source checksums and independent
source review pass. Private test databases were cleaned and both successful
private PostgreSQL instances were stopped. Detailed candidate identity and
limits are retained in `.codex-tmp/employee-session-results-20261027.json`.
These disposable clusters disable crash-durability settings; they prove
transaction/locking behavior, not deployed backup or crash recovery.

## Remaining Acceptance

1. Convert sensitive post-commit producers to mutation-and-audit atomicity or
   a transactional outbox. A process crash between mutation commit and bridge
   persistence can still lose an event.
2. Audit all route mutations against this inventory, including the remaining
   session lifecycle and future upstream routes. Password-verified dashboard
   login and explicit logout now have transactional audit; bulk FlushSessions
   after auth-config changes, failed logins and setup/WS tickets do not.
   Explicit Warp conversation deletion
   now has a producer; creation/chat turns and automatic retention are not
   covered by that deletion event. Topic start/cancel now have distinct
   identities; job execution and automatic discovery are not covered by those
   request-level records. Dashboard administrator config saves and conversation
   deletion remain subject to the post-commit crash window above.
   No 100% sensitive-route coverage claim is made.
3. Employee login, explicit logout and self-service password changes now have
   transactional implementations. Failed-login audit, automatic expiry cleanup
   and per-session events for bulk reset/disable/change remain outside their
   event contracts. Richer employee change details and PostgreSQL coverage of
   the remaining employee-administration paths still require separate
   acceptance; focused SQLite tests alone do not prove row locks. Session feed
   tests inject the administrator marker at the guard, not a full management
   credential-authentication chain or live-network acceptance.
4. Add request/trace correlation and deliberate outcome/detail contracts,
   including resource-specific snapshot redaction, before storing richer
   events. Deduplicate signed-chain and bridge representations if the feed
   should show one logical row per virtual-key action.
5. Prove real PostgreSQL, deployed runtime, restart/recovery and operator
   visibility acceptance separately from focused SQLite tests.
6. Add the repository-required provider-harness management-audit cases after
   scenario/fixture approval. Current Go regressions exercise registered
   management routes in-process, including the HTTP audit-feed shape, but do
   not replace that collection's coverage or a live network run.

The broader roadmap remains **Partial**.
