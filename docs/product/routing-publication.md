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
  No dependency, framework, provider or database replacement is included.
  Additive control-plane schema migrations are required by the durable stage.
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

## Candidate Compiler Checkpoint

The October 30, 2026 follow-up to `14678b809` adds strict, in-memory candidate
compilation and a pending-version restart regression. The user's explicit
commit/push request authorizes this checkpoint on `dev`, not activation.

Draft validation now uses the candidate compiler, rejecting blank CEL and
duplicate names/priorities within a scope. Candidate rules receive version-local
UUID v5 identities, canonical scope ordering and explicit defaults; target and
fallback order remains unchanged. Simulation retains its existing empty-CEL
behavior. Scope/key existence and authorization still require publication-time
checks. No live table, release head or runtime generation is changed.

The startup path currently reads live rules and client depth without consulting
the release head. Live-table replacement, transactional framework APIs and a
startup recovery gate must therefore land together in a later checkpoint.
Pending acceptance must not write desired rules into live tables.

Cost: this compiler runs only during administrator draft validation, outside the
inference request path. Its temporary rule/program state is bounded by 128 KiB
of input and 32 rules and is not retained after validation. No inference-path
work or long-lived cache is added.

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

## Durable Intent Checkpoint

Stage 2 begins with storage-only acceptance, not publication. It does not complete
any of the remaining end-to-end acceptance items above. The two read-only reviewers
reconciled their initial transaction/runtime design disagreement around this
boundary before implementation.

Migration `elygate_control_plane_v14_routing_release_intents` adds a singleton
head and immutable acceptance receipts. The seed has epoch `0`, state `pending`
and empty desired/applied identities. An empty seed is not a recoverable install.
Migration replay preserves existing head/history; migration rollback refuses to
discard pending intent or idempotency history.

`AcceptRoutingRelease` takes a version ID, expected head epoch and nonblank
idempotency key of at most 128 bytes. The head epoch is independent of draft
revision. SQLite reserves its writer before reading; PostgreSQL locks the singleton
row. Inside that lock, an identical key/version/expected-epoch replay returns the
original receipt without moving the head or emitting another audit. Reusing a key
for a different version or expected epoch conflicts. Different keys racing with the
same expected epoch have only one winner.

A new acceptance atomically appends its receipt, advances the head by one, copies
the immutable version's already-stored SHA-256 into desired state, clears applied
identities, sets `pending`, and appends `routing-release.accept` audit. The version
hash covers name, rules JSON and chain depth; it is not a live runtime fingerprint.
Any failed write, cancellation or audit failure rolls the entire acceptance back.
No version or draft is mutated. Old receipts remain replayable after the head moves.

`IsApplied` requires a positive epoch, `state=applied`, and matching nonempty desired
and applied version IDs and fingerprints. It reports durable acknowledgement only,
not current-process readiness or freedom from upstream configuration drift. No
application acknowledgement or failure writer exists at this checkpoint, so neither
the seed nor an accepted intent can satisfy it. Reopening storage preserves pending
state and does not activate routing.

This stage adds no inference-path work or retained runtime cache. Head storage is
one fixed row; receipt history grows by one small row per accepted intent and must
remain durable for replay/audit. There is no in-memory history cache. It does not
write upstream rules, targets or client config, does not reload plugins, and exposes
no new HTTP route. Whole-policy/depth installation, CAS-protected application
acknowledgements, restart-before-serving recovery, live drift detection, rollback,
and API/panel acceptance still belong to the remaining stages.

## Runtime Policy Preparation Checkpoint

This follow-on checkpoint adds the process-local primitive needed by stage 2.
It does not mark durable publication, activation or any remaining acceptance item
complete, and it exposes no publication HTTP endpoint.

`LocalStore` generations now carry rules, compiled programs and effective chain
depth together. `RoutingPlugin.InitFromStore` opts stores implementing the optional
`ChainMaxDepthUpdater` into managed depth. Client-config reload publishes the new
depth through that interface before replacing the live config. Persisted zero uses
the same effective default as startup, including the config seen by custom stores.
Explicit nonpositive depth passed to `NewEngine` retains its upstream rejection.

`NewEngine` does not mutate the store. Direct SDK calls and custom stores without
managed snapshots retain their live pointer between evaluations; one evaluation
captures depth once before reading scopes. Managed evaluations use only the pinned
generation and never read the mutable pointer, including between chained rules.

`PreparePolicy` clones the entire candidate and compiles outside the writer lock.
Nonpositive depth, nil rules, duplicate IDs, failed copies and cancellation leave
live state untouched. Invalid CEL remains a cached compile failure skipped by the
engine, preserving upstream semantics rather than silently changing validation.
`InstallPreparedPolicy` verifies store ownership and the exact base generation under
the writer lock, clears the direct-compilation cache and swaps the complete policy
once. Concurrent CRUD, depth edits or another policy installation invalidate stale
candidates. Reusing a successful candidate conflicts; this token is not durable
idempotency. Callers must revalidate publication preconditions before preparing again.

