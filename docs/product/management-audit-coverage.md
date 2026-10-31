# Management Audit Coverage

Updated: 2026-10-31. This is a coverage inventory, not a claim that every
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
  diagnostics. This wrapper does not globally replace ConfigStore; setup/WS
  ticket issuance uses the bridge below and employee sessions are handled
  separately.
- Successful setup-session and WebSocket-ticket issuance record
  `dashboard_setup_session.created` for `dashboard_setup_session/setup` and
  `dashboard_ws_ticket.created` for `dashboard_ws_ticket/ws-ticket` through the
  post-handler bridge. Producers use empty names and nil snapshots, never
  tokens, tickets, cookies, hashes or expiry data. Rejected or unavailable
  issuance records no success event. Setup-token and auth-bypassed requests
  are anonymous throughout the bridge; verified session identity is frozen
  before issuance. Setup-session events are anonymous even in mixed batches.
  Basic-only callers still cannot request a WS ticket.
- WS-ticket audit uses a two-second database context instead of the normal
  thirty-second budget, leaving time to use the existing thirty-second
  ticket. Audit failure or timeout preserves the issued response and adds
  `X-Elygate-Audit-Status: failed`; it does not reissue credentials or extend
  their expiry. Credential issuance and audit are not atomic and retain a
  crash window. Signed tickets remain reusable within their lifetime;
  in-memory tickets retain their single-consumption behavior. Auth-disabled
  enterprise issuance adds anonymous synchronous database writes without a
  new limiter or automatic audit retention. No inference-path changes or
  new resident credential cache are introduced.
- Dashboard credential rejections use the existing post-handler bridge:
  username mismatch, hash-comparison error and password mismatch each record
  one `dashboard_session.login_failed` event for `dashboard_session/dashboard`.
  The producer uses an empty name and nil snapshots. The bridge forces this
  event to `anonymous`, even on API-key/enterprise authentication chains, without
  changing adjacent events' identity. No username, password, hash, cookie,
  supplied identity or diagnostic is persisted. Malformed payloads,
  missing/disabled authentication, config lookup errors and session write
  failures do not produce this event. Audit failure preserves the original 401
  body, adds `X-Elygate-Audit-Status: failed` and logs a content-free error.
  This synchronous per-attempt transaction increases unauthenticated database
  writes (including wrong usernames without bcrypt work); it does not add
  automatic audit retention or a crash-safe outbox.
- The production dashboard session handler limits parsed login attempts to
  five per connection-source IP in a rolling fifteen-minute window, before its
  configuration lookup, password comparison, session write or failure producer.
  Username changes and forwarded-IP headers cannot reset the budget. A denied
  request returns 429 without an audit event; malformed JSON remains 400 before
  limiting (the existing missing-store 403 still takes precedence). Admitted
  requests retain their existing 200/401/403/500 behavior, and every admitted
  attempt consumes budget, including successful login or storage failure.
  State is process-local and caps tracked sources at 4096; a full map rejects
  new sources rather than evicting live budgets, while known sources retain
  their remaining attempts. At capacity, expired-bucket sweeping runs at most
  once per second, so freed capacity may take one second to become available.
  Source IPs and at most five timestamps per source are held only in bounded
  memory, not persisted by this limiter. Proxy/NAT users share the connection
  source's budget; capacity saturation can deny new sources until expiry,
  restart resets budgets, and replicas do not share counters. This is not
  a distributed abuse-prevention or audit-retention guarantee.
- Auth-config changes use a separate, narrowly injected ConfigHandler
  session-flush callback. A single bulk DELETE and one
  `dashboard_sessions.flushed` event for `dashboard_session/all` commit in the
  same transaction, only when rows were actually removed. Empty/repeated
  flushes add no event. The operation includes expired sessions and never
  loads/decrypts token content; no token, digest, ciphertext or per-session
  event is included. Trusted request metadata retains the pre-change
  Basic/session identity; bypassed, anonymous and setup-token callers are
  anonymous. SQL uses a separate bounded standard context, not RequestCtx.
  Public errors are content-free. Delete/audit failure or cancellation before
  commit rolls back the session deletion, not the already-saved authentication
  config, its in-memory publication or its post-commit `auth_config.updated`
  producer. A lost commit acknowledgement remains indeterminate, not proof
  that either transaction outcome occurred. This is an
  aggregate deletion contract, not a login-admission barrier: concurrently
  created sessions are bounded by the DELETE statement's visibility, as with
  upstream FlushSessions. Other direct ConfigStore callers remain unchanged.
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
  remains indeterminate. Automatic expiry cleanup and per-session events for
  bulk revocation are not covered by these events.
