# Control Plane Tests

The default package suite uses a fresh SQLite store per test:

```sh
cd transports
GOWORK=off go test -count=1 ./bifrost-http/controlplane
```

Run the same contracts against a real PostgreSQL server from the repository
root. PostgreSQL binaries and Go must be on `PATH`; alternatively set
`POSTGRES_BIN` to the PostgreSQL `bin` directory. The runner uses the checked-in
module manifests with `GOWORK=off`, not an optional local workspace:

```sh
bash scripts/test-controlplane-postgres.sh
bash scripts/test-controlplane-postgres.sh -race -timeout=15m
```

Additional `go test` flags are forwarded unchanged. The longer timeout gives
race-instrumented migrations time to finish on slower storage.

The runner initializes a private local cluster, disables TCP listeners, and
uses a directory-restricted Unix socket without passwords. Every test creates
a randomly named database, opens the production configstore migration/runtime
pools, and closes those pools before dropping only its own database.
An explicitly selected PostgreSQL backend fails on setup or migration errors;
it never falls back to SQLite or silently skips.

The runner checks for leaked test databases and stops its PostgreSQL process
on success or failure. Logs and stopped database files remain in the printed
artifact directory. Set `TMPDIR` to select an artifact volume; its path must
be short enough for Unix sockets. No existing database or Docker daemon is used.

This covers package-level migration, key lifecycle, audit, usage projection,
reconciliation, filters and summary contracts. It does not establish real
provider, browser, production deployment, or whole-deployment recovery acceptance.

### PostgreSQL Backup/Restore Acceptance

The PostgreSQL suite also includes a real custom-format `pg_dump` / `pg_restore`
replay. Both tools must be on `PATH` (or in `POSTGRES_BIN`); the runner fails
before starting its cluster if either is missing. Run only recovery and the
existing migration regression with:

```sh
bash scripts/test-controlplane-postgres.sh -race -timeout=15m \
  -run '^Test(PostgresControlPlaneBackupRestore|ControlPlaneMigrationIsIdempotent)$'
```

This creates only fresh test-owned databases on the runner's private Unix
socket. The fixture persists selected client settings, project/application
budgets, active and revoked expiring keys, projected synthetic usage, a
checkpoint and administrator audit. It dumps the committed state, changes
source settings after the dump, then restores into another fresh database.
Reopening through the production configstore/controlplane migrations must
preserve the snapshot, key material digests, expiry/revocation and full usage
totals. A new budgeted project verifies continued writes and sequence allocation;
the source must retain its independent post-backup settings.

A deliberate owned-table conflict must fail `pg_restore --single-transaction
--exit-on-error` and leave only the unchanged preexisting sentinel table, with
no partially created application schema. Restore never uses `--clean` or
`--create`. Command connections are explicit; inherited `PG*` options and
password prompting cannot redirect the tool. Archives use mode 0600 inside
`t.TempDir` and are deleted during test cleanup. Test assertions compare key
digests, never raw key values; tool diagnostics that could expose row contents
are not printed.

The default SQLite suite explicitly skips this PostgreSQL-only test. A selected
PostgreSQL backend must not skip or fall back on missing tools or database
errors. This is an isolated local recovery check, not an operator restore
utility or production drill. It does not back up a separately configured source
log database, ClickHouse, file/object storage, deployment configuration or
external encryption/signing secrets. A database snapshot cannot recover changes
after its backup point, including later key revocations. Production RPO,
cross-store coordination, encryption-key recovery, versions and go-live gates
remain separate requirements.

Final-source validation on 2026-10-27 passed both PostgreSQL top-level tests
and both recovery subcases with `-race`, without failures, skips or race
reports. The runner's leaked-database check and normal cluster shutdown passed.
The same retained race binary passed the default SQLite migration regression
and explicitly skipped the PostgreSQL-only recovery test. Scoped `go vet`,
Go formatting, shell syntax, missing-tool preflight and diff checks also passed.
No dump archive remained after cleanup. This was targeted validation, not the
full repository suite, and no production recovery was performed.

## Usage Query And Export

```text
GET /api/control-plane/usage
GET /api/control-plane/usage/summary
GET /api/control-plane/usage/export
```

All three administrator routes share project/application, `user_id`, `provider`,
`model`, session/tree, agent, subagent/fork and RFC3339 `[start_time, end_time)`
filters. The new user/provider/model values are exact, case-sensitive identities:
no trimming, case folding, wildcard expansion or SQL interpolation. An omitted
or empty value does not filter that dimension, including rows with a null user.
There is no special null-user-only selector.

