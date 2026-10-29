# Panel parity matrix

This matrix maps the legacy React console routes to the lightweight Svelte
panel. It distinguishes functional parity from private enterprise
implementation so an OSS build never claims APIs that are not present.

`panel/` is an Elygate-owned management surface, not a downstream copy of
Bifrost `ui/`. This matrix records the backend API contract consumed by the
independent panel; it does not create a source-level parity obligation with the
upstream UI.

## Backend API contract policy

- Bifrost upstream behavior and contracts are the compatibility baseline for
  same-origin `/api/*` routes, authentication and authorization, request and
  response fields, pagination, error semantics, and public callback flows.
- This is a new system, with no compatibility layers for legacy Elygate APIs,
  schemas, or panel behavior. When an upstream contract changes, update the
  panel, this matrix, and regression coverage for both sides together instead
  of adding legacy compatibility branches or migration layers.
- Add or update the route entry in this matrix whenever the panel starts using
  a new backend API or changes an existing workflow contract.
- Contract-specific Elygate behavior should live in a narrow adapter, plugin,
  or sidecar when practical. Generic Bifrost improvements should be proposed
  upstream instead of accumulating permanent patches in `core/`, `framework/`,
  or HTTP handlers.
- The Vite `/api` proxy preserves the browser Host and Origin. It must not
  rewrite Host to the backend target or rewrite an untrusted Origin; guarded
  administrator writes use the actual Host as the origin trust anchor.

## Status legend

- **Dedicated**: purpose-built Svelte workflow with the legacy page's primary interactions.
- **Alias**: the legacy route was a redirect or duplicate surface; the panel points to the canonical workflow.
- **Enterprise extension**: capability-gated menu plus a build-time page override; direct URLs retain an explicit fallback.
- **Public flow**: direct-navigation page outside the svadmin hash router.

## Upstream 248db77d0 integration boundary

- The backend includes upstream relay configuration, relay grants, relay logs,
  MCP protocol-version limits, resources, prompts and expose-list contracts.
  The independent panel is not replaced by the upstream React console.
- Relay endpoint management, relay logs and virtual-key `relay_grants` now have
  dedicated panel workflows. The panel preserves the upstream full-replacement
  relay PUT contract, redacted credentials and inherited proxy semantics;
  relay-log queries use absolute time bounds; grant updates omit unchanged
  values and send `[]` only for an explicit deny-all change.
- Per-client MCP protocol limits and resource/prompt exposure now have dedicated
  create/edit controls, with read-only resource/template/prompt discovery.
  Exposure lists preserve exact JSON strings; unchanged policy fields are
  omitted from updates, and an empty protocol explicitly restores the global
  setting. Upstream contracts are the only compatibility baseline.
- The MCP follow-up passed 22 helper/contract tests, all 303 panel tests, Svelte
  diagnostics, an isolated Vite production build and
  route-fixture browser checks for hydration, validation, mutation payloads and
  desktop/mobile/landscape light/dark layout. This is local scoped evidence,
  not proof of a live external MCP connection or production acceptance.
- Relay workflows are locally `PASS_SCOPED`: focused helper contracts,
  OpenAPI parsing/import contracts, Svelte diagnostics, isolated Vite build and
  fixture browser checks cover editor hydration/preview, failed-save draft
  retention, relay logs and grant clearing across desktop/mobile/landscape
  light/dark states. The 2026-10-30 OpenAPI browser follow-up also covered
  JSON/YAML paste, JSON/YAML files, guarded URL fetching, malformed/failed
  responses, explicit confirmation and auth/base-URL opt-in, existing-setting
  retention, stale file/parser/URL results, draft-change protection, Escape
  close, opener focus restoration, bidirectional Tab containment and
  1440x1000, 375x812 and 812x375 reduced-motion screenshots. The browser
  fixtures produced 88 passing assertions, zero business writes and zero page
  errors; the separate race suite adds 13 passing assertions for close/reopen,
  out-of-order files, cancellation and draft mutation. Evidence scripts are
  `.codex-tmp/relay-openapi-browser-20261030.mjs` and
  `.codex-tmp/relay-openapi-races-20261030.mjs`, with the captured result in
  `.codex-tmp/relay-openapi-browser-verified-20261030.log` and screenshots
  under `output/playwright/`. This remains local scoped evidence, not proof of
  live upstream traffic, external credentials, production relay acceptance or
  complete governance audit snapshots.
- Remaining panel gaps include structured route/usage editors, full log
  attribution/cost filters and log export. JSON editors expose the existing
  configuration contract without claiming complete upstream UI parity.

## OSS and shared management routes

