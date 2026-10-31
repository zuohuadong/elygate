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

## Evidence

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
