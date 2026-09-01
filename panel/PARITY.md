# Panel parity matrix

This matrix maps the legacy React console routes to the lightweight Svelte
panel. It distinguishes functional parity from private enterprise
implementation so an OSS build never claims APIs that are not present.

`panel/` is an Elygate-owned management surface, not a downstream copy of
Bifrost `ui/`. This matrix records the backend API contract consumed by the
independent panel; it does not create a source-level parity obligation with the
upstream UI.

## Backend API contract policy

- Existing same-origin `/api/*` routes, authentication and authorization
  behavior, request and response fields, pagination, error semantics, and
  public callback flows are compatibility contracts for `panel/`.
- Backend changes used by the panel must be additive or backward compatible.
  A necessary breaking change requires a documented migration, a coordinated
  panel update, and regression coverage for both sides of the contract.
- Add or update the route entry in this matrix whenever the panel starts using
  a new backend API or changes an existing workflow contract.
- Contract-specific Elygate behavior should live in a narrow adapter, plugin,
  or sidecar when practical. Generic Bifrost improvements should be proposed
  upstream instead of accumulating permanent patches in `core/`, `framework/`,
  or HTTP handlers.

## Status legend

- **Dedicated**: purpose-built Svelte workflow with the legacy page's primary interactions.
- **Alias**: the legacy route was a redirect or duplicate surface; the panel points to the canonical workflow.
- **Enterprise extension**: capability-gated menu plus a build-time page override; direct URLs retain an explicit fallback.
- **Public flow**: direct-navigation page outside the svadmin hash router.

## OSS and shared management routes

| Legacy route(s) | Panel surface | API contract | Status |
| --- | --- | --- | --- |
| `/login` | svadmin login + Bifrost auth provider | `/api/session/is-auth-enabled`, `/api/session/login`, `/api/session/logout` | Dedicated |
| `/workspace/dashboard` | dashboard | `/api/logs/dashboard` | Dedicated |
| `/workspace/logs` | logs | `/api/logs*`, `/api/ws`, cost recalculation and selected deletion | Dedicated |
| `/workspace/logs/connectors`, `/workspace/observability` | connectors | `/api/plugins`, `/api/plugins/{name}` | Dedicated |
| `/workspace/mcp-logs`, legacy `/workspace/logs/mcp-logs` | mcp-logs | `/api/mcp-logs*` | Dedicated |
| `/workspace/providers` | providers | `/api/providers*`, provider/key refresh routes | Dedicated |
| provider API-key fragment under `/workspace/providers` | provider-keys | `/api/providers/{provider}/keys*` | Dedicated + Alias |
| provider governance fragment under `/workspace/providers` | provider-governance | `/api/providers`, `/api/governance/providers*` budgets, rate limits and calendar alignment | Dedicated |
| `/workspace/model-catalog` | model-catalog | `/api/providers`, `/api/models`, `/api/models/details`, `/api/models/catalog`, log stats/histograms | Dedicated |
| `/workspace/model-limits`, `/workspace/providers/model-limits` | model-configs, budgets, rate-limits | `/api/governance/model-configs*` | Dedicated + Alias |
| `/workspace/routing-rules`, `/workspace/routing-rules/tree`, `/workspace/providers/routing-rules` | routing-rules list/tree | `/api/governance/routing-rules*` | Dedicated + Alias |
| `/workspace/complexity-router` | complexity-router / complexity-analyzer | `/api/governance/complexity-analyzer-config`, ordered tier spectrum, normalized keyword groups, reset and hot reload | Dedicated + Alias |
| `/workspace/custom-pricing`, `/workspace/custom-pricing/overrides` | pricing-config, model-catalog, pricing-overrides | `/api/config`, `/api/pricing/force-sync`, `/api/governance/pricing-overrides*` scopes, model patterns, request types, full numeric patch | Dedicated |
| `/workspace/governance/virtual-keys`, `/workspace/virtual-keys` | virtual-keys | `/api/governance/virtual-keys*` | Dedicated + Alias |
| `/workspace/governance/teams` | teams | `/api/governance/teams*` customer assignment, multi-budget, rate limits, calendar alignment | Dedicated |
| `/workspace/governance/customers` | customers | `/api/governance/customers*` multi-budget, rate limits, calendar alignment | Dedicated |
| `/workspace/governance` | virtual-keys | canonical governance entry | Alias |
| `/workspace/mcp-registry` | mcp-clients | `/api/mcp/clients`, `/api/mcp/client*` | Dedicated |
| `/workspace/mcp-registry/library` | mcp-library | `/api/mcp/library*`, `/api/config`, force sync | Dedicated |
| `/workspace/mcp-registry/oauth-callback` | direct callback page | opener `postMessage`, safe same-origin target | Public flow |
| `/workspace/mcp-sessions` | mcp-sessions | `/api/mcp/sessions*`, reauth and revoke | Dedicated |
| `/workspace/mcp-sessions/auth` | direct OAuth/header credential flow | `/api/oauth/per-user/flows*`, `/api/mcp/per-user-headers/flows*` | Public flow |
| `/workspace/mcp-sessions/auth-success`, `/workspace/mcp-sessions/auth-failed` | direct result pages | query-driven result rendering | Public flow |
| `/workspace/oauth-grants` | oauth-grants | `/api/oauth2/sessions*` | Dedicated |
| `/oauth/consent` | direct consent page | `/api/oauth2/consent/flows/{id}` | Public flow |
| `/workspace/mcp-settings` | mcp-settings | `/api/config` MCP fields | Dedicated form + JSON fallback |
| `/workspace/config` | config | `/api/config` | Dedicated form + JSON fallback |
| `/workspace/config/client-settings`, legacy `/workspace/config/large-payload` | client-settings, large-payload-config | `/api/config` client/security/performance fields | Dedicated + Alias |
| user-agent mappings under `/workspace/config/client-settings` | user-agent-mappings | `/api/logs/user-agent-mappings*` match rules, safe logo upload and active state | Dedicated |
| `/workspace/config/compatibility` | compatibility-config | `/api/config` compatibility fields | Dedicated form + JSON fallback |
| `/workspace/config/caching` | caching-config | `/api/config`, `/api/cache/clear*` | Dedicated |
| `/workspace/config/feature-flags` | feature-flags | `/api/feature-flags*` source, lock, registration and enterprise gating | Dedicated |
| `/workspace/config/logging` | logging-config | `/api/config` logging fields | Dedicated form + JSON fallback |
| `/workspace/config/mcp-gateway` | mcp-gateway-config | `/api/config` MCP/framework fields | Dedicated form + JSON fallback |
| `/workspace/config/observability` | observability-config | `/api/config` logging/performance fields | Dedicated form + JSON fallback |
| `/workspace/config/performance-tuning` | performance-config | `/api/config` performance fields | Dedicated form + JSON fallback |
| `/workspace/config/pricing-config` | pricing-config | `/api/config`, `/api/pricing/force-sync` | Dedicated |
| `/workspace/config/security` | security-config | `/api/config` auth/security fields | Dedicated form + JSON fallback |
| `/workspace/config/proxy` | proxy-config | `/api/proxy-config` HTTP(S), redacted credentials, bypass/TLS/timeout, SCIM/inference/API enablement, runtime reload | Dedicated |
| `/workspace/plugins` | plugins | `/api/plugins*` built-in/custom install, runtime status/logs, typed hook badges, safe redacted config round-trip, enable/disable/delete, execution sequence | Dedicated |
| `/workspace/prompt-repo`, `/workspace/prompt-repo/prompts` | prompt-folders, prompts | `/api/prompt-repo/*` versions and draft sessions | Dedicated + Alias |
| `/workspace/skills-repo` | skills | `/api/skills*` files, versions, serving and cleanup | Dedicated |
| `/workspace/webhooks` | webhooks | `/api/webhooks*` test, secret rotation, delivery inspect/redeliver | Dedicated |
| `/workspace/docs` | docs-hub | bundled docs + official documentation links | Dedicated |
| `/pprof` | pprof | `/api/dev/pprof*` | Dedicated |

