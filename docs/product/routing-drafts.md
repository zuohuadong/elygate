# Routing Policy Drafts

Routing drafts are administrator-owned, durable candidates. They do not change
the active Bifrost rule store, install a routing plugin, or call a provider.
The independent panel provides a saved-draft workflow and immutable version
history in its offline simulation view. Policy publication, rollback and online
Shadow remain separate unfinished work.

## API

```text
GET    /api/control-plane/routing/drafts?limit=25&offset=0
POST   /api/control-plane/routing/drafts
GET    /api/control-plane/routing/drafts/{draft_id}
PUT    /api/control-plane/routing/drafts/{draft_id}
DELETE /api/control-plane/routing/drafts/{draft_id}
```

Every route requires the existing verified control-plane administrator
identity and rejects authentication bypass. Write requests require
`application/json` and the existing same-origin administrator check.
Every registered response, including authorization and validation errors,
uses `Cache-Control: no-store`.

Create accepts:

```json
{
  "name": "Candidate",
  "chain_max_depth": 10,
  "rules": [
    {
      "name": "Candidate rule",
      "cel_expression": "model == 'input'",
      "targets": [{"model": "target", "weight": 1}],
      "fallbacks": ["openai/mini"]
    }
  ]
}
```

Creation returns HTTP 201 with a generated canonical UUID, revision 1, the
trimmed name, submitted rules, chain depth and timestamps. Read and successful
update return the same structure. PUT is a complete replacement and additionally
requires `expected_revision`; DELETE accepts only `expected_revision` and
returns an empty HTTP 204 on success.

An update increments revision in the same database statement that checks the
expected revision. Stale update/delete returns 409 without changing the draft
or appending a success audit. Missing drafts return 404. Other storage failures
return a fixed 500 error without database diagnostics.

The list returns `drafts`, `limit` and `offset`. Summaries exclude rules; retrieve
one draft to load its rules. Results are ordered by update time descending and
ID ascending, with limit 1..100 and a nonnegative offset. Invalid, duplicate or
overflowing pagination values return 400. Pagination is not a frozen snapshot
across concurrent edits.

## Validation And Storage

- The total write payload is at most 128 KiB. Names contain 1..128 Unicode
  characters after trimming and cannot contain control characters.
- Chain depth is an integer in 1..20. Expected revisions are integers from 1
  through 9007199254740990 so incremented revisions remain JavaScript-safe.
- Rules must be an array of 0..32 entries; empty is valid, omitted/null is not.
  The validator reuses the offline simulation bounds and upstream CEL compiler.
- Unknown typed fields are rejected, including inside fallback objects whose
  upstream custom decoder otherwise ignores unknown fields. Existing upstream
  string fallbacks and allowed key-pinned objects retain their semantics.
- Arbitrary query content and expressions are not secret scanners. Do not put
  credentials or sensitive request samples in a draft. No provider credentials
  or live usage are looked up during validation.
- The v12 migration creates `elygate_control_routing_drafts` without changing
  existing active routing tables. Mutation and compact administrator audit
  commit or roll back together.
- Rows persist until explicitly deleted. Lists do not load rule bodies.
  This administrator-only path adds no inference hook, per-stream buffer or
  global draft compilation cache.
- Schema rollback refuses to delete administrator candidates. Binary downgrade
  and production upgrade/restore safety require their own acceptance evidence.

## Immutable Version Snapshots

Backend baseline `d5669bde5` and panel baseline `d4a4be649` add:

```text
POST /api/control-plane/routing/drafts/{draft_id}/versions
GET  /api/control-plane/routing/versions?limit=25&offset=0
GET  /api/control-plane/routing/versions/{version_id}
```

The same administrator, Origin, JSON, canonical UUID, revision and `no-store`
boundaries apply. Capture accepts only `{"expected_revision": 1}`. HTTP 201
returns an immutable snapshot with `id`, `draft_id`, `draft_revision`, `name`,
`rules`, `chain_max_depth`, `content_sha256` and `created_at`. Missing source
drafts return 404; uncaptured stale revisions return 409. The server does not
accept replacement rule bodies on this endpoint.