- Employee credential rejections now append the fixed anonymous
  `employee_session.login_failed` event without request identity, username,
  credentials or correlation headers. Audit failure preserves 401 and any
  already committed lockout counter, while exposing the audit-failure header.
  Counter and audit use separate transactions with a crash window. Connection
  source IP admission is bounded to 4096 keys and five attempts per fifteen
  minutes; it is process-local, not distributed protection. See
  [the scoped acceptance record](employee-login-failure-audit.md).
- Management routes registered by `RegisterAPIRoutes` now persist the upstream
  `RecordAuditChange` records into the control-plane audit table after the
  handler runs. This bridge works without an audit signing key.
- The bridge stores actor, event, resource type, resource ID and UTC timestamp,
  not request bodies, target names or before/after snapshots. Cache resource
  IDs are SHA-256 digests because the key may contain user input.
- Compact control-plane rows now retain optional bounded `request_id` and
  exported lowercase W3C `trace_id` values. Request correlation is frozen when
  the bridge starts, propagated through native mutation and dashboard-session
  transactions, and preserved when signed governance rows are projected into
  the feed. Invalid, oversized, private trace-store and raw `traceparent`
  values are omitted rather than copied or truncated. Historical rows remain
  unchanged through the additive v11 migration.
- Correlation is metadata, never authentication evidence; callers must not
  put credentials into request IDs. At most 160 bytes of identifier content
  are retained per event, excluding database/JSON overhead, with no resident
  cache. On the local Apple M4, `BenchmarkAuditCorrelation` measured absent
  metadata at 79.02 ns/op, 0 B/op, 0 allocs/op; present metadata at 108.4 ns/op,
  128 B/op, 4 allocs/op; rejected metadata at 78.31 ns/op, 144 B/op, 1 alloc/op.
  This extraction/context benchmark is not an end-to-end SQL benchmark.
  The inference path is unchanged.
- The nine focused correlation tests pass with race detection on SQLite and
  a private PostgreSQL instance, covering migration/idempotence, bridge
  batches/panics, signed projection, native mutations, transaction rollback
  and dashboard sessions. Panel tests (295), type checking and isolated Vite
  build pass. The local network/browser and graceful-restart evidence below
  supplements these tests; deployed migration and crash recovery remain
  separate acceptance boundaries.
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
| Dashboard credential rejection | `handlers/session.go`, management audit bridge | Three fixed-metadata producers; anonymous event attribution even with API-key/verified actor context, mixed-batch identity isolation, unchanged 401 and audit-failure header, repeated attempts, no created session and protected feed regressions |
| Dashboard session invalidation after administrator auth-config changes | `controlplane/sessionaudit.go`, ConfigHandler-only flush callback | Aggregate event atomic with actual deletion; focused SQLite/PostgreSQL transaction, authenticated-route and reopen regressions pass, with SQLite server-route integration; evidence and local benchmark conditions in the 2026-10-29 product-roadmap follow-up; does not make config save and invalidation one transaction |
| Plugins | `plugins.go` | Existing producer tests; later reload errors must not hide committed changes |
| MCP clients, library and virtual MCPs | `mcp.go`, `virtualmcp.go` | Existing producer records; no credential-bearing snapshots persisted |
| MCP credentials, OAuth consent and sessions | `mcpheaders.go`, `mcpsessions.go`, `mcpoauth2*.go` | Existing producer records; token values excluded by bridge |
| Logs, mappings and recalculation jobs | `logging.go` | Existing producer records |
| Routing and complexity configuration | `routing.go` | Existing producer records |
| Prompts, folders, versions and sessions | `prompts.go` | All 11 cache-reloading mutations record the committed change before cache refresh; SQLite race and private PostgreSQL route matrices cover success, refresh panic, rejected writes, audit failure, authenticated feed and redaction. A process crash before bridge persistence remains outside this boundary |
| Skills and uploaded files | `skills.go` | Update (serve/save-only) and version-shift record the committed mutation before response reread, filling the sanitized after snapshot only when available; 18 SQLite and private PostgreSQL race cases cover success, reread error/panic, rejected writes, audit failure and authenticated feed. Other file lifecycle paths retain their existing producer boundary |
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

## Local Correlation Runtime Acceptance

Follow-up `audit-correlation-live-visibility`: parent is the request/trace
correlation implementation, source is the correlation visibility gap in this
inventory, and reason is to verify persisted metadata through a real browser
and a newly started backend process. Native orchestration, low risk, one
writer and no external verifier were selected for this local validation-only
scope. No production request-path or authentication code was changed.

