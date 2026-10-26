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
settlement/recomputation, notification delivery/acknowledgement and forecasting remain
separate follow-ups. No new external notification is sent by these APIs.

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