Capturing the same draft/revision concurrently or retrying it returns the same
version, without another audit event. Existing captures remain retrievable and
replayable after the source draft is updated or deleted. The v13 migration
creates `elygate_control_routing_versions`; insertion and `routing-version.create`
audit commit together. There is no update/delete API, foreign-key cascade from
drafts, or destructive schema rollback for history.

Version pages contain summaries only, ordered by creation time descending and
ID ascending. Pagination uses the same 1..100 limit and nonnegative offset
contract as drafts; the panel uses pages of 25. The SHA-256 covers the stored
name/rules/chain-depth JSON snapshot, not deployment state or a publication.
Versions are retained without automatic pruning; only one row is allowed per
draft/revision. No history cache or inference hook is installed.

The panel captures only a saved, unchanged, confirmed draft. After a lost
response, retry uses the originally sent draft ID/revision even if the source
has moved on. Loading history requires confirmation before replacing local
edits, preserves simulation samples and creates an unsaved new candidate.
Saving it creates a new draft; it never changes the original version, source
draft or active routing. Pending captures are component-local, not durable
browser storage; after reload, administrators can inspect server history.

### Version History Browser Follow-Up

Follow-up `routing-version-history-live` has parent `d4a4be649`, source
production-readiness gate 4 and reason that the first version-history browser
run stopped at restart/reload. Native, root single writer, low risk, external=0.
The original production objective is unchanged.

Waiting for the selector to be enabled and contain the target option still
failed on the original panel. The version child could take the shared busy
state before the parent's initial draft request; that request was then skipped.
The local fix gates automatic version loading on the initial draft-list result.
It changes no authentication, database, upstream contract or inference path.

On 2026-10-30 the rebuilt panel passed the complete browser flow against SQLite
and private PostgreSQL 18: keyboard draft/capture, revision conflicts, SPA
recovery, committed writes with lost responses, fixed-revision capture retry
after a later source update, historical overwrite confirmation, save-as-new,
gateway/database restart with existing session, source deletion with loadable
history and unchanged active rules. Both runs reported zero page exceptions;
1440x1000, 375x812 and 812x375 light/dark screenshots had no page-level
horizontal overflow. Desktop, phone light/dark and landscape artifacts were
inspected. No timeout or business assertion was weakened.

Evidence is `.codex-tmp/routing-drafts-live.ts`,
`.codex-tmp/routing-versions-live-{sqlite,postgres}-report.json` and
`output/playwright/routing-versions-live-*`. The reports identify HEAD
`d4a4be649` plus the local initialization fix, canonical CLI SHA-256
`8b071c052a0ddafdccd725ab89e7f303ce62697e07b1ec7fc1194987a78a1a4a`
and embedded `index.html` SHA-256
`9694700b2abd916160d81b250e1169f4b50a891f1981723d74ff50ad368267b5`.
The rebuilt CLI records source baseline `d4a4be649`, `vcs.modified=true`,
Go 1.27.3 and the Makefile's macOS PIE/external-link/`sqlite_static` parameters.
After the independent-preview runs passed, both browser flows were repeated
directly against this gateway's embedded UI, without Vite or a development
proxy. The script checks the actual served HTML against the panel index hash
before login. This is a locally built binary, not a released image.
Both runs required successful child-process and private-store cleanup.
Temporary scripts, reports and screenshots are local evidence, not releases.
The final panel suite passed 371 unit tests (2229 assertions) and one proxy
integration test (12 assertions); Svelte diagnostics were clean and the
production build passed. Separate SQLite and PostgreSQL canonical-gateway runtime
runs also passed concurrent capture, replay, audit, restart and source-deletion
contracts. The selector initialization guard has a focused source regression
as well as the real browser reproducer; a source assertion alone does not prove
reactive scheduling.
Publication, online Shadow, rollback and final production acceptance remain
unimplemented or unverified.

## Verification Boundary

### Independent Panel

Panel implementation `b508f90e7` adds paginated list/create/load/update/rename/
delete and reload controls. Only name, rules, chain depth and the expected
revision are submitted; simulation samples are not persisted by the draft API.
Conflicts preserve edits. Network failures, server failures and malformed
successful save responses leave the write outcome unconfirmed and block
subsequent save/delete until recovery or explicit abandonment.