List pagination does not constrain summary totals. CSV ignores `limit`/`offset`
and exports the filtered rows from offset zero, up to the existing 100,000-row
ceiling; larger result sets are not a complete export. CSV includes `user_id`;
null users produce an empty cell. Text beginning with `=`, `+`, `-` or `@`,
including after spaces, tabs, CR/LF or BOM, is prefixed with an apostrophe for
spreadsheet safety. Numeric token and cost columns are not rewritten.

The independent panel retains these dimensions for apply, Enter submission,
refresh, pagination and export, and clears them on reset. Editing any dimension
invalidates older in-flight list/summary results. A summary error does not
discard a successful list or fabricate totals. Budget status/history and alerts
remain scoped to project/application, not the ledger's user/provider/model,
session or time filters.

Registered-route tests compare paginated lists with full summaries and exports,
including exact whitespace, special characters, wildcard/SQL-looking literals,
null users and filter intersections. Browser API fixtures check interaction and
responsive behavior; they do not prove a real backend-to-browser or provider
end-to-end flow.

Validation on 2026-10-27 passed 106 top-level SQLite package tests and 11 focused
PostgreSQL tests with `-race`, including the same 14 new dimension cases on both
backends. There were no failures, skips or race reports. The private PostgreSQL
runner checked for leaked test databases and shut down normally. Control-plane
vet, formatting and scoped review also passed. Provider-harness coverage still
requires approved scenarios/fixtures; this local validation is not that gate.

## Usage Budget APIs

Project and application alert budgets are optional USD amounts. Creation
requests accept `daily_budget` and `monthly_budget`; existing resources use:

```text
PUT /api/control-plane/projects/{project_id}/budgets
PUT /api/control-plane/applications/{application_id}/budgets
```

The body is a full replacement, for example
`{"daily_budget":10,"monthly_budget":200}`. Omitted or null windows are cleared;
`{}` clears both. Zero, negative and non-finite amounts are rejected. Updates
require the existing authenticated administrator, JSON and same-origin write
guards. An audit failure rolls back the budget update. Unknown fields, null
bodies and trailing JSON are rejected so a misspelled amount cannot clear an
existing budget silently.

```text
GET /api/control-plane/usage/budgets?project_id=...&application_id=...
GET /api/control-plane/budget-alerts?project_id=...&application_id=...&limit=100&offset=0
```

Status returns configured windows, UTC calendar `[period_start, period_end)`
bounds, ledger cost, limit and `healthy`, `warning` or `exceeded` state. A
project filter includes that project's application budgets. An application
filter returns only that application's budgets, not its whole project's.
Daily windows begin at midnight UTC; monthly windows begin on the first day
of the month. Costs from all terminal outcomes and all keys in the scope
count; session/detail pagination and arbitrary usage time filters do not
reduce the budget total. With configured budgets, status reads reconcile usage
and fail if the source is missing or fails, rather than presenting an unavailable
source as zero. With no budgets, status reads return an empty array without
accessing the usage source.

The monitor reconciles scopes with current or previously configured budgets
on startup and every minute. It
emits durable events at 80% and 100%, including both on a jump past the limit.
The unique scope/window/period/threshold key suppresses duplicates across
retries, concurrent monitors and restarts. Stored events preserve their
original observed usage and limit; later repricing, budget edits or clearing
do not rewrite history or retrigger the same threshold in that period.
Comparisons allow eight binary floating-point ULPs of representation noise,
without rounding costs to cents.

This is post-settlement alerting over the Usage Ledger, not a
second budget enforcement engine. Bifrost Virtual Key/governance budgets still
own request blocking. Panel budget creation, replacement, clearing, status and
alert history are available in the control-plane page. Closed-period analytics
are available through the history API below; forecasting remains incomplete.

### Budget Alert Acknowledgement

```text
PUT /api/control-plane/budget-alerts/{alert_id}/acknowledgement
{"acknowledged":true}
```

An explicit `false` undoes acknowledgement. The body must contain only this
required boolean; missing/null values, unknown or duplicate keys and trailing
JSON are rejected. IDs must be canonical UUIDs. The existing real-administrator,
JSON and Host-origin guards apply; missing alerts return 404. This route works
without an available usage log source.