| Legacy route(s) | Panel surface | API contract | Status |
| --- | --- | --- | --- |
| `/login` | svadmin login + Bifrost auth provider | `/api/session/is-auth-enabled`, `/api/session/login`, `/api/session/logout` | Dedicated |
| `/workspace/dashboard` | dashboard | `/api/logs/dashboard` | Dedicated |
| `/workspace/logs` | logs | `/api/logs*`, `/api/ws`, cost recalculation and selected deletion | Dedicated |
| `/workspace/relay-logs` | relay-logs | `/api/relay-logs*`, absolute time bounds, list/stats/histogram/top-endpoints, details and selected deletion | Dedicated, remaining filters/export noted above |
| `/workspace/relays` | relay-endpoints | `/api/relays*`, `/api/relays/openapi-spec`, full replacement CRUD, all auth schemes, JSON configuration and unsaved usage preview | Dedicated, OpenAPI import added; structured editors pending |
| `/workspace/logs/connectors`, `/workspace/observability` | connectors | `/api/plugins`, `/api/plugins/{name}` | Dedicated |
| `/workspace/mcp-logs`, legacy `/workspace/logs/mcp-logs` | mcp-logs | `/api/mcp-logs*` | Dedicated |
| `/workspace/providers` | providers | `/api/providers*`, provider/key refresh routes | Dedicated |
| provider API-key fragment under `/workspace/providers` | provider-keys | `/api/providers/{provider}/keys*`; SageMaker, cloud/OAuth configs, custom-base credential rules and endpoint flags | Dedicated + Alias |
| provider governance fragment under `/workspace/providers` | provider-governance | `/api/providers`, `/api/governance/providers*` budgets, rate limits and calendar alignment | Dedicated |
| `/workspace/model-catalog` | model-catalog | `/api/providers`, `/api/models`, `/api/models/details`, `/api/models/catalog`, log stats/histograms | Dedicated |
| `/workspace/model-limits`, `/workspace/providers/model-limits` | model-configs, budgets, rate-limits | `/api/governance/model-configs*` | Dedicated + Alias |
| `/workspace/routing-rules`, `/workspace/routing-rules/tree`, `/workspace/providers/routing-rules` | routing-rules list/tree + offline simulation | `/api/routing/rules*` for CRUD and complete snapshot import; `/api/control-plane/routing/simulate` for administrator-only offline evaluation | Dedicated + Alias |
| `/workspace/complexity-router` | complexity-router / complexity-analyzer | `/api/governance/complexity-analyzer-config`, ordered tier spectrum, normalized keyword groups, reset and hot reload | Dedicated + Alias |
| `/workspace/custom-pricing`, `/workspace/custom-pricing/overrides` | pricing-config, model-catalog, pricing-overrides | `/api/config`, `/api/pricing/force-sync`, `/api/governance/pricing-overrides*` scopes, model patterns, request types, full numeric patch | Dedicated |
| `/workspace/governance/virtual-keys`, `/workspace/virtual-keys` | virtual-keys | `/api/governance/virtual-keys*`, relay grants with unchanged omission and explicit deny-all `[]` | Dedicated + Alias |
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
| `/workspace/webhooks` | webhooks | `/api/webhooks*` test, secret rotation, delivery inspect/redeliver; explicit budget subscription and resource history | Dedicated |
| `/workspace/docs` | docs-hub | bundled docs + official documentation links | Dedicated |
| Elygate control plane | control-plane-projects, control-plane-applications | `/api/control-plane/projects*`, `/api/control-plane/applications*` project/application management and key lifecycle | Dedicated |
| Elygate usage ledger | usage-ledger | `/api/control-plane/usage*`, `/api/control-plane/audit-events*`, `/api/control-plane/budget-alerts` paginated ledger, full filtered summary, sync status, budget status/history and CSV export; audit rows show optional request/trace correlation | Dedicated |
| Elygate notifications | shared header notification panel | `/api/notifications?limit=50&cursor=...` server-authorized feed; `/api/control-plane/notification-receipts*` local-admin read state; internal action links | Dedicated |
| `/pprof` | pprof | `/api/dev/pprof*` | Dedicated |

### Provider key contract

- Editing and revalidation preserve the upstream provider-specific key sections,
  including SageMaker, Databricks, Cloudflare, OAuth and endpoint selection flags.
  Secrets retain their redacted reference metadata; the panel does not resolve them.
- Creation permits an omitted static value for the providers allowed by Bifrost,
  resolving custom providers against `custom_provider_config.base_provider_type`,
  or when `oauth_key_config` is an object. Required regions, URLs and complete
  credentials remain server-validated; an empty config is not proof of valid auth.
- A blank password input preserves the existing value unless advanced JSON supplies
  an explicit `value`. An explicit empty value can switch a stored bearer token
  to cloud/OAuth credentials; a newly typed password takes precedence over JSON.

### Notification feed contract

- The shared header reads `GET /api/notifications` with same-origin session
  credentials and a page size of 50. Audience filtering belongs to the server;
  the panel does not invent an administrator identity or broaden visibility.
