# Elygate Panel

The independent Elygate management panel uses Svelte 5 and Vite. Backend
contracts and capability boundaries are documented in [PARITY.md](PARITY.md).

## SVAdmin Dependencies

Versions verified against the npm `latest` tags on 2026-10-29:

| Package | Version |
| --- | --- |
| `@svadmin/core` | `0.66.2` |
| `@svadmin/ui` | `0.96.1` |

The UI peer dependency requires `@svadmin/core ^0.66.2`. Both packages share
the panel's Svelte and TanStack Query instances; keep the Vite dependency
optimization exclusions when upgrading.

The Bun patch only fills the UI package's unreplaced `__SVADMIN_VERSION__`
in `AboutSettings`, preserving the component's explicit version override.
The earlier localization, resource visibility, search, shortcut, logo and
settings fixes are now upstream. Regression tests check the installed
components rather than requiring those fixes to remain in a local patch.
Remove the remaining patch once npm ships a populated build version.

## Local Validation

```sh
bun install --frozen-lockfile
bun run test
bun run check
bunx --no-install vite build
```

`bun run test` runs unit tests and the Vite proxy integration test in separate
processes, preserving the proxy test's assertions and timeout.

`bun run build` additionally copies the output into the HTTP transport's
embedded UI directory. Use the direct Vite build when only validating the
panel, without replacing backend build assets.

## Local Relay Runtime Acceptance

From the repository root, build the gateway from the current Go sources, then
run the opt-in test separately from the fast panel suite. This macOS native
example uses the same PIE/external-link parameters as the Makefile:

Do not substitute older stdin-driven acceptance wrappers for the canonical CLI
or count the test as passed without a complete run. For other platforms, use
the corresponding native build parameters from the Makefile.

```sh
mkdir -p .codex-cache/go-build .codex-tmp
GOCACHE="$PWD/.codex-cache/go-build" GOTMPDIR="$PWD/.codex-tmp" \
  go build -trimpath -buildmode=pie -ldflags="-linkmode=external -w -s" \
    -tags=sqlite_static -o .codex-tmp/relay-gateway ./transports/bifrost-http
ELYGATE_TEST_BINARY="$PWD/.codex-tmp/relay-gateway" \
  bun run --cwd panel test:relay-runtime
```

The test uses the panel's serializers and the real gateway API, including
administrator login, unsaved usage preview, a redacted credential round trip,
application key creation/rotation/expiry/revocation, relay grants, local
upstream forwarding, SSE, costs, persisted logs, CSV export and
application-binding revocation. Each denied lifecycle request must leave
the local upstream's hit counter at zero.
It uses private temporary SQLite databases, random test credentials,
loopback listeners and local catalog files. Child processes receive only an
explicit test environment, not the caller's provider credentials.
Successful completion requires graceful child exits and temporary-directory
cleanup. A missing binary fails rather than skipping.

For PostgreSQL, set only the absolute tool directory, not a connection string
or an existing database. The test creates and owns an isolated cluster:

```sh
ELYGATE_TEST_BINARY="$PWD/.codex-tmp/relay-gateway" \
ELYGATE_TEST_POSTGRES_BIN=/opt/homebrew/opt/postgresql@18/bin \
  bun run --cwd panel test:relay-runtime
```

The directory must contain `initdb`, `postgres`, `pg_ctl`, `pg_isready`,
`psql`, `pg_dump` and `pg_restore` from the same PostgreSQL installation.
The cluster listens only on its private 0700 Unix socket, rejects host
authentication and keeps `fsync`, `synchronous_commit` and
`full_page_writes` enabled. Configuration and logs use distinct new databases;
both live connections and the absence of SQLite fallback files are checked.

After the lifecycle, this variant restarts PostgreSQL and the canonical
gateway without logging in again. It checks the saved relay, grants, active,
expired and revoked keys, audit feed and logs. Startup's intentional
expired-binding revocation is asserted separately, not mistaken for data loss.
With the gateway stopped and both pools closed, it uses `pg_dump`/`pg_restore`
to restore both databases into different fresh databases and copies the app
directory from its backup. All public table rows and sequence state are
compared before boot; source databases must remain unchanged, including after
restored writes. The restored gateway must retain the admin session, deny
expired/revoked keys before upstream access, forward with the active key,
read/export logs and create a new application key. A local upload-directory
probe verifies copied bytes, not the Skills/upload API lifecycle.

All private databases and processes must be removed before the workspace is
deleted, including the temporary dumps and app copy. No existing database,
real provider credentials or deployment is involved.
This is scoped local Relay API/recovery acceptance, not browser rendering,
real provider billing, password/TLS authentication, encrypted-key recovery,
other product workflows, crash recovery, version rollback, container-image
or production acceptance.

## Local Routing Draft Runtime Acceptance

After building the current canonical CLI with the parameters above, run:

```sh
ELYGATE_TEST_BINARY="$PWD/.codex-tmp/relay-gateway" \
  bun run --cwd panel test:routing-drafts-runtime
```

Add `ELYGATE_TEST_POSTGRES_BIN` as above for a new private PostgreSQL cluster.
This opt-in suite drives the real draft API with the panel's payload builders
and response parsers. It checks authentication, foreign Origin and media-type
rejection, strict rule validation, list/create/read/update/delete, competing
revisions, audit records and no changes to active rules. Simulation samples
are excluded from saved payloads. A gateway restart (plus PostgreSQL restart
when selected) must retain the complete draft and the existing administrator
session; a subsequent restart must retain deletion.

Only this test's temporary databases and processes are used and cleaned up.
A missing executable fails. This is local API/serializer acceptance, not
browser interaction, publication, online Shadow, rollback or production proof.
It adds no hooks, allocations or retained state to the inference path.

This migration changes browser dependencies and build output only. It adds
no work or retained state to the Go inference request path.