Both the mutation response and every GET alert row contain a complete alert
view with required `acknowledged`, `acknowledged_at` and `acknowledged_by`
fields. Acknowledgement times use UTC microsecond precision. Unacknowledged
rows have false and two explicit nulls. The current single administrator
account uses the server-selected `local-admin` identity
across Basic authentication and sessions; client identity fields cannot select
the actor. This is shared alert operation state, not multi-user read receipts.

The additive v9 table references the immutable alert with ON DELETE CASCADE.
Alert row locking, state mutation and audit form one transaction. Retries retain
the first confirmation time and do not duplicate audit. Actual transitions
record `budget-alert.acknowledge` / `budget-alert.unacknowledge` against the
`budget-alert` resource. Failed audit persistence rolls back the transition.
The migration refuses a destructive rollback; older binaries ignore the table.

Acknowledgement does not resolve a breach, suppress later periods, alter
enforcement or change alert amounts, notification read state or delivery outbox.
The panel keeps in-flight writes independent of view lifetime and waits for
them before loading a new scope. Uncertain write responses stay unknown until
a fresh read; no optimistic acknowledgement is reported.

Final-source validation on 2026-10-27 passed the 103-test SQLite package suite
and nine PostgreSQL acknowledgement tests using the same retained race binary.
The private PostgreSQL cluster had no leaked test databases and stopped normally.
The final independent panel suite passed 269 tests, with zero Svelte diagnostics
and a successful isolated production build.

A local authenticated production-runtime/browser replay also passed using
isolated SQLite stores and official synthetic usage-log writes. The monitor
generated four project/application threshold alerts without budget-page reads.
Real browser confirm/undo, Basic retry idempotency, commit followed by response
loss, authoritative refresh and restart persistence passed. Anonymous writes
returned 401; authenticated foreign-Origin writes returned 403. Vite preserves
the browser Host rather than weakening the backend origin guard. Stopped-store
inspection confirmed four alerts, one acknowledgement, three transition audits,
zero notification-read receipts and four delivered notifications. Desktop and
375px screenshots were inspected. This does not establish real-provider billing,
PostgreSQL-to-browser, production migration or backup/recovery acceptance.

### Historical Budget Periods

Budgeted project/application creation and full budget replacements persist
policy revisions in the resource transaction, together with the audit event
when applicable. Clearing a budget records an explicit null revision. Revision
times use UTC microsecond precision, with the increasing ID breaking ties.
Current periods use the current limits. Closed periods use the final revision
strictly before period end, including a clearing revision: null disables that
window rather than falling back to an older non-null limit. Clearing a budget
after a period closes does not erase that period's known policy.

Ledger inserts, amount corrections, timestamp moves and complete-snapshot
deletions atomically queue affected project/application UTC days and months.
Timestamp moves queue both old and new periods without changing the request's
original ownership. Repeated changes share one durable pending row per
scope/window/period. Open periods remain queued until they close, even without
another ledger change.

Each evaluation consumes at most 64 closed periods in chronological order.
Reconciliation, policy writes and evaluation share the projection lock;
alerts, notification outbox rows and pending-row removal commit together.
Errors roll back the batch for retry, and pending work survives restarts.
Existing alerts and notification payloads remain immutable on upward or
downward corrections; only a newly crossed threshold creates a new event.

The additive v7 migration seeds only limits known at migration time, not
invented policies for earlier closed periods. Both new tables are retained
on binary rollback; schema rollback refuses to discard history or pending work.
After all current limits are cleared, prior non-null policy history keeps
source reconciliation enabled so late settlements are still discovered.
Deployments with no non-null budget history skip that source scan. The
64-period bound applies to evaluation, not to the source reconciliation scan.

### Historical Budget Analysis

```text
GET /api/control-plane/usage/budgets/history?window=daily&start_time=2026-01-01T00:00:00Z&end_time=2026-02-01T00:00:00Z&limit=25&offset=0
```