- Opaque cursors are encoded without modification. Older pages append in server
  order with IDs deduplicated. An empty page may still have `next_cursor`.
  Explicit refresh replaces the loaded pages and cursor with the latest page.
- A visible tab polls every 60 seconds without overlapping requests. Polling
  pauses while the open panel is displaying older pages. Failed or malformed
  responses remain visible as errors and retain previously loaded records.
- Action links accept internal absolute and hash paths, reject protocol-relative
  URLs, backslashes and control characters, and map upstream `/workspace/...`
  actions to the panel hash router. The popover uses the browser top layer so
  layout containers cannot clip it.
- Each loaded page separately requests ordered read states from
  `GET /api/control-plane/notification-receipts?notification_id=...` (1..50
  distinct canonical UUIDs). The shared upstream notification schema is unchanged.
- Explicit read/unread toggles use `PUT /api/control-plane/notification-receipts/{id}`
  with only `{ "read": boolean }`. The server owns identity; current support is
  one local-admin account shared across its sessions, not enterprise multi-user receipts.
  Opening or closing the popover does not mark records read.
- The badge counts loaded unread records, never total unread across the feed.
  Unknown rows show `?` instead of a fabricated number. Receipt read/save failures
  make affected states unknown and block toggles until a successful refresh;
  a lost response may follow a committed write. Loading and saving are mutually
  exclusive; refresh, paging and polling cannot overwrite a pending mutation.
- Reading is not budget acknowledgement or resolution. Explicit local-admin
  budget acknowledgement is separate (see below); resolution remains open.
  External budget alerts have an explicit `budget.threshold_reached` subscription
  in the Webhook editor, filters and test event selector. Existing endpoint edits
  retain their event set, and new endpoints do not opt into budget data by default.
  Queue/history use a budget `resource_id`, not a fabricated inference identity.
- Local authenticated production-server acceptance on 2026-10-27 used official
  log-store writes of synthetic usage, isolated SQLite stores and the current
  production panel build, without mocked APIs or a shortened monitor interval.
  Both project/application 80% and 100% alerts reached the feed, WebSocket and
  browser; polling, refresh and budget navigation passed. IDs remained unchanged
  after restart and another full monitor interval. Stopped-store reconciliation
  found four alerts, four delivered outbox rows and four notifications, without
  retries or duplicates. This does not prove real provider traffic, PostgreSQL
  browser integration or production delivery.
- The mobile shell stops animating the desktop sidebar offset below 768px.
  First-frame content geometry, header control bounds and navigation were
  checked at 375/390/767px; desktop sidebar collapse/expand still works.
  Browser fixtures additionally cover dark mode and landscape.

### Usage ledger contract

- The list, summary, and CSV accept the same project/application,
  `user_id`/`provider`/`model`, session tree, agent, subagent/fork and RFC3339
  time filters. User/provider/model are exact, case-sensitive identities:
  whitespace and special characters are preserved, not trimmed or expanded as
  wildcards. Empty values leave that dimension unfiltered, including null users.
  Time windows are `[start, end)`;
  the panel converts local date/time input to UTC. All routes require an
  authenticated administrator; bypassed authentication is rejected.
- `GET /api/control-plane/usage/summary` returns `requests`,
  `successful_requests` (`success`), `failed_requests` (`error`),
  `cancelled_requests` (`cancelled`), `prompt_tokens`, `output_tokens`,
  `total_tokens`, and `cost`. It aggregates every matching row, ignoring
  `limit`/`offset`; an empty result returns zeroes. Synchronization or database
  failures return an error, not zero totals.
- Summary and list requests use the same filter snapshot and reject stale
  responses, including edits to user/provider/model during a request. Apply
  (including Enter), pagination, refresh and export retain those dimensions;
  reset clears them and the page offset. The ledger includes a user ID column.
  Summary failures remain visible while successful list results are retained;
  missing sync/audit data is not shown as successful empty data.
- CSV includes `user_id`, starts at offset zero regardless of list pagination,
  and retains the existing 100,000-row ceiling, not an unlimited-export promise.
  Formula-leading text cells receive an apostrophe, also after whitespace/BOM;
  numeric costs (including negative corrections) remain numeric.

### Budget panel contract

- Project/application creation supports optional daily/monthly USD budgets.
  `PUT /api/control-plane/projects/{id}/budgets` and
  `PUT /api/control-plane/applications/{id}/budgets` replace both windows;
  empty fields are sent as explicit nulls. Invalid amounts never become null
  through JSON serialization. Failures retain the entered values.
- `GET /api/control-plane/usage/budgets` returns current UTC day/month bounds,
  usage, limits and healthy/warning/exceeded state. Only project/application
  filters apply; ledger user/provider/model/date/session/agent filters must not
  reduce budgets.
