# Routing Policy Drafts

Routing drafts are administrator-owned, durable candidates. They do not change
the active Bifrost rule store, install a routing plugin, or call a provider.
The independent panel provides a saved-draft workflow in its offline simulation
view. Policy publication, immutable release versions, rollback and online Shadow
remain separate unfinished work.

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
The subsequent complete panel run passed 366 unit tests (2196 assertions) and
one API proxy integration test (12 assertions); an earlier proxy timeout is not
counted as a pass. No test timeout or assertions were weakened.
API-fixture browser checks covered create, selection/load, 409 edit retention,
unconfirmed-write protection, SPA recovery and no horizontal overflow at 1440,
375 and 812 pixels. Screenshots use
`output/playwright/routing-drafts-fixture-*`; the phone image was inspected.
These checks do not prove draft CRUD against a real gateway, PostgreSQL browser
integration, complete theme/keyboard acceptance or production readiness.

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

The PostgreSQL run exposed a timestamp-location comparison mismatch in the
tests, plus database create/drop timeouts and the five-minute suite timeout.
Assertions now compare every draft field with timestamps normalized to UTC;
the updated SQLite suite passed again. The targeted PostgreSQL rerun and
three-package `go vet` were interrupted after prolonged waits without a result.
PostgreSQL and static-analysis acceptance remain incomplete.
A later default-vet control-plane rerun on `b508f90e7` was explicitly
interrupted with exit 130 while vet was still running and before test results
were available. It supplies no new backend pass receipt.

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
