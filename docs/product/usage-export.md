# Usage Ledger CSV Export

## Contract

`GET /api/control-plane/usage/export` uses the same filters as the usage
ledger list and summary routes. `limit` and `offset` are intentionally ignored
for the export. Rows are ordered by `occurred_at DESC, id DESC`, including
ties, and the CSV header and formula-safe text encoding match the existing
panel contract.

The export is generated completely before the HTTP response is marked
successful. The control plane holds one database cursor while it scans matching
rows and writes them one at a time to a private `0600` temporary file. The
application does not retain the full ledger or CSV body in memory. After the
cursor closes, the file is rewound and streamed through fasthttp; normal
completion, response reset, client disconnect, and generation errors close and
remove the temporary file.

The temporary file consumes disk space proportional to the CSV size for the
duration of one export. The existing 30-second control-plane operation context
bounds query generation; this is not a resumable or background export job.
An interrupted process can leave an operating-system temporary file for normal
operator cleanup. This local validation does not prove PostgreSQL crash
recovery, production filesystem quotas, or reverse-proxy download limits.

## Initial Evidence

On 2026-10-31, SQLite control-plane tests passed, including a 100,001-row
filtered export, formula escaping, pagination omission, empty/completed/
abandoned/reset stream cleanup, cancellation and database/file failures.
The initial focused export tests passed against a private PostgreSQL 18.4 Unix
socket cluster in 38.264 seconds. Added SQLite tests subsequently passed in
1.532 seconds for a single-query snapshot during concurrent insert/update/delete
and for complete downloads and client disconnect cleanup through fasthttp
`ServeConn` over `net.Pipe`. Those two added tests have not yet been rerun against
PostgreSQL. They do not validate a real browser, authentication stack, or
production reverse proxy.

Formatting and diff checks passed. The final `go vet` invocation failed to
resolve the standard-library `bufio` import; a default-vet test retry was
interrupted during package loading, so neither check is recorded as a pass.

A single benchmark sample on Apple M4 for 1,000 rows measured
`8.30ms/op`, `2.87MB/op`, and `47,178 allocs/op`; this measures the management
export only and is not an inference-path or production-capacity guarantee.

## Verification Follow-Up

Follow-up `usage-export-verification` has parent `84fb36401`, source the usage
production-readiness gate, and reason that the earlier record did not cover
PostgreSQL concurrent snapshots, HTTP cleanup or successful final vet.
Native, low risk, root is the sole writer; only tests, CI and evidence change.
The full product/production objective remains active/PARTIAL.

On October 31, 2026, the private PostgreSQL 18.4 runner passed all seven
`^TestUsageCSVExport` top-level tests in 66.869 seconds, including concurrent
insert/update/delete snapshot isolation and fasthttp `ServeConn` cleanup after
normal download and client disconnect. The runner checked for remaining owned
test databases and stopped its private cluster successfully. Evidence directory:
`/Volumes/Datas/.codex-tmp/elygate-cp-pg.UdnhQy`.
An earlier run was interrupted after linking and entering its first test; it is
not counted as a pass. The successful rerun used `-ldflags=-linkmode=external`.
This remains local socket-only PostgreSQL evidence, not browser/proxy,
authentication, process-crash, power-loss or production acceptance.

The same seven top-level tests passed on SQLite with `-race -count=1` in
23.340 seconds, with no failures, skips or race reports. This includes the
100,001-row case, snapshot mutation and both HTTP transport subcases; it is not
a PostgreSQL race run or a whole-repository race result.

Control-plane `go vet -mod=readonly -p 1 ./bifrost-http/controlplane` completed
successfully with Go 1.27.3 using `.codex-cache/go-build-vet-routing`; the earlier
`bufio` resolution error is retained as historical failure, not a current pass.
Pi `gomodel/code` was invoked to author the benchmark improvement, but exited 1
with `Connection error` and no patch. Root implemented the change; there is no
successful Pi implementation or review result to claim.

The benchmark now checks the exact header, 1,000 rows, ordering, cost and
temporary-file cleanup before timing. Timed work drains and closes the response
without CSV parsing. Baseline and current fixtures use identical distinct
timestamps and key IDs; the baseline uses the pre-fix `49611f9bd` handler/store
through a local Go overlay, not a reset of the checkout. Apple M4, Go 1.27.3,
`GOMAXPROCS=4`, external linking, `-benchtime=100x -count=3 -benchmem` medians:

| Management Export | ns/op | B/op | allocs/op |
| --- | ---: | ---: | ---: |
| Before | 7,160,540 | 2,597,006 | 44,201 |
| Complete cursor/file export | 11,613,465 | 2,896,944 | 49,152 |

This sample is about 62% slower with about 11% more total allocations. It
measures the cost of a private file and complete generation, not peak retained
memory, large-export capacity, statistical significance or inference overhead.
The earlier single sample used a different fixture and is not a comparison.

Live CI run `41185192165` passed for `84fb36401`, but its API-contract selection
did not execute these CSV tests. Follow-up `usage-export-ci-coverage` adds a
separate `^TestUsageCSVExport` step with its own 180-second timeout, preserving
the existing API-contract command and timeout. The workflow contract failed on
the missing step before the change; all 18 build-contract tests (138 assertions)
passed afterward. The workflow change is included in this push and still needs a
new hosted CI run before it can be counted as CI evidence.
