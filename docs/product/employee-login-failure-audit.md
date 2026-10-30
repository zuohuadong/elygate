# Employee Login Failure Audit

Status: **PASS_SCOPED** for implementation and the focused SQLite/PostgreSQL
rejection and persistence checks below. The whole product remains **PARTIAL**;
this is not production, distributed admission or full HTTP-server acceptance.

Follow-up `failed-employee-login-audit`: parent `22efe22e5`, source the
employee failed-login gap in `management-audit-coverage.md`, reason that
credential rejections currently update account counters without an audit event.
Scope is frozen to employee login admission, its anonymous failure callback,
server persistence wiring, focused tests/benchmarks and acceptance records.
Authentication and unauthenticated write amplification are high risk:
root is the only writer, with two independent read-only reviewers, at most
two review rounds. Existing Go/fasthttp/GORM and SQLite/PostgreSQL patterns
remain authoritative; the installed profile-selector skill is unavailable.
No schema, dependency, inference-path, publication ownership or production
deployment changes are authorized by this follow-up. The user explicitly
authorized committing and pushing this scoped change on 2026-10-31.

## Contract

- Unknown username, password mismatch and hash-comparison errors produce one
  `employee_session.login_failed` event for `employee_session/employee`.
  The existing account-counter write must succeed before the latter two
  failures produce an event. No request body, username, employee identity,
  password/hash, cookie, diagnostic or correlation header enters the event.
- The dedicated callback receives only a bounded standard context. The server
  constructs the anonymous principal and fixed event; compact rows use the
  action to express rejection, while signed rows additionally use
  `Outcome: denied`. Neither path trusts or changes authorization context.
- Audit failure preserves the original 401 body and never issues a session
  cookie. It exposes `X-Elygate-Audit-Status: failed`; production persistence
  errors log a fixed content-free message. Previously committed failed-login
  counters are not rolled back. Counter update and audit are separate
  transactions; this does not close their crash window.
- Malformed payload, admission denial, inactive/locked account, lookup or
  counter write failure, successful login and session-creation errors do not
  produce a credential-rejection event. Existing statuses remain unchanged.
- Login admission uses the connection-source IP only, five attempts per
  rolling fifteen minutes, before lookup, bcrypt and audit. Reuse the existing
  bounded limiter with capacity 4096; forwarded headers and username rotation
  cannot reset a source's budget. Every admitted attempt consumes budget.
  Self-service password verification retains its existing IP/username key
  in the same bounded limiter. Account lockout persistence is unchanged.
- Deterministic verification must cover the rejection/exclusion matrix,
  missing/failing callback, compact/signed transactions and protected feed,
  forged identity and secret omission, admission boundaries/concurrency,
  account-lockout preservation and current race/vet/diff checks.
  Record before/after request-path benchmarks and separate persistence cost.

## Verification (2026-10-31)

- Current-source `go test ./transports/bifrost-http/employees -run
  'TestEmployeeLogin|TestEmployeeSessionLoginAtomicFailuresAndSuccess' -count=1`
  and the server's `TestEmployeeLoginFailureAuditPersistenceAndIdentity` pass.
- Focused race binaries pass `^TestEmployeeLogin` against SQLite and
  `^TestEmployeeLoginFailureAudit` against both SQLite and PostgreSQL 18.
  The PostgreSQL server fixture reports the actual `postgres` backend and
  verifies compact/signed persistence, secret omission, rollback, protected
  feed access and the signed chain. It manually wires the callback; this is
  not full `RegisterAPIRoutes`, network or production acceptance.
- The old-code baseline rejects neither username rotation nor forged
  forwarding-header rotation: the regression expects 429 but receives 401.
  The candidate passes that regression, production capacity, exhausted-budget
  concurrent refusal, callback exclusion matrix and lockout preservation.
  Concurrent first admission remains covered by the existing limiter tests,
  not the exhausted-budget handler test.
- `go vet ./transports/bifrost-http/employees
  ./transports/bifrost-http/server`, focused `gofmt` and `git diff --check`
  pass. Both independent read-only reviewers report no blocking findings.
- An earlier whole-employee SQLite race run hit its three-minute timeout in
  existing credential-mutation serialization tests; it is not a suite pass.
  A fresh full run with an eight-minute external budget completed all 47
  top-level tests and 116 subtests with zero failures, skips or race warnings.
  Its completed log is
  `.codex-tmp/employee-login-sqlite-full-final-20261031.log`.
  The initial private PostgreSQL cluster used SQL_ASCII and failed pgx's UTF8
  requirement. A fresh UTF8 cluster passed server persistence, but the broader
  employee matrix hit its five-minute timeout while initializing migrations
  for `hash_error`. It does not establish that matrix's PostgreSQL result.
  Extra cold-cache compilation retries were stopped, not counted as passes.