A single in-memory slot preserves local editor state when SPA navigation or
locale changes rebuild the component. A pending write is restored as unconfirmed,
not automatically retried. Authentication changes clear the slot and invalidate
old components' ability to write it back. This is not persistent autosave:
reloading from another page loses this slot without the editor's unload guard.
Candidate text and samples may contain sensitive data; no browser persistent
storage is used.

On 2026-10-30 the focused panel contracts passed 34 tests and 262 assertions,
Svelte checking reported zero errors/warnings, and the production build passed.
The subsequent complete panel run passed 367 unit tests (2198 assertions) and
one API proxy integration test (12 assertions); an earlier proxy timeout is not
counted as a pass. No test timeout or assertions were weakened.
API-fixture browser checks covered create, selection/load, 409 edit retention,
unconfirmed-write protection, SPA recovery and no horizontal overflow at 1440,
375 and 812 pixels. Screenshots use
`output/playwright/routing-drafts-fixture-*`; the phone image was inspected.
The current canonical gateway was then rebuilt and the runtime suite passed for
both isolated SQLite and PostgreSQL 18 stores. Each run verified the
administrator session, request validation, strict unknown-field rejection,
CRUD, competing revisions, audit records, gateway/database restart persistence,
deletion persistence and active-rule isolation. Live browser acceptance passed
against both stores for keyboard create, stale-revision conflict retention,
SPA recovery, response-loss retry locking, reload, delete, light/dark themes
and 1440/812/375 layouts. These are local runtime and browser checks; they do
not prove publication, online Shadow, rollback or production readiness.
The selected option now uses the loaded draft's name and revision, including
after response-loss recovery, instead of displaying a stale list snapshot.
Live screenshots use `output/playwright/routing-drafts-live-*`; temporary
browser scripts, reports and binaries are not release artifacts.

### Backend

The implementation baseline `826067def` was pushed with interrupted Go tests,
not with a passing runtime receipt. The subsequent follow-up adds
registered HTTP, server-compiler, audit-failure and database-close/reopen
regressions, and fixes unknown fallback fields being accepted by the draft
boundary. Source review and formatting are not execution evidence.

On 2026-10-30, the focused handlers, SQLite control-plane and server contracts
below passed with Go 1.27.3, `-mod=readonly -vet=off -p 1 -count=1`.
The administrator-only validation benchmark on Apple M4 with `GOMAXPROCS=2`
measured `43848 ns/op`, `54065 B/op` and `756 allocs/op`. It is not an inference
benchmark and adds no work to inference requests.

The PostgreSQL run initially exposed a timestamp-location comparison mismatch;
assertions now compare every draft field with timestamps normalized to UTC.
Using the rebuilt canonical gateway, the complete SQLite and PostgreSQL 18
runtime acceptance suites passed and confirmed temporary-store cleanup.
A later default-vet control-plane rerun on `b508f90e7` was explicitly
interrupted with exit 130 while vet was still running and before test results
were available. That interrupted attempt supplies no pass receipt. Subsequent
private PostgreSQL `TestRoutingDraft*` tests and separate `go vet` for
controlplane, handlers and server completed successfully. No Go source changed
in the current panel/runtime-test increment.

Run the focused contracts from `transports/`:

```sh
GOWORK=off go test -mod=readonly -count=1 \
  ./bifrost-http/controlplane -run '^TestRoutingDraft'
GOWORK=off go test -mod=readonly -count=1 \
  ./bifrost-http/handlers -run '^TestValidateRoutingDraft'
GOWORK=off go test -mod=readonly -count=1 \
  ./bifrost-http/server -run '^TestRouting(Draft|Simulation)'
```

Use `scripts/test-controlplane-postgres.sh -run '^TestRoutingDraft'` for the
same control-plane contracts on a private, explicit PostgreSQL backend.
No existing database, production system or paid provider is used.
Record successful executions against the final source before treating this
increment as locally accepted. This does not close the full production
publication, rollback, Shadow or deployment gates.
