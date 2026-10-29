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
run the opt-in test separately from the fast panel suite:

This entrypoint is not yet a passing release gate: the fresh gateway link was
interrupted locally. Do not substitute older stdin-driven acceptance wrappers
for the canonical CLI or count this test as passed without a complete run.

```sh
mkdir -p .codex-cache/go-build .codex-tmp
GOCACHE="$PWD/.codex-cache/go-build" GOTMPDIR="$PWD/.codex-tmp" \
  go build -o .codex-tmp/relay-gateway ./transports/bifrost-http
ELYGATE_TEST_BINARY="$PWD/.codex-tmp/relay-gateway" \
  bun run --cwd panel test:relay-runtime
```

The test uses the panel's serializers and the real gateway API, including
administrator login, unsaved usage preview, a redacted credential round trip,
application keys, relay grants, local upstream forwarding, SSE, costs,
persisted logs, CSV export and application-binding revocation.
It uses private temporary SQLite databases, random test credentials,
loopback listeners and local catalog files. Child processes receive only an
explicit test environment, not the caller's provider credentials.
Successful completion requires graceful child exits and temporary-directory
cleanup. A missing binary fails rather than skipping.

This is local API acceptance, not browser rendering, real provider billing,
PostgreSQL, container-image, production or recovery acceptance.

This migration changes browser dependencies and build output only. It adds
no work or retained state to the Go inference request path.
