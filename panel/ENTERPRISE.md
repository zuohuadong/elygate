# Enterprise panel extension

The lightweight Svelte panel only shows enterprise resources backed by a loaded
plugin capability or a supplied enterprise page. Direct navigation keeps an
explicit OSS fallback, while enterprise builds replace those pages without
forking `App.svelte`.

Set `BIFROST_ENTERPRISE_PANEL_PATH` to the absolute path of a TypeScript module
before running `bun run build`. The module must export:

```ts
import type { Component } from 'svelte';

export const enterprisePanelAvailable = true;
export const enterpriseResourcePages: Record<string, { list: Component<{ resourceName: string }> }> = {
  users: { list: UsersPage },
  rbac: { list: RbacPage },
  'guardrails-config': { list: GuardrailsPage },
};

export const enterprisePublicPages = {
  'oauth-consent': EnterpriseOAuthConsentPage,
  'mcp-auth': EnterpriseMcpAuthPage,
  'mcp-auth-success': EnterpriseMcpAuthResultPage,
  'mcp-auth-failed': EnterpriseMcpAuthResultPage,
  'mcp-oauth-callback': EnterpriseMcpOAuthCallbackPage,
  'agent-handover': EnterpriseAgentHandoverPage,
  'scim-oauth-callback': EnterpriseScimOAuthCallbackPage,
};
```

The exported keys match the resource names in `src/lib/resources.ts`. An
enterprise module may override any built-in page, but should normally provide
the enterprise resources listed by `src/lib/menu-policy.ts`. Every page receives
the standard svadmin `resourceName` prop and should use same-origin `/api/*`
requests so server authentication and authorization remain authoritative.

`enterprisePublicPages` is optional at runtime for compatibility with older
bundles. It overrides direct-navigation pages that must remain outside the
svadmin hash router. Each public page receives a `route` prop and must preserve
the existing URL/query/fragment contract. In particular, temporary credentials
must only be sent through `X-Bifrost-Temp-Token`, fragments must be stripped
after capture, and redirects must reject executable protocols. This lets an
enterprise bundle add signed-in-user consent or branded handoff flows without
forking the panel shell.

If the variable is absent, the build resolves
`src/enterprise-fallback/index.ts`, exports no overrides, and keeps the explicit
“enterprise backend required” pages for direct URLs while hiding unavailable
menu entries. Set `BIFROST_REQUIRE_ENTERPRISE_PANEL=true` in enterprise build
jobs so a missing `BIFROST_ENTERPRISE_PANEL_PATH` fails the build instead of
silently producing an OSS image.

For a container build, pass the private module directory as the isolated named
build context `enterprise_panel`; do not pass a host path through the build
argument. The context root must contain `index.ts`:

```sh
docker buildx build \
  --file transports/Dockerfile \
  --build-context enterprise_panel=/absolute/path/to/private-panel-module \
  --build-arg BIFROST_ENTERPRISE_PANEL_PATH=/opt/elygate-enterprise-panel/index.ts \
  --build-arg BIFROST_REQUIRE_ENTERPRISE_PANEL=true \
  .
```

The private context is copied only into the UI build stage and is not present
in the final runtime image. Ordinary Docker builds use the OSS fallback stage
and leave `BIFROST_ENTERPRISE_PANEL_PATH` unset.

Runtime plugins may also expose `PluginMetadata.Features`. Active feature IDs
matching resource names make their menu entries visible and route to the scoped
plugin configuration page. `adaptive-routing` is owned by the built-in
governance plugin and always routes to the real routing-rules workflow.

`GetPluginMetadata` is optional only for plugins built against the same Elygate
source and Go toolchain. Go shared objects do not provide a stable cross-version
ABI; rebuild `.so` plugins for each Elygate version as required by the
[Go plugin warnings](https://pkg.go.dev/plugin#hdr-Warnings).