## Enterprise extension routes

The following legacy routes import private enterprise implementations or need
private APIs absent from this checkout. Their menu entries appear only when a
runtime plugin declares the matching manifest resource or
`enterprisePanelManifest.resourcePages` provides the page. Direct callbacks
and handoff pages use `enterprisePanelManifest.publicPages`. Legacy page-map
exports remain supported during migration.

| Legacy route(s) | Resource/public key | OSS behavior | Enterprise contract |
| --- | --- | --- | --- |
| `/workspace/governance/users` | `users` | explicit enterprise fallback | resource override |
| `/workspace/governance/business-units` | `business-units` | explicit enterprise fallback | resource override |
| `/workspace/governance/rbac`, `/workspace/rbac` | `rbac` | explicit enterprise fallback / alias | resource override |
| `/workspace/scim` | `scim` | explicit enterprise fallback | resource override |
| `/workspace/scim/oauth-discover-callback` | `scim-oauth-callback` | safe public fallback | public-page override |
| `/workspace/governance/access-profiles` | `access-profiles` | explicit enterprise fallback | resource override |
| `/workspace/audit-logs` | `audit-logs` | explicit enterprise fallback | resource override |
| `/workspace/alerting/channels`, `/rules`, `/history` | `alerting-*` | explicit enterprise fallback | resource overrides |
| `/workspace/guardrails`, `/configuration`, `/providers` | `guardrails-*` | explicit enterprise fallback | resource overrides |
| `/workspace/edge-control/devices`, `/inventory`, `/config` | `edge-*` | explicit enterprise fallback | resource overrides |
| `/workspace/config/api-keys` | `api-keys` | explicit enterprise fallback | resource override |
| `/workspace/config/license` | `license-info` | explicit enterprise fallback | resource override |
| `/workspace/mcp-tool-groups` | `mcp-tool-groups` | explicit enterprise fallback | resource override |
| `/workspace/mcp-auth-config` | `mcp-auth-config` | explicit enterprise fallback | resource override |
| `/workspace/cluster` | `cluster` | explicit enterprise fallback | resource override |
| `/workspace/circuit-breaker` | `circuit-breaker` | explicit enterprise fallback | resource override |
| `/workspace/adaptive-routing`, `/settings` | `adaptive-routing` | real governance routing-rules workflow | optional resource override |
| `/agent/handover` | `agent-handover` | safe public fallback | resource and public-page override |

## Completion gates

Every built-in route above resolves to a dedicated workflow or an explicit
alias. No built-in route falls back to the generic CRUD or raw JSON page.

- Unit tests must prove resource/menu coverage, public route preservation, OAuth redirect safety, model attribute validation, and model-limit payload validation.
- `svelte-check` and the production build must pass after every behavior change.
- Browser smoke must cover a desktop and narrow viewport plus direct OAuth/MCP routes; an HTTP 200 fallback document alone is not sufficient.
- Enterprise behavior is complete only when a real private module is supplied through `BIFROST_ENTERPRISE_PANEL_PATH` and its pages are exercised against the matching backend. Enterprise builds set `BIFROST_REQUIRE_ENTERPRISE_PANEL=true`; the OSS fallback and extension contract do not prove private feature behavior.