A depth-only change shallow-copies the generation header and shares immutable
rule/program storage; CRUD preserves managed depth. The extra retained state is one
integer per generation and one owner/base/candidate handle per retained preparation.
The store keeps no preparation or release-history cache. Callers must release
preparations promptly, because a retained token also retains its base generation.
No-rule requests keep their existing gate, without additional request allocations.

Deterministic coverage includes complete/empty replacement, input isolation,
preparation/installation failure, cancellation, cross-store use, competing candidates,
stale CRUD/depth edits, paused evaluation across installation, independent SDK depth
pointers, chain-local pointer changes, custom stores and client-config reload.
Both read-only reviewers returned `PASS_SCOPED` for the final runtime source.
Database commit/acknowledgement, crash recovery, drift invalidation, rollback and
API/panel acceptance remain required and are not supplied by this primitive.

The final routing `go test -race -buildvcs=false ./... -count=1` passed
(routing 4.453s, complexity 6.020s, rules 3.087s). The server's targeted
`TestRoutingPolicy|TestGetRoutingPlugin` race run passed (2.598s).
Formatting and `git diff --check` also passed.

For this depth-management checkpoint, the unchanged snapshot benchmark was run
once before and after on the same Apple M4:

| Case | Before | After | After allocations |
| --- | --- | --- | --- |
| empty | 1.605 ns/op | 1.727 ns/op | 0 B/op, 0 allocs/op |
| program | 7.814 ns/op | 8.102 ns/op | 0 B/op, 0 allocs/op |
| scope | 4.705 ns/op | 4.772 ns/op | 0 B/op, 0 allocs/op |
| evaluate incoming | 2414 ns/op | 2597 ns/op | 5797 B/op, 76 allocs/op |
| evaluate unmatched | 2726 ns/op | 2850 ns/op | 5747 B/op, 71 allocs/op |
| chain three | 7036 ns/op | 7672 ns/op | 15057 B/op, 209 allocs/op |

The managed-policy benchmark measured incoming at 2587 ns/op, 5797 B/op,
76 allocs/op, and unmatched at 2839 ns/op, 5747 B/op, 71 allocs/op.
Allocation counts did not increase, but evaluation timings rose roughly 5-9%
in these single runs. This is not evidence of performance non-regression;
repeated measurements and attribution remain necessary for performance acceptance.

## Runtime Request-Path Benchmark (`darwin/arm64`, Apple M4)

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

## Target Order Persistence Checkpoint

The October 30, 2026 follow-up adds the prerequisite needed to preserve weighted
selection boundaries across a database reload. Published candidates carry an
internal nullable `position` on each target; the strict candidate compiler
assigns `0..n-1` in caller order, while legacy rows remain `NULL` and retain the
existing weight/provider/model/key ordering. SQLite and PostgreSQL use the same
explicit NULL ordering, and CRUD/sync reject mixed, duplicate, negative, or
gapped positions before writing.

The position column is additive and intentionally has no destructive rollback:
dropping it would silently change published weighted selection. Position is
excluded from public JSON/config payloads but included in hashes only when set,
so legacy hashes remain stable while explicit order changes are durable.
The added work runs during candidate compilation, configuration writes/reloads,
and generation cloning only; the per-request selection path is unchanged.
Retained state is one optional integer per positioned target, bounded by the
installed rules and in-flight generations.

Focused SQLite reload, scoped, paginated, legacy-order, hash, compiler, and
generation-clone tests cover this checkpoint. This does not publish live rules,
install a pending version, add a startup recovery gate, or provide rollback/API
activation. The overall publication contract remains **PARTIAL**.

## Verification

- Stage 1 passed `go test -buildvcs=false ./rules -count=1`, targeted `-race`
  tests for `TestRuleGeneration`, `TestRoutingEvaluationKeepsRuleAndProgramGeneration`
  and `TestRuleStore_`, both benchmark runs above, and `git diff --check`.
- The durable-intent checkpoint passed SQLite `TestRoutingRelease*`, private
  PostgreSQL `TestRoutingRelease*` with `-race` (45.496s), and controlplane vet.
  SQLite full controlplane regression passed (129.497s) after fixing host-date
  coupling in the budget rollover fixture; its original eight-alert, scope,
  usage and rollover assertions remain intact. That fixture separately passed
  private PostgreSQL with `-race` (11.130s). Both private instances cleaned up.
  These checks prove storage acceptance only, not runtime publication.
- The restart regression now seeds a live rule and chain depth, accepts a
  different pending version, closes and reopens the store, and initializes the
  real routing plugin. The serving generation still contains only the live rule
  and depth; the pending version does not route traffic. This proves the
  current non-installing acceptance path is restart-safe, not that publication
  or activation is complete.
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
