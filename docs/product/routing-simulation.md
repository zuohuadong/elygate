# Offline Routing Simulation

The independent panel provides an offline simulation editor alongside the
rule list and decision tree. Persistent drafts, policy versions, publishing,
rollback and online Shadow are not implemented.

`POST /api/control-plane/routing/simulate` requires a verified administrator
identity, denies auth bypass, and uses the existing control-plane JSON media
type and same-origin checks. It is registered when the control plane exists.
Responses use `Cache-Control: no-store`.

## Request

```json
{
  "chain_max_depth": 10,
  "rules": [
    {
      "id": "example-rule",
      "name": "Budget routing",
      "scope": "global",
      "priority": 0,
      "cel_expression": "budget_used > 50.0",
      "targets": [
        {"provider": "openai", "model": "target-model", "weight": 1}
      ]
    }
  ],
  "samples": [
    {
      "name": "sample-1",
      "provider": "openai",
      "model": "input-model",
      "request_type": "chat_completion",
      "usage": [
        {
          "provider": "openai",
          "model": "input-model",
          "status": {"budget_percent_used": 80}
        }
      ]
    }
  ]
}
```

Supply the complete candidate ruleset using routing-rule creation fields plus
an optional unique `id`. An empty array is valid; omitted or null rules are not.
IDs are generated when absent. Priorities must be unique within each scope.
Disabled rules remain disabled. No stored rules are implicitly added.

Samples accept `scope` identifiers and names (`virtual_key_id`,
`virtual_key_name`, `user_id`, `team_id`, `team_name`, `customer_id`,
`customer_name`), string maps `headers`, `params`, `metadata`, and an optional
`complexity_tier`: `SIMPLE`, `MEDIUM`, or `COMPLEX`.
An absent complexity tier keeps upstream unknown-value semantics, not an
automatic classification or a guessed tier.

Usage snapshots are keyed by provider/model and use the upstream
`BudgetAndRateLimitStatus` JSON fields. `status: null` explicitly means no
configured limits. Every pair consulted during chain evaluation needs a
snapshot; missing entries fail that sample rather than assuming zero usage.
No rules to evaluate means no usage lookup is needed.

## Results

The response contains `mode: "offline"`, `selection: "weighted_sample"` and
`results`. Each sample has a `name`, `matched`, nullable `decision`, optional
`error`, and upstream routing-engine `logs`.

Decisions preserve provider/model, key ID, fallback key pins, TTFT timeout and
matched rule identity. Weighted targets use the upstream random selection,
not a deterministic seed or a traffic-distribution forecast.

A normal no-match has `matched: false` and no error. CEL runtime errors,
cost-limit exhaustion, missing usage and chain-depth truncation return a
sample error with no successful decision. Invalid request shape, rule
validation or CEL compilation returns HTTP 400; oversized bodies return 413.
One failed sample does not prevent the other samples from being evaluated.

The evaluator uses the upstream scope precedence, priorities, chains and CEL
implementation. It does not read real credentials or live usage, invoke a
provider, classify prompts, or save rules. A decision is not proof of provider
availability, key authorization, fallback execution or end-to-end TTFT.
Do not put credentials in sample headers or metadata.

## Panel Workflow

The simulation view imports the complete canonical `/api/routing/rules`
snapshot, not a page from the rule list. Imports exceeding 32 rules or failing
the total-count check leave the existing draft unchanged. Read-only database
fields are removed; scope, disabled state, chain configuration, pinned keys,
fallbacks and TTFT settings are preserved.

Candidate rules and samples remain editable JSON. The initial sample has no
chosen model, identity or assumed usage. Drafts live only in the mounted
page, survive list/tree view switches, and are not saved as policies.
Editing invalidates results; cancelling, leaving the simulation view or
unmounting discards late responses.

Results distinguish matches, no-match and sample failures, with full decisions
and engine traces. Export downloads the submitted input and validated result
as JSON. Response validation rejects mismatched samples, malformed fallback
entries and TTFT values outside the integer range `0..300000`; `0` disables
the deadline. Key-pinned fallbacks may retain an empty or whitespace-only
`provider_key_name`, matching the backend contract; non-empty config aliases
are rejected. Supplied input and exported data can contain sensitive metadata.

### Local Verification

On 2026-10-29 the panel suite passed 294 tests and 1522 assertions, Svelte
checking reported no errors or warnings, and the production build passed.
The routing-simulation handler/server regressions also passed.

The Playwright API-fixture run covered 10 workflow checks, including
malformed decisions, cancellation, stale responses, export, keyboard error
focus and complete imports. Layout checks passed at 1440px, 375px and
812x375 in both themes with reduced motion. The error text and alert contrast
measured 6.66:1 in light mode and 7.22:1 in dark mode after a local text-token
fix; the original light-mode value was 3.73:1.

Evidence: `.codex-tmp/routing-simulation-browser-final.log` and
`output/playwright/routing-simulation-*`. These browser checks use API
fixtures, not a live administrator backend, database, provider or deployment.
They do not close the live backend-to-panel acceptance gap.

## Bounds And Cost

- Body: 128 KiB; rules: 0..32; samples: 1..16.
- Targets: 1..16 per rule; fallbacks: at most 16 per rule.
- CEL: at most 4096 bytes per rule; simulation-only evaluation cost limit: 10000.
- Chain depth: 1..20; usage snapshots: at most 32 per sample.

State is request-scoped: at most 32 compiled rules plus supplied samples and
bounded decision traces. No global simulation cache or inference hook is
installed. The live store retains its existing evaluation options and the
inference hot path is unchanged. The only shared change is program options
at CEL compilation time. `BenchmarkRoutingSimulation` measures this
administrator-only request, not model/inference overhead.