On 2026-10-29, source commit `0e38df3d5` was rebuilt into an isolated executable
using the production `Bootstrap`/`Start` path. A separately rebuilt panel used
its existing same-origin Vite proxy. All listeners were loopback-only, the
administrator password was random and supplied over stdin, and the SQLite
database lived under `.codex-tmp/`. No model provider, paid inference,
production deployment or provider-harness collection was used.

- With the backend stopped, the disposable audit table was reconstructed into
  a synthetic v10-shaped schema and given one historical row. Current
  Bootstrap added the v11 columns and retained that row without inventing
  correlation; the migration record remained unique after another restart.
  This is a synthetic migration fixture, not a real deployed-v10 upgrade.
- A real browser logged in through the panel, then issued same-origin fetch
  mutations for project/application creation, application-key creation,
  rotation and revocation, both budget scopes, binding/revocation/rebinding,
  and a disabled routing-rule creation through the management bridge. Each
  audit row retained its distinct Request ID and verified `local-admin`
  identity. These are browser network/API tests, not interaction coverage of
  every resource form. The 128-byte Request ID boundary survived unchanged;
  absent and markup IDs were omitted. Supplied `traceparent` and inbound
  `x-bifrost-trace-id` did not become trusted Trace IDs.
- After graceful shutdown, the checkpointed SQLite rows were compared with
  the observed feed. A new backend process reopened the same database and
  returned every pre-restart event with identical IDs, timestamps, actors and
  correlation values. The existing authenticated session still worked.
  Browser logout then revoked feed access, persisted
  `dashboard_session.deleted` with its own Request ID, and was visible after
  another real login. Final shutdown and `PRAGMA integrity_check` passed.
- The actual audit feed rendered Request-only records and historical rows
  without either field. Seeded SQLite display fixtures separately verified
  Trace-only/both-field rendering and malicious-text escaping; the latter
  bypassed normal producer validation deliberately. No script/image was
  inserted, and no injected code ran. **Trace ID visibility here is a display
  fixture, not end-to-end tracing evidence**: default management routes do
  not generate an exported Trace ID.
- At 1440x1000, 375x812 and 812x375 in both themes with reduced motion,
  the page width stayed within the viewport, table scrolling fully exposed
  the correlation cell, and the 128-byte identifier wrapped without cell
  overflow. Screenshots were inspected. Measured label/identifier contrast
  was 7.38:1 / 14.70:1 in light mode and 7.47:1 / 16.30:1 in dark mode.
  Browser page errors were zero. The unchanged panel also passed all 295
  tests (1528 assertions), zero-error/zero-warning Svelte checking and an
  isolated Vite build.

Evidence: `.codex-tmp/audit-correlation-live-report.json` contains the source
commit, executable/source hashes, three backend process identities, mutation
matrix, contrast values and viewport measurements. Runtime and driver sources
are `.codex-tmp/audit-correlation-live-runtime.go` and
`.codex-tmp/audit-correlation-live.mjs`. The six viewport/theme images are
`output/playwright/audit-correlation-live-{light,dark}-{1440,375,812}.png`;
two additional `audit-correlation-fixtures-{light,dark}-375.png` images show
the explicitly seeded display cases.

This is **PASS_SCOPED local SQLite visibility and graceful-restart evidence**.
It does not establish real exported management tracing,
abrupt-crash/whole-machine recovery, production migration, complete
sensitive-route coverage or transactional-outbox acceptance.

## Local PostgreSQL Correlation Runtime Acceptance

Follow-up `audit-correlation-postgres-visibility` is the PostgreSQL companion
to `audit-correlation-live-visibility`. Its parent is the same request/trace
correlation implementation; its source is the remaining PostgreSQL browser
visibility boundary; its reason is to prove that the production
`Bootstrap`/`Start` path uses PostgreSQL stores through a real panel session
and preserves the feed across independent process restarts. Native
orchestration, low risk, one writer and no external verifier were selected.
No production request-path or authentication code was changed.

The run began on 2026-10-29 and completed on 2026-10-30 (Asia/Shanghai).
Source commit `aadb59c48` was rebuilt into an isolated executable; the
unchanged panel reused the isolated build from the SQLite run above.
A private PostgreSQL 18.4 instance used Unix socket-only access,
host authentication rejection and default `fsync`, `synchronous_commit` and
`full_page_writes` settings. Separate random config and log databases were
created; the runtime opened both through the production configuration and
created no SQLite fallback files.

