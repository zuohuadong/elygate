# Routing Publication

Status: **PARTIAL**, not available for production activation.

## Follow-Up Contract

- Task: `routing-publication-atomic`.
- Parent: `55a86a494`, following immutable version capture/history.
- Source: production-readiness gate 4 and the continuing production-readiness goal.
- Reason: immutable versions are not deployable releases; the current rule cache
  cannot pin one rule/program generation throughout a concurrent evaluation.
- Risk: high, because routing changes the provider/model and authorization scope.
- Orchestration: panel, root is the sole writer; two isolated, read-only reviewers
  cover runtime consistency and transaction/recovery. At most two review rounds.
  High-risk reviewers use the available `gpt-5.5` runtime; no runtime fallback.
- Existing stack: Go 1.27.3, upstream CEL/routing, GORM, SQLite/PostgreSQL.
  No dependency, framework, provider or database migration is authorized.
- `agmesh` and the stack/database profile-selector skills are unavailable in this
  environment. The existing profiles are retained; local deterministic checks
  and host-native reviewers remain available.

## Goal And Boundaries

Provide an administrator-controlled publication and rollback workflow for saved
immutable routing versions, with concurrency control, durable audit/history,
coherent runtime activation and restart recovery. Preserve Bifrost upstream
contracts and the independent `panel/`. Do not add old Elygate compatibility.

The overall objective remains all roadmap functionality and production
readiness. Publication is one prerequisite, not a replacement for online Shadow,
model governance, complete audit/authorization or production delivery.

No production writes, real credentials, paid provider calls, deployment,
automatic commit/push, destructive rollback, or upstream release are included.
Code should remain in Elygate extensions where possible; necessary upstream
changes must be narrow, generic, regression-tested and independently replayable.

## Acceptance

- [x] Each routing evaluation sees one immutable rule/program generation.
  Concurrent edits cannot mix old targets/scopes with a new CEL program, lose
  unrelated writes or mutate state through caller-owned objects.
- [x] Empty, single, multiple, disabled, removed, moved and invalid-CEL rules
  retain upstream semantics. Custom rule stores retain their existing contract.
- [x] Request-path benchmarks record before/after `ns/op`, `B/op`, `allocs/op`.
  No-rule requests add no allocation. Retained generations/programs are bounded
  by the active rules and in-flight evaluations, not an unbounded version cache.
- [ ] Publish takes an immutable version, expected active revision/fingerprint
  and idempotency key. Concurrent writers have one unambiguous winner; replay
  does not create another release/audit or activate an obsolete release.
- [ ] Complete rules, chain depth, release history and audit persist atomically.
  Audit/DB failure leaves the previous durable and runtime policy intact.
- [ ] Runtime swaps the complete policy coherently; no per-rule HTTP CRUD loop
  can count as atomic publication.
- [ ] Commit/application ambiguity and process crash recover from durable state
  before serving requests; failed or pending application is never called active.
- [ ] Upstream CRUD/config reload, runtime plugin reload, scope/key validation,
  out-of-band drift and stale activation callbacks have explicit behavior and tests.
- [ ] Rollback creates a new audited release referencing a real prior release,
  with the same optimistic concurrency and runtime guarantees.
- [ ] SQLite and private PostgreSQL transaction/concurrency/restart tests pass.
- [ ] Authenticated canonical-gateway API and independent-panel workflows pass,
  including lost responses, retries, conflicts and mobile/light/dark states.

## Delivery Stages

1. Pin runtime rule/program generations and eliminate existing cache edit races.
2. Add transactionally durable publication/history and crash-safe activation.
3. Add true rollback with the same activation path.
4. Integrate panel and verify canonical gateway, both stores and browser flows.

All stages remain part of this contract. Incomplete stages keep it PARTIAL.
Online Shadow and the remaining production-readiness gates stay on the original
roadmap; they are not silently waived by completion of this contract.

## Runtime Generation Checkpoint

The October 30, 2026 checkpoint implements stage 1 only. The user's explicit
commit/push request authorizes delivering this checkpoint to `dev`; it does not
authorize deployment or complete the publication contract.

Writers serialize cloning, scope indexing and compilation before one atomic
generation swap. Evaluations pin one generation across scopes and chained rules.
Compilation errors are retained in that generation without changing the existing
skip-on-invalid-CEL behavior. External stores that only implement `Store` retain
their upstream contract.

Read APIs return borrowed, read-only rule objects. `GetScopedRules` also borrows
its prebuilt slice; `GetAllRules` copies only the outer pointer slice. Existing
production consumers do not mutate these objects. This boundary avoids
per-request deep copies; new consumers must use `UpsertRule` for mutations.

Live generations retain one rule slice, enabled scope indexes and at most one
compiled program or error per installed rule ID. Old generations are reclaimed
after in-flight readers release them. The separate direct-compilation cache keeps
one entry per directly requested rule ID, replaced when its expression changes
and removed on upsert/delete; it is not a release-history cache.

Both independent reviewers returned `PASS_SCOPED` for this stage, with no blocking
findings. `chainMaxDepth`, durable publication, rollback and restart recovery
remain outside this checkpoint.

### Request-Path Benchmark (`darwin/arm64`, Apple M4)

The same `BenchmarkRoutingRuleSnapshots` source was run against the parent
(`55a86a494`) through a Go overlay and against this generation implementation.
Values are one local run with `-benchmem`; benchmark noise is expected.

| Case | Parent | Generation |
| --- | --- | --- |
| empty | 6.793 ns/op, 0 B/op, 0 allocs/op | 1.602 ns/op, 0 B/op, 0 allocs/op |
| program | 8.651 ns/op, 0 B/op, 0 allocs/op | 7.832 ns/op, 0 B/op, 0 allocs/op |
| scope | 16.89 ns/op, 8 B/op, 1 alloc/op | 4.710 ns/op, 0 B/op, 0 allocs/op |
| evaluate incoming | 2552 ns/op, 5806 B/op, 77 allocs/op | 2411 ns/op, 5798 B/op, 76 allocs/op |
| evaluate unmatched | 2802 ns/op, 5751 B/op, 72 allocs/op | 2659 ns/op, 5768 B/op, 71 allocs/op |
| chain three | 7471 ns/op, 15080 B/op, 210 allocs/op | 7044 ns/op, 15057 B/op, 209 allocs/op |

## Verification

- Stage 1 passed `go test -buildvcs=false ./rules -count=1`, targeted `-race`
  tests for `TestRuleGeneration`, `TestRoutingEvaluationKeepsRuleAndProgramGeneration`
  and `TestRuleStore_`, both benchmark runs above, and `git diff --check`.
- Runtime: routing plugin/rules tests, deterministic paused-evaluation regression,
  concurrent write/read tests and `-race`.
- Performance: same benchmark source before and after, `-benchmem`, no live calls.
- Persistence/API: targeted controlplane/handlers/server tests against isolated
  SQLite and private PostgreSQL, plus canonical gateway restart/failure scenarios.
- Panel: focused contract tests, full panel suite/check/build, real browser flows
  and 1440/375/812 light/dark layouts.
- Every stage: current diff review, `git diff --check`, clean-code-guard and panel
  review evidence. A source assertion or mock cannot prove production acceptance.

Rollback during development is removal of only the owned local changes. Actual
production rollback needs a fixed candidate, backups, deployment authorization
and a tested prior image/data strategy; none is implied here.