This administrator-only endpoint returns `data`, `total`, `limit`, `offset`,
`window`, `start_time` and `end_time`. Each row contains the usual budget status
plus `scope_name` (the resource's current display name). Rows are ordered by
period descending, scope type ascending, then scope ID ascending.

- `window` is `daily` (default) or `monthly`.
- Omit both times for the latest 30 closed days or 12 closed months. Explicit
  RFC3339 times must be paired, UTC calendar-aligned and `[start_time, end_time)`;
  end cannot extend into an open period. Maximum range: 366 days or 60 months.
- `limit` defaults to 25 and is 1–100; `offset` is a nonnegative integer.
  Malformed, empty, duplicate or overflowing known query parameters return 400,
  as do explicit zero-time boundaries.
- Optional `project_id` includes the project and its applications.
  `application_id` returns only application rows; both filters take their
  intersection. Ledger date/session/agent filters are not inherited.

Candidates are generated from the requested closed periods, not the pending
recalculation queue or existing usage. Unknown policies and periods whose final
pre-close window limit is null are omitted; known budgets with zero usage
remain visible. Amounts reflect the current reconciled ledger, not the
first-alert payload. Count, pagination and amounts share the projection-locked
transaction. Reading history neither evaluates thresholds nor changes existing
alerts/outbox; source reconciliation can queue ordinary recalculation work.
Source/storage failures return 500 rather than fabricated zero usage. If no
non-null policy history exists, the source scan is skipped.

The independent panel history table follows project/application filters and
has its own day/month selector, UTC range and paging. It displays scope names,
usage/limit, unclamped utilization and state, without adding project and
application costs into a double-counted total. It isolates failures from current
budget status, rejects stale responses and aborts reads on replacement/unmount.
The range/page caps do not bound the source reconciliation scan or total
candidate-count work; local representative measurements are not production SLAs.

### Budget Notification Delivery

Each threshold event and its dashboard outbox row commit in the same
transaction. The additive v6 migration also queues previously stored alerts
in bounded batches. An alert has one stable notification UUID; concurrent
evaluation and migration retries cannot enqueue it twice.

The budget monitor drains at most 32 due deliveries per sweep, even if the
usage source is unavailable or budgets have since been cleared. Atomic claims
use a one-minute lease and a fresh fencing token on each attempt. A failed
publish is retried after 1, 2, 4, 8, 16, 32 and then 60 minutes; retry state
survives restart. A lost worker's lease expires and a new worker can resume.
An older token cannot acknowledge or reschedule a newer claim.

Delivery uses the existing notification service's stable-ID publish method.
The first payload, creation time and 30-day feed expiry are retained on
replay, including a crash after notification commit but before outbox
acknowledgement. Stable-ID rows are retained as replay receipts even after
feed expiry, so a restart after more than 30 days cannot recreate or rebroadcast
the original notification. Ordinary notifications are still pruned on expiry.
New rows receive a best-effort WebSocket broadcast; HTTP
feed reads recover missed broadcasts. This is not a guarantee that a browser
received or read an event.

Budget notifications use the `admin` audience. Only the existing local-admin
identity can read them through `/api/notifications` or receive their
WebSocket event; ordinary authenticated roles cannot. They include the
immutable scope ID, USD usage/limit and UTC period, not key values or
request content. The action targets `/#/control-plane-projects`.

The outbox retains delivered rows for deduplication and pending rows for
recovery. Migration rollback intentionally refuses to drop it; binary
rollback leaves the additive table intact. No production migration is run
by the package tests.

The independent `panel/` notification entry point has passed frontend tests
and browser-fixture acceptance. Local production Bootstrap/Start acceptance
on 2026-10-27 additionally used isolated authenticated SQLite stores and
official log-store writes of synthetic usage, without mocked APIs, notification
creation calls, budget-page triggers or a shortened monitor interval.
Project/application 80% and 100% alerts reached the persisted feed, authenticated
ticket WebSocket and current production panel build. Polling, refresh, budget
navigation, mobile navigation and desktop sidebar controls passed. Notification
IDs remained unchanged after restart and another full monitor interval.
Both runtime instances exited normally; stopped-store reconciliation found
four alerts, four delivered outbox rows, no retries, four notifications and
two usage rows totalling USD 1.15.

This is local acceptance from synthetic log entries, not real provider traffic,
PostgreSQL-to-browser acceptance or production migration/deployment validation.
External budget webhook delivery now uses the existing signed webhook worker.
An endpoint explicitly subscribes to `budget.threshold_reached`; new budget
alerts enqueue a row per enabled subscriber in the same transaction as the
alert and dashboard outbox. Historical alerts are not automatically replayed
when a subscription is added. The event `data` is the immutable `BudgetAlert`
snapshot, including scope, UTC period, 0.8/1.0 threshold, usage and limit.
Queue/history `resource_id` identifies the alert; `async_job_id` is empty.
The shared worker retains its signing, SSRF, lease, retry, history retention and
manual redelivery paths. Budget snapshots remain private internal history
fields, rather than being exposed through the history-list API.
This additive patch does not implement multi-user acknowledgement or prove
production/PostgreSQL/ClickHouse delivery acceptance.

`TestBudgetWebhookMonitorPersistentRetryRecovery` runs the production startup
monitor, notification publisher, endpoint resolver and webhook dispatcher
against a local HTTP receiver. The first attempt returns 503; a fresh dispatcher
must recover the pending job without rewriting its retry time, deliver 204,
retain both signed-payload history attempts and remove the queue row. Another
monitor sweep must not recreate the delivered threshold. The default suite uses
SQLite for both stores. With the private PostgreSQL runner, configuration and
logs each use a separate test-owned PostgreSQL database, with runtime backend
assertions and cleanup before database removal:

```sh
bash scripts/test-controlplane-postgres.sh \
  -run '^TestBudgetWebhook' -timeout=15m -p 1 -v
```

The private socket uses trust authentication; the log-store fixture generates a
nonempty throwaway value solely to satisfy the upstream constructor contract.
This does not validate password authentication. Log materialized-view refresh is
off because this scenario does not query dashboard rollups; normal schema
migrations, queue leases, delivery history and PostgreSQL durability settings
are retained. This is synthetic-usage local integration, not a database/server
restart, production receiver, browser or cross-store recovery drill.

### Notification Read Receipts

The upstream `/api/notifications` feed and shared `Notification` schema remain
unchanged. Elygate owns an additive v8 receipt table, keyed by
`(principal_id, notification_id)`. Current authentication exposes one local
administrator account, so its sessions and verified Basic authentication share
the server-selected `local-admin` receipt identity. Usernames, session tokens,
body fields, headers and upstream audit actors do not choose the receipt owner.
This is not a multi-user receipt implementation. Setup-token-authenticated
requests follow the existing control-plane administrator guard.

- `GET /api/control-plane/notification-receipts?notification_id=<uuid>` accepts
  1..50 repeated, distinct, canonical UUIDs. It returns `{ "data": [...] }`
  in requested order; each row has `notification_id`, explicit `read`, and
  `read_at` only when read.
- `PUT /api/control-plane/notification-receipts/{id}` requires JSON containing
  only a mandatory `read` boolean and returns the resulting row. Missing, null,
  nonboolean, unknown, duplicate or case-variant fields and trailing JSON are
  rejected.
- Invalid IDs return 400; any missing or expired notification returns 404,
  including when expiry races with loading a feed page. Storage failures return
  500 rather than silently claiming unread.

Both notification-read and budget-acknowledgement mutations compare decoded
field names exactly. Standard JSON key escapes remain valid, but a second
spelling of the same key is rejected before any state or audit mutation.

The receipt routes require a genuinely authenticated local administrator, rejecting
auth bypass. Writes reuse the existing JSON and request-Host origin check
(not a newly strengthened full scheme/host/port check). The narrow upstream
auth patch adds the trusted administrator marker after successful Basic
credential verification, matching the existing session identity; replay this
line and its focused authentication regression tests when syncing upstream.

Notification row locking, active-lifetime verification, receipt mutation and
audit event commit in one transaction. Same-state retries do not add audit
events; read retries retain the first timestamp. Unread deletes the receipt.
The owned table has a cascading notification foreign key and an expiry index.
The background monitor prunes expired receipts before usage reconciliation,
also for retained replay notifications and unavailable usage sources. Migration
rollback refuses to drop stored read state; older binaries ignore this table.

The panel requests each page's state independently, displays unknown rather
than fabricated unread on load failure or uncertain write outcome, and disables
conflicting mutations/refresh/paging while saving. Its badge describes only
loaded unread rows; opening the panel never implicitly marks a notification read.
Read state does not acknowledge or resolve a budget alert. Production migration,
multi-user identity and real PostgreSQL-to-browser acceptance are separate gates.

## Management Audit Bridge

Management routes persist upstream `RecordAuditChange` identities in the
control-plane audit feed without requiring a signing key. No raw request body,
target name or snapshot is stored by this bridge; cache keys are hashed.
Recorded committed changes are retained even when a later step returns an
error or panics. Audit persistence failure leaves the mutation response intact
(it may hold a one-time credential), sets `X-Elygate-Audit-Status: failed` and
logs a content-free error.

This is post-commit persistence, not mutation-and-audit atomicity. Existing
transactional control-plane audits and signed governance audits retain their
own guarantees. See `docs/product/management-audit-coverage.md` for the producer
inventory, duplicate signed-event representations and remaining acceptance.