- Anonymous access to the audit feed returned 401. A real Chromium session
  then exercised project/application creation, application-key creation,
  rotation and revocation, project/application budgets,
  virtual-key binding/revocation/rebinding and a disabled routing-rule
  management bridge. The 13 mutation cases retained distinct Request IDs and
  `local-admin` actors in PostgreSQL; login, logout and relogin lifecycle
  events were checked separately.
- A 128-byte Request ID survived unchanged. Missing, markup, and overlong
  identifiers were omitted; supplied `traceparent` and inbound
  `x-bifrost-trace-id` were not promoted to trusted Trace IDs. Direct SQL
  rows matched the browser feed on IDs, actors, actions, resources, timestamps
  and correlation fields.
- The backend and PostgreSQL were stopped and started independently. The
  authenticated session and every pre-restart event reappeared unchanged.
  Seeded Trace-only/both/missing display fixtures rendered without HTML
  injection. Logout persisted `dashboard_session.deleted` with its Request ID;
  a fresh login saw it, and a final PostgreSQL restart retained both events.
- At 1440x1000, 375x812 and 812x375 in light and dark themes with reduced
  motion, the table scrolled internally, the long identifier wrapped, and the
  document had no horizontal overflow. Page errors were zero; all backend,
  PostgreSQL, browser, preview-server and database cleanup exits were
  successful.

Evidence: `.codex-tmp/audit-correlation-postgres-live-report.json` records
the source/executable hashes, two backend runs, three PostgreSQL runs,
12 named checks, layout measurements and cleanup state. The driver and
runtime sources are `.codex-tmp/audit-correlation-postgres-live.mjs` and
`.codex-tmp/audit-correlation-postgres-runtime.go`; six screenshots are
`output/playwright/audit-correlation-postgres-{light,dark}-{1440,375,812}.png`.

This is **PASS_SCOPED local PostgreSQL browser correlation and graceful
restart evidence**. It does not establish real exported management tracing,
abrupt-crash/whole-machine recovery, production migration, complete
sensitive-route coverage or transactional-outbox acceptance.

## Remaining Acceptance

1. Convert sensitive post-commit producers to mutation-and-audit atomicity or
   a transactional outbox. A process crash between mutation commit and bridge
   persistence can still lose an event.
2. Audit all route mutations against this inventory, including the remaining
   session lifecycle and future upstream routes. Password-verified dashboard
   login, explicit logout and auth-config-triggered bulk deletion now have
   transactional audit implementations. Failed dashboard credential attempts
   now have anonymous bridge events, still subject to the process-crash window
   before audit persistence. Successful setup-session and WS-ticket issuance
   now have bridge events with the same crash window; rejected issuance,
   ticket consumption and automatic expiry remain outside those contracts.
   Login admission
   against concurrent credential changes is not serialized
   by the bulk deletion event.
   Explicit Warp conversation deletion
   now has a producer; creation/chat turns and automatic retention are not
   covered by that deletion event. Topic start/cancel now have distinct
   identities; job execution and automatic discovery are not covered by those
   request-level records. Dashboard administrator config saves and conversation
   deletion remain subject to the post-commit crash window above.
   No 100% sensitive-route coverage claim is made.
3. Employee login, explicit logout and self-service password changes now have
   transactional implementations. Employee failed-login audit, automatic expiry cleanup
   and per-session events for bulk reset/disable/change remain outside their
   event contracts. Richer employee change details and PostgreSQL coverage of
   the remaining employee-administration paths still require separate
   acceptance; focused SQLite tests alone do not prove row locks. Session feed
   tests inject the administrator marker at the guard, not a full management
   credential-authentication chain or live-network acceptance.
4. Add deliberate outcome/detail contracts, including resource-specific
   snapshot redaction, before storing richer events. Deduplicate signed-chain
   and bridge representations if the feed should show one logical row per
   virtual-key action; request/trace correlation is implemented and has local
   SQLite and PostgreSQL browser/restart evidence above. Real exported
   management tracing and deployed-runtime evidence remain under item 5.
5. Prove deployed runtime, abrupt-crash/recovery and operator visibility
   acceptance separately from focused local tests. Local SQLite and PostgreSQL
   correlation visibility and graceful process restart now pass; real exported
   management tracing, production migration, abrupt-crash recovery and
   production acceptance do not follow from that evidence.
6. Add the repository-required provider-harness management-audit cases after
   scenario/fixture approval. Current Go regressions exercise registered
   management routes in-process, including the HTTP audit-feed shape, but do
   not replace that collection's coverage or a live network run.

The broader roadmap remains **Partial**.
