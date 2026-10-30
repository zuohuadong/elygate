# Employee Login Failure Audit

Status: **PARTIAL**. Implementation, focused SQLite checks and PostgreSQL
server persistence checks pass; the full PostgreSQL employee rejection matrix
did not complete within its verification budget.

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
  The initial private PostgreSQL cluster used SQL_ASCII and failed pgx's UTF8
  requirement. A fresh UTF8 cluster passes server persistence, but the broader
  employee matrix hits its five-minute timeout while initializing migrations
  for `hash_error`. It does not establish that matrix's PostgreSQL result.
  Extra cold-cache compilation retries were stopped, not counted as passes.

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
