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

At that checkpoint, startup read live rules and client depth without consulting
the release head. The installation/startup checkpoint below adds live-table
replacement, transactional framework APIs and a fail-closed startup gate together.
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

## Installation And Startup Checkpoint

This October 30, 2026 checkpoint remains **PARTIAL**. The user's commit/push
request authorizes delivery to `dev`, not deployment or production activation.

Framework snapshot/replacement primitives require the shared routing transaction
lock. Replacement owns only rules, targets and client depth, preserves unrelated
client fields, and requires the transport-owned client row to exist so startup
defaults are not bypassed. Ordinary store writers can be guarded under that same
lock.

`InstallAcceptedRoutingRelease` is a before-serving primitive with no HTTP route.
It rechecks epoch, immutable content hash and rule scopes, compiles through an
injected compiler, replaces the policy, compares the stored projection, CAS
acknowledges the pending head and appends one apply audit in a single transaction.
Applied replay compares live state without another audit. It does not repair
drift. Desired/applied fingerprints remain immutable version hashes; there is
no additional stored live fingerprint.

Server startup checks before file reconciliation and again before plugin
initialization. Epoch zero remains file-owned. Pending or drifted managed state
fails closed without installation or repair. Managed file sync preserves stored
depth and skips rule writes/pruning; store guards reject rule mutations and depth
changes while allowing unrelated client settings.

The follow-up to `0d5f62742` passes the final validated startup snapshot directly
to routing plugin construction. Managed rules, compiled programs and chain depth
are initialized from that snapshot without another live-rule read. Later plugin
reloads revalidate before constructing a new generation. This is startup-only
coherence, not live publication or cross-process fencing.

Targeted SQLite tests cover replacement/rollback, empty policies, missing client
rows, guarded writers, installation replay, pending/drift rejection and audit
rollback. Transport routing/config regressions and `go vet` passed. Snapshot
handoff, managed/empty plugin initialization, unmanaged loading and guard failure
are covered by focused lib/server tests, including the race detector. Focused
PostgreSQL installation, replay, audit rollback and missing-client rejection
also pass under the race detector. Complete startup/file-sync integration,
crash recovery, concurrent activation and production acceptance remain open.

Runtime generation installation after database commit, failure recovery,
rollback, publication API/panel flows and broader integration tests remain open.
No inference-path work or stream-sized retained state is added: compilation and
fingerprinting run only at startup or inside management transactions. Config
retains at most one validated startup snapshot until plugin construction; the
plugin owns its compiled generation and a separate depth value, not the source
snapshot. This management-only change does not need a request-path benchmark.

## Installation Transaction Handoff

Follow-up `routing-installation-handoff` has parent `20dca0494`, source stage 2
and the original production-readiness goal, and reason that a head-only return
cannot hand a validated policy to runtime, while a lost commit receipt cannot
be treated as a rollback. The original goal, non-goals and acceptance remain
unchanged. This is high-risk panel work with root as the sole writer and the
existing runtime/transaction read-only reviewers; it does not add an HTTP route,
enable online publication, deploy, or authorize automatic commit/push.

`InstallAcceptedRoutingRelease` now returns `RoutingReleaseInstallation`:
the acknowledged head and the complete rules/depth snapshot compared in the
same transaction. Both pending installation and applied replay use that
transaction's compiled policy, never a post-commit live-table read. An empty
policy is an explicit snapshot with an empty rule slice. Compiler output belongs
to the caller; nested objects must remain read-only until the existing runtime
preparation boundary deep-copies them. The result proves the policy matched
the committed transaction, not that other processes cannot subsequently drift.

Installation rejects transaction-bound stores and transaction-backed config
stores before compiling or writing. Root Begin failures and work failures with
a confirmed rollback return the original error, without an installable policy.
Commit receipt errors, including cancellation reported by Commit, return
`ErrRoutingInstallationUncertain` and no policy, whether or not the database
actually committed. A rollback receipt failure also keeps both original errors
and returns uncertain; GORM's sticky query error is not used as the SQL rollback
receipt. Cancellation automatically rolled back by `database/sql` before any
commit attempt is not a commit ambiguity. In contrast, pgx may attempt rollback
with the canceled transaction context and return a failed receipt; that remains
uncertain and preserves both errors. The cancellation test checks the actual
rollback receipt as well as zero commit attempts, a nil policy, and unchanged
durable state. A compiler panic attempts rollback
and propagates unchanged; its regression verifies normal lock release and a
successful retry. No rollback is attempted after a
failed commit receipt to guess its outcome.

This is a management-only handoff: no inference hook, per-request allocation,
new cache or retained release history is added. The returned rules/depth have
the existing bounded candidate size; their lifetime belongs to the caller.
Online admission/failure closing, complete generation installation, reload
isolation, cross-process fencing, rollback, HTTP/panel publication and final
production gates remain required. A successful durable acknowledgement is not
current-process readiness. The publication contract remains **PARTIAL**.

Validation for this handoff passed `TestRouting(Installation|Release)` with
`-race -count=1` on SQLite (28.885s) and a private PostgreSQL instance (119.514s).
The PostgreSQL runner also verified test-database cleanup and stopped the
instance. Runtime and transaction read-only reviewers accepted this scoped
handoff; the cancellation assertion was corrected after PostgreSQL exposed a
failed rollback receipt, without changing the conservative production behavior.
These checks do not validate online activation or production readiness.

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

## Process-Local Admission Checkpoint

The October 31, 2026 checkpoint adds a terminal host admission callback before
continuation, plugins, fallbacks and provider dispatch. The five direct realtime
entrypoints also check admission before opening upstream. Nil SDK contexts get
private request state; a private streaming context survives until stream closure.
The original upstream pre-request-hook entrypoint remains unchanged; transports
opening upstream directly must use the checked entrypoint.

Installation closes this process's gate before the database operation. Confirmed
rejection restores the previous open state; uncertain transaction outcomes and
post-commit generation installation failures keep it closed. Admitted requests
retain their generation, including internal requests and copied realtime turns.
Managed policies reject individual rule/depth mutations and routing-plugin
replacement/removal.

Request-path cost: disabled admission is an atomic callback load; enabled local
admission pins one immutable generation under the store writer lock. The context
holds only a generation pointer. Old rule/program generations remain reachable
until admitted request/session contexts release them, so retention depends on
concurrent requests and session lifetime, not stream payload size.

One local Apple M4 `-race -benchmem` run measured disabled/allowed callback checks
at 38.28/59.46 ns/op, both 0 B/op and 0 allocs/op. Unchecked versus checked-disabled
pre-request hooks measured 1971/2044 ns/op, both 63 B/op and 0 allocs/op. These
instrumented measurements isolate the callback overhead but do not establish
production performance acceptance.

This is a process-local primitive and internal activation path, not cross-process
fencing or an exposed HTTP/panel publication workflow. Rollback, external runtime
acceptance and production authorization remain outstanding. Status: **PARTIAL**.

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