- Status badges retain explicit text and use theme foreground on semantic
  success/warning/destructive tinted surfaces, not fixed dark text colors.
  The 2026-10-29 follow-up measured every state at >=11.79:1 in both themes
  across desktop, 375px and landscape; evidence is in
  `.codex-tmp/budget-status-theme-browser-verified.log`.
- `GET /api/control-plane/budget-alerts` lists stored 80%/100% events with
  limit/offset paging and `resolution=all|open|resolved` (default all), applied
  before paging and intersected with project/application scope. Invalid,
  duplicate or empty known query parameters fail. Status and history failures are independent; failures
  are not presented as an empty success or a healthy budget.
- Every alert includes required `acknowledged`, `acknowledged_at` and
  `acknowledged_by`; false requires explicit null time/actor, true requires
  a valid time and actor. There is no fallback for older Elygate payloads.
  `PUT /api/control-plane/budget-alerts/{id}/acknowledgement` takes only a
  required `acknowledged` boolean and returns the complete alert view.
- Every alert also requires `resolved`, `resolved_at`, `resolved_by` with the
  same false/null and true/time/actor consistency. Resolution is independent
  of acknowledgement and notification read state, and does not clear a breach.
  `PUT /api/control-plane/budget-alerts/{id}/resolution` takes only a required
  `resolved` boolean; false reopens the alert. Both writes return real joined
  state, serialize on the same alert lock and audit only actual transitions.
- Resolve/reopen controls expose time and actor; resolution filtering resets
  paging. A row leaving the filter refills from page one, preserving a lost
  keyboard focus at the filter without stealing focus moved elsewhere.
- Explicit acknowledge/undo controls never change notification read state,
  budget enforcement or breach severity. Failed/ambiguous saves are unknown,
  block another toggle, and require refresh. Refresh/paging cannot race a
  save. Both mutation types share a pending barrier; failed saves make both
  state controls unknown until refreshed. Pending writes outlive scope changes and component unmounts; subsequent
  reads wait for them before querying, including when the new scope still
  contains the same alert. Keyboard focus remains on the action.
- Local production-runtime/browser acceptance on 2026-10-27 used authenticated
  isolated SQLite stores, official synthetic log writes and monitor-generated
  alerts without API fixtures. Confirm/undo, Basic retry idempotency, a real
  commit with a dropped response, refresh recovery, restart persistence and
  desktop/375px rendering passed. Anonymous writes returned 401 and authenticated
  foreign-Origin writes returned 403. This is not real-provider billing,
  PostgreSQL-to-browser, production migration or backup/recovery acceptance.
- Resolution runtime/browser acceptance on 2026-10-29 additionally passed
  resolve/reopen, independent acknowledgement, filtered empty/refill and lost
  focus recovery, dropped committed responses and exact transition audits.
  State and the real login session survived a full backend restart and another
  monitor interval. Stopped SQLite reconciled four alerts, one resolution,
  zero acknowledgements, five transition audits, zero read receipts and four
  delivered notifications. All 16 checks passed without API response fixtures.
  This run used the panel before the separately verified badge CSS follow-up;
  the PostgreSQL-browser gap was closed by the following scoped replay.
- Dual-PostgreSQL runtime/browser acceptance on 2026-10-29 passed 23 checkpoints
  using the verified retained backend and latest independently built badge CSS.
  Real config/log pools connected to separate private PostgreSQL 18.4 databases
  without SQLite files. The same resolution/session state and exact audits
  survived clean PostgreSQL and backend process restarts and another monitor
  interval. Stopped SQL counts matched the SQLite replay, with one synthetic
  source log in the separate logs database. Both databases were removed and all
  owned processes exited normally. Report:
  `.codex-tmp/budget-resolution-pg-euoFWz/report.json`.
  This does not prove real-provider billing, multi-user behavior, password/TLS,
  external delivery, crash durability, production migration or backup/recovery.
- `GET /api/control-plane/usage/budgets/history` provides independent closed UTC
  day/month analysis. The table has its own range and SQL-backed pagination,
  follows only project/application filters, and shows resource names,
  usage/limit, unclamped utilization and state. Unknown/null-at-close policies
  are omitted; zero-usage configured periods remain visible.
- Historical analysis uses the final pre-close policy and current reconciled
  ledger, not immutable first-alert payloads. It does not add project and
  application amounts together. Loading, invalid ranges, malformed responses,
  source errors and empty pages are distinct; stale/unmounted reads cannot
  overwrite the active scope.

## Enterprise extension routes

The following legacy routes import private enterprise implementations or need
private APIs absent from this checkout. Their menu entries appear only when a
runtime plugin declares the matching manifest resource or
`enterprisePanelManifest.resourcePages` provides the page. Direct callbacks
and handoff pages use `enterprisePanelManifest.publicPages`. The manifest is the
only extension entry point; legacy page-map exports are not supported.

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