### PostgreSQL Matrix Follow-Up

Follow-up `employee-login-postgres-matrix-verification`: parent `3acde7884`,
source the preceding verification timeout and production-readiness goal,
reason that server persistence alone does not verify employee-handler rejection
and exclusion behavior against PostgreSQL. Native, low risk, root is the sole
owner, external=0. This verification/documentation-only follow-up changes no
production behavior, fixture, assertion or original acceptance requirement.
The user separately authorized committing and pushing this evidence update on
October 31, 2026. This does not authorize deployment.

On October 31, 2026, the same Go 1.27.3 race binary completed
`^TestEmployeeLogin(AdmissionLimitsAuditAndQueries|Failure)` against the private
UTF8 PostgreSQL 18 cluster: three top-level tests and all thirteen matrix subtests
passed, with no skips or race warnings. Admission/query/audit bounds took 31.37s,
the rejection/exclusion matrix 66.66s, and committed lockout preservation 13.74s.
No test-level timeout was changed; the external binary watchdog was fifteen
minutes instead of the earlier five-minute budget. The successful run did not
change or weaken migration, query, transaction or response assertions.
Its completed log is
`.codex-tmp/employee-login-postgres-final-20261031.log`.

The binary SHA-256 is
`f9b7d77c730451e77e0e52760032953f8da8ecf28b66dcbf21a4f3e9bbd81ff6`;
build metadata confirms `-race=true`. The employee/server source is unchanged
from `3acde7884c40ba6b437be23b38dc9c22f6a5b5ee`.
The private cluster had UTF8, no TCP listener, permission-0700 sockets, `fsync`,
`synchronous_commit` and `full_page_writes` enabled. No employee/server fixture
connections remained after the run. Two databases left by earlier timed-out
runs were subsequently removed only from this private test cluster; the
remaining owned test-database count was verified as zero. Historical failure
logs remain available. The cluster was then stopped with a confirmed completed
shutdown.

Current-source full `go test ./transports/bifrost-http/server -count=1
-timeout=3m` also passed (8.412s). This is a non-race server package result,
not a full PostgreSQL server suite or registered-route/network acceptance.
The previous failures remain historical evidence and are not relabeled passes.

## Registered-Route Runtime Follow-Up

Follow-up `employee-login-canonical-runtime`: parent `ffc591530`, source the
remaining full HTTP-server acceptance gap, reason that manually wired callbacks
do not prove Bootstrap and `RegisterAPIRoutes` integration. Native, low risk,
root is the sole writer, external=0. Scope: a local SQLite runtime acceptance
script, its package entry point and scoped acceptance/usage documentation.
No production behavior,
authentication policy, upstream contract, deployment or inference-path changes.
The full production-readiness goal remains active / PARTIAL.

Run `bun run --cwd panel test:employee-runtime` with an absolute, freshly built
`ELYGATE_TEST_BINARY`. Each compact/signed run owns its temporary directory,
uses random in-memory credentials, listens only on loopback and inherits no host
provider credentials. The audit-failure trigger is created only in that stopped,
fresh SQLite fixture and removed before recovery verification. Startup, normal
restart, source admission, account lockout, signed-chain verification and
graceful child/directory cleanup must all complete; an interrupted build or
unexecuted test is not a pass.

Status: **PASS_SCOPED**. On October 31, 2026, the freshly built canonical CLI
(`ffc591530`, SHA-256
`fe8c28ea2412f6373c580de6ecd6b13d89dcbf5bd9010e357ad1e6f0e43213b2`) passed
both compact and signed SQLite runs: 2 tests, 0 failures, 33.11 seconds.
The registered routes covered administrator login, employee creation and
login/logout, anonymous failed-login audit, source admission exhaustion,
account lockout, injected audit failure with 401 preservation, normal restart,
signed-chain verification and graceful child/temporary-directory cleanup.
The health response asserted `status=ok` and `components.db_pings=ok` on
every startup. The complete final log is
`.codex-tmp/employee-login-runtime-20261031.log`.
Go build metadata records Go 1.27.3, darwin/arm64, PIE, `sqlite_static` and
`vcs.modified=true`; the local edits affect only test/usage/evidence files,
not Go implementation or dependencies. The binary is not a released image.

The first runtime run failed because the script incorrectly assumed a
successful login would release a source attempt. The existing limiter counts
all attempts; the corrected scenario strictly verifies one successful and
four rejected attempts before exhaustion, without altering production policy.
On the next process, two audit-rejected password failures still advance the
durable employee counter and lock the account. A third process retains that
lock and, after removing only the fixture trigger, writes a new anonymous audit.
An independent `tsc` invocation could not resolve the uninstalled Bun module
type declarations; it is not counted as a type-check pass.
The script adds no work, allocations or retained state to the inference path.
This is not PostgreSQL, crash/power-loss, reverse-proxy, container,
true-provider or production acceptance. This follow-up remains local and is
not automatically committed, pushed or deployed.

