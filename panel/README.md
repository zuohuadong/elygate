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
bun test
bun run check
bunx --no-install vite build
```

`bun run build` additionally copies the output into the HTTP transport's
embedded UI directory. Use the direct Vite build when only validating the
panel, without replacing backend build assets.

This migration changes browser dependencies and build output only. It adds
no work or retained state to the Go inference request path.
