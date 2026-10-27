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
provider, browser, production deployment, or backup/restore acceptance.

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

The monitor reconciles configured budgets on startup and every minute. It
emits durable events at 80% and 100%, including both on a jump past the limit.
The unique scope/window/period/threshold key suppresses duplicates across
retries, concurrent monitors and restarts. Stored events preserve their
original observed usage and limit; later repricing, budget edits or clearing
do not rewrite history or retrigger the same threshold in that period.
Comparisons allow eight binary floating-point ULPs of representation noise,
without rounding costs to cents.

This is current-period, post-settlement alerting over the Usage Ledger, not a
second budget enforcement engine. Bifrost Virtual Key/governance budgets still
own request blocking. Panel budget creation, replacement, clearing, status and
alert history are available in the control-plane page. Closed-period late
settlement/recomputation, acknowledgement and forecasting remain separate
follow-ups.

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

External budget webhook delivery now uses the existing signed webhook worker.
Only enabled endpoints subscribed to `budget.threshold_reached` at alert
creation receive the immutable alert snapshot. Queue rows are inserted in the
same transaction as the alert and notification outbox. Later subscriptions do
not replay old alerts. Resource IDs and snapshots survive retries and explicit
redelivery; async inference delivery keeps its existing job lookup contract.

`TestBudgetWebhookMonitorPersistentRetryRecovery` covers the production monitor,
notification publisher, endpoint resolver and dispatcher with real relational
stores and a local HTTP receiver. The receiver first returns 503; a new
dispatcher recovers the persisted retry and succeeds with 204. It verifies the
signature, stable payload, both history rows, queue cleanup and no duplicate
event on the next monitor sweep.

The default fixture uses SQLite for both control-plane and log stores. With
`ELYGATE_TEST_POSTGRES_SOCKET`, both use separate private PostgreSQL databases:

```sh
bash scripts/test-controlplane-postgres.sh \
  -run '^TestBudgetWebhook' -timeout=15m -p 1 -v
```

The private socket uses trust authentication. The log-store fixture supplies a
random one-time password value only to satisfy its constructor, not to prove
password authentication. Materialized-view refresh is disabled for this test.
This synthetic-cost, local-receiver check does not establish real provider
billing, database/host restart, production delivery or cross-store recovery.

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