## PostgreSQL Registered-Route Follow-Up

Follow-up `employee-login-canonical-postgres-runtime`: parent
`employee-login-canonical-runtime` / `ffc591530`, source the remaining PostgreSQL
network-runtime gap, reason that SQLite network evidence and separately wired
PostgreSQL callback tests do not prove the complete registered PostgreSQL flow.
Native, low risk, root is the sole writer, external=0. Scope: extend the same
opt-in runtime assertions to the existing private PostgreSQL helper and update
scoped acceptance/usage records. No production Go, dependencies, upstream
contract, authentication policy, inference work or deployment changes.

Status: **PASS_SCOPED**. On October 31, 2026, the unchanged canonical CLI and
the extended final script passed both modes on private PostgreSQL 18.4:
2 tests, 0 failures, 39.77 seconds. The same extended script also passed both
SQLite modes again: 2 tests, 0 failures, 49.01 seconds. Full logs:
`.codex-tmp/employee-login-runtime-postgres-20261031.log` and
`.codex-tmp/employee-login-runtime-sqlite-20261031.log`.

Each PostgreSQL mode created its own UTF8 cluster with two fresh databases.
Host authentication was rejected; the listener was a private permission-0700
Unix socket with TCP disabled. `fsync`, `synchronous_commit` and
`full_page_writes` were verified enabled. Every gateway start asserted two live
configured PostgreSQL databases, no SQLite fallback files and a successful
enabled database health ping. The two normal database/gateway restarts retained
the original administrator session, exact failed-login audit feed and active
employee lock. Two trigger-rejected audits left no event, did not undo the
committed counter or lock, retained 401 without cookies and reported audit
failure. Removing only the fixture trigger allowed audit writing to resume.
The signed chain remained valid throughout.

Successful completion required each mode's owned databases to reach zero,
the private PostgreSQL and gateway processes to stop gracefully and their
temporary directory to be removed. No existing cluster, host connection
credentials, production state or provider endpoint was used. The binary
SHA-256 above is unchanged; Go sources and dependencies remain unchanged.
This closes the employee PostgreSQL registered-route/normal-restart gap,
not crash, backup/restore, password/TLS, final-image or production acceptance.
No commit, push or deployment was performed for this follow-up.

## Request-Flow Cost

Apple M4, darwin/arm64, Go 1.27.3, 30 iterations, `-benchmem`. The table records
separate serial runs of the old-code baseline and current candidate. This is
a small local sample, not a statistically established latency improvement or
production throughput claim. Bcrypt uses MinCost in the benchmark fixture.

| Request case | Before ns/op, B/op, allocs/op | After ns/op, B/op, allocs/op |
| --- | --- | --- |
| Unknown username | 760794, 13871, 112 | 759571, 14016, 112 |
| Password mismatch | 812201, 25266, 267 | 799457, 24823, 265 |
| Hash error | 60855, 19940, 257 | 60324, 19923, 257 |
| Successful login | 895869, 52638, 571 | 892460, 52672, 572 |
| Admission denied | 3049, 854, 9 | 3883, 838, 9 |

`BenchmarkEmployeeLoginFailureRequest` uses a no-op failure auditor and excludes
fixture resets; it does not measure audit SQL. The separate SQLite
`BenchmarkEmployeeLoginFailureAuditPersistence` measures the added transaction:
compact 50104 ns/op, 11696 B/op, 122 allocs/op; signed 175601 ns/op,
49093 B/op, 552 allocs/op. These numbers must not be added together and called
end-to-end or PostgreSQL throughput.

The inference path is unchanged. Successful employee login adds no audit
transaction; credential rejection adds the callback lookup and one audit
transaction after admission and credential checks. The existing limiter now
retains at most 4096 shared IP or password-verification keys, each with at most
five attempt timestamps plus ordinary map/key overhead. Entries expire lazily
on access/cleanup and all state disappears with the handler. Durable audit rows
have no new retention bound; signed writes use the existing shared chain head.

## Remaining Boundaries

Process-local admission is not a distributed security boundary. Proxy/NAT
clients share source budgets; a saturated map rejects new keys, handler
recreation resets it, and replicas do not share counters. Signed failures
contend on the existing audit-chain head. Each admitted credential rejection
adds one durable event without automatic retention. Restart/crash recovery,
automatic session expiry, bulk per-session events, production routing/TLS
and the full product readiness gates remain separate requirements.
