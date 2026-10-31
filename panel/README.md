# Elygate Panel

The independent Elygate management panel uses Svelte 5 and Vite. Backend
contracts and capability boundaries are documented in [PARITY.md](PARITY.md).

## SVAdmin Dependencies

Versions verified against the npm `latest` tags on 2026-10-31:

| Package | Version |
| --- | --- |
| `@svadmin/core` | `0.67.0` |
| `@svadmin/ui` | `0.102.0` |

The UI peer dependency requires `@svadmin/core ^0.67.0`. Both packages share
the panel's Svelte and TanStack Query instances; keep the Vite dependency
optimization exclusions when upgrading.

The published UI package now contains its build version in `AboutSettings`.
The earlier localization, resource visibility, search, shortcut, logo and
settings fixes are upstream; regression tests inspect the installed package
instead of carrying a local `dist` patch.

Config pages, shared settings fields and the model list reuse SVAdmin's default
page, form, table, feedback and pagination components. The panel retains its
backend serializers, unknown config fields, redacted credentials, JSON mode
and request-race guards. Restart notices remain visible alongside save errors.

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

For browser migration acceptance, start Vite on loopback port 3011, open a
dedicated Playwright CLI session, then run the fixture from the repository root:

```sh
bunx --no-install vite --host 127.0.0.1 --port 3011 --strictPort
# In another terminal, from the repository root:
playwright-cli -s=svadmin-migration open about:blank
playwright-cli -s=svadmin-migration run-code --filename panel/tests/svadmin-migration.browser.mjs
playwright-cli -s=svadmin-migration close
```

The suite intercepts all `/api/*` calls before loading the app. Its 64 checks
cover bindings, label/keyboard access, duplicate-submit prevention, failure
recovery, restart notices, page-size changes, paging and responsive light/dark
layouts. Screenshots are written under `output/playwright/svadmin-*.png`.
This is fixture acceptance, not a live backend or production receipt.

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
  go build -buildvcs=false -trimpath -buildmode=pie -ldflags="-linkmode=external -w -s -X main.Version=v$(git rev-parse HEAD)" \
    -tags=sqlite_static -o .codex-tmp/relay-gateway ./transports/bifrost-http
ELYGATE_TEST_BINARY="$PWD/.codex-tmp/relay-gateway" \
ELYGATE_TEST_COMMIT="$(git rev-parse HEAD)" \
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
cleanup. A missing binary or full candidate commit fails rather than skipping.
The authenticated version endpoint must match that commit at first login and
after PostgreSQL restart and restore; an older executable cannot count as the
current candidate's receipt. The version label is not a build attestation:
also retain build inputs, command, binary checksum and source-diff evidence.

For PostgreSQL, set only the absolute tool directory, not a connection string
or an existing database. The test creates and owns an isolated cluster:

```sh
ELYGATE_TEST_BINARY="$PWD/.codex-tmp/relay-gateway" \
ELYGATE_TEST_COMMIT="$(git rev-parse HEAD)" \
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

Both compact and signed audit modes run. Signed mode stores literal relay
credentials and an extra header encrypted, restores the permission-restricted
runtime secret bundle from the application backup, and checks the original
signing public key, audit chain and subsequent chain extension. Restored login,
logout and new writes must also succeed.

All private databases and processes must be removed before the workspace is
deleted, including the temporary dumps and app copy. No existing database,
real provider credentials or deployment is involved.
This is scoped local Relay API/recovery acceptance, not browser rendering,
real provider billing, password/TLS authentication, external key-management recovery,
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
revisions, concurrent immutable version capture, idempotent replay, audit records
and no changes to active rules. Simulation samples are excluded from saved
payloads. A gateway restart (plus PostgreSQL restart when selected) must retain
the complete draft, immutable versions and the existing administrator session;
a subsequent restart must retain deletion. Historical versions must remain
readable and replayable after the source draft is updated or deleted, without
appending another capture audit.

Only this test's temporary databases and processes are used and cleaned up.
A missing executable fails. This is local API/serializer acceptance, not
browser interaction, publication, online Shadow, rollback or production proof.
It adds no hooks, allocations or retained state to the inference path.

This migration changes browser dependencies and build output only. It adds
no work or retained state to the Go inference request path.

## Local Employee Login Runtime Acceptance

After building the current canonical CLI, run:

```sh
ELYGATE_TEST_BINARY="$PWD/.codex-tmp/relay-gateway" \
  bun run --cwd panel test:employee-runtime
```

This opt-in suite drives the registered employee routes through the real
gateway. It covers administrator login, employee creation and login/logout,
anonymous failed-login audit records, source admission exhaustion, account
lockout, audit persistence failure with 401 preservation, compact and signed
SQLite audit modes, restart persistence and signed-chain verification. It uses
fresh loopback-only SQLite fixtures, random credentials, an isolated trigger
for the failure-injection case and requires graceful process and directory
cleanup.

For PostgreSQL, set the same absolute `ELYGATE_TEST_POSTGRES_BIN` tool directory
described above. Do not pass a connection string or point it at an existing
cluster:

```sh
ELYGATE_TEST_BINARY="$PWD/.codex-tmp/relay-gateway" \
ELYGATE_TEST_POSTGRES_BIN=/opt/homebrew/opt/postgresql@18/bin \
  bun run --cwd panel test:employee-runtime
```

Each mode owns a new socket-only UTF8 cluster with two databases, keeps
durability enabled and checks both configured connections and the absence of
SQLite fallback files. Two normal database/gateway restarts must retain the
administrator session, audit feed and active employee lock. Only this private
database receives the audit-rejection trigger; removing it must restore audit
writing. Success also requires database, process and temporary-directory
cleanup. This is scoped local HTTP/runtime evidence, not reverse-proxy,
container, crash/power-loss, backup/restore, password/TLS, real-provider or
production acceptance.
