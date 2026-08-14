# Enterprise panel extension

`panel/` is Elygate's independently maintained Svelte management panel. It is
not an overlay on Bifrost's upstream `ui/`, and upstream UI source is not merged
into this directory. Shared Elygate management workflows belong directly in
`panel/`; this extension boundary is reserved for private licensing, customer
customization, or deployment-specific enterprise features.

The panel only shows those private enterprise resources when they are backed by
a loaded plugin capability or a supplied enterprise page. Direct navigation
keeps an explicit OSS fallback, while enterprise builds replace those pages
without forking `App.svelte`.

Set `BIFROST_ENTERPRISE_PANEL_PATH` to the absolute path of a TypeScript module
before running `bun run build`. New modules should export one manifest so the
resource registry, menu placement, pages, public flows, and translations stay
inside the extension boundary:

```ts
import type { Component } from 'svelte';

export const enterprisePanelAvailable = true;
export const enterprisePanelManifest = {
  resources: [
    {
      name: 'users',
      icon: 'user-round',
      menuGroup: 'governance',
      menuOrder: 300,
      labels: { 'zh-CN': '用户管理', en: 'Users' },
    },
  ],
  resourcePages: {
    users: { list: UsersPage },
    rbac: { list: RbacPage },
    'guardrails-config': { list: GuardrailsPage },
  } satisfies Record<string, { list: Component<{ resourceName: string }> }>,
  publicPages: {
    'oauth-consent': EnterpriseOAuthConsentPage,
    'mcp-auth': EnterpriseMcpAuthPage,
    'mcp-auth-success': EnterpriseMcpAuthResultPage,
    'mcp-auth-failed': EnterpriseMcpAuthResultPage,
    'mcp-oauth-callback': EnterpriseMcpOAuthCallbackPage,
    'agent-handover': EnterpriseAgentHandoverPage,
    'scim-oauth-callback': EnterpriseScimOAuthCallbackPage,
  },
  translations: {
    'zh-CN': { 'enterprise.users.description': '管理企业用户与访问状态' },
    en: { 'enterprise.users.description': 'Manage enterprise users and access' },
  },
};
```

`menuGroup` accepts `observability`, `models-group`, `mcp`, `governance`,
`guardrails`, `edge-control`, `integrations`, or `system`. Manifest resource
names become the capability allowlist. Optional `menuOrder` controls stable
group ordering; built-in entries use increments of 100, so extensions can be
placed between them without editing the shared menu. Adding a private resource
no longer requires editing `App.svelte`, `resources.ts`, or `menu-policy.ts`.
Every page receives the standard svadmin `resourceName` prop and should use
same-origin `/api/*` requests so server authentication and authorization remain
authoritative.

For compatibility, modules may still export the legacy
`enterpriseResourcePages` and `enterprisePublicPages` maps. Manifest entries
take precedence when both forms provide the same key. New work should use the
manifest; the legacy maps are migration-only.

`publicPages` is optional at runtime. It overrides direct-navigation pages that
must remain outside the svadmin hash router. Each public page receives a
`route` prop and must preserve
the existing URL/query/fragment contract. In particular, temporary credentials
must only be sent through `X-Bifrost-Temp-Token`, fragments must be stripped
after capture, and redirects must reject executable protocols. This lets an
enterprise bundle add signed-in-user consent or branded handoff flows without
forking the panel shell.

If the variable is absent, the build resolves
`src/enterprise-fallback/index.ts`, exports no capability page overrides, and
keeps the shared resource/menu metadata plus the explicit
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
