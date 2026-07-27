---
description: Review Loop — loop strategy selection and bounded multi-panel convergence
---
// turbo-all

# Review Loop Workflow

Use this workflow only after a Task Contract exists. Its purpose is to decide
whether a task should use fanout, Goal/TDD, a bounded micro-loop, a macro-loop
with real-world data, or a human-owned loop.

## 0. Strategy Gate

Run the selector first:

```bash
agmesh automation loop-strategy . --task <task_id> --domain auto
```

Decision rules:

| Next step is decided by | Use | Boundary |
|---|---|---|
| Fixed independent checklist | `fanout` / workflow | No iterative judge loop is needed. |
| Machine-verifiable acceptance | `goal` or `micro-loop` | Tests, QC gates, release checks, and verifier findings can drive the loop. |
| Real-world demand or growth data | `macro-loop` | Require real interaction, lead, payment, retention, or conversion data. |
| Taste, positioning, irreversible tradeoff | `human-loop` | Agents may prepare options; the human decides direction. |

`agmesh automation review-loop` is allowed only for `goal` and
`micro-loop` outcomes. It must not be used to fake demand validation,
marketing conversion, business viability, or irreversible product direction.

The same orchestration resolver is authoritative for direct plans, loop
triggers, and orchestrator hints:

- `native` low/medium work rejects a redundant automatic review-loop; use deterministic evidence and, for medium risk, at most one risk-triggered verifier.
- `managed` may use goal/micro-loop review inside its budget (default two external panels, one round, 30 minutes).
- `panel` is allowed for explicit panel mode or adaptive high-risk/review-high/reviewer-disagreement work (at most three read-only panels, two rounds, 45 minutes); ordinary review status alone stays risk-graded.
- `human-loop` never auto-starts execution or review lanes.
- Explicit legacy `collaboration.mode` remains compatible through managed mode.

## 1. Trigger Gate

Normalize trigger intent before creating a loop plan:

```bash
agmesh automation loop-trigger . \
  --task <task_id> \
  --source doctor \
  --event-key doctor-warning
```

Trigger sources:

| Source | Type | Default behavior |
|---|---|---|
| `manual` | active | Records explicit operator intent; may use `--execute` for `goal` / `micro-loop`. |
| `schedule` | active | Records scheduled orchestrator intent; may use `--execute` for `goal` / `micro-loop`. |
| `doctor` | passive | Records diagnostics signal only; never auto-executes review-loop. |
| `mailbox` | passive | Records coordination signal only; never auto-executes review-loop. |
| `ci` | passive | Records CI signal only; never auto-executes review-loop. |
| `metrics` | passive | Records real-world/metric signal only; never auto-executes review-loop. |

Passive triggers write to coordination DB in v2 projects, or to
`.agents/state/loop-triggers/<task>-<event>.json` in legacy projects. They must
be confirmed by a human or active scheduler before agent work starts. If a
passive trigger is passed `--execute`, the command fails closed.

## 2. Bounded Review Loop

Generate a plan:

```bash
agmesh automation review-loop . \
  --task <task_id> \
  --domain delivery \
  --panels standards,tests,runtime \
  --max-rounds 2 \
  --threshold 9
```

The command writes to coordination DB in v2 projects, or to
`.agents/state/review-loops/<task_id>.json` in legacy projects. It does not
launch agents by itself. The plan lists panel commands that can be dispatched
through the normal `agmesh subagent dispatch` runtime.

Run and inspect trace evidence:

```bash
agmesh automation review-loop-run . --task <task_id> --json
agmesh automation loop-health . --json
```

`review-loop-run --json` includes `trace_eval` with pass/fail counts, an
advisory score, grader dimensions, and the next action. `loop-health` summarizes
runtime timeout/error mailbox state, review-loop/Goal Forge run evidence,
context snapshot pressure, and the gated loop entry points:

`review-loop` plans also persist the resolved orchestration mode,
`delegation_budget`, `wall_clock_budget_minutes`, `stop_rules`, and additive
`adaptive_depth` metadata. It records
the bounded min/max rounds, early-exit signals, deepen signals, escalation
signals, and the contraction metric used by `trace_eval`. `review-loop-run`
keeps existing output fields and adds diff/evidence hashes, finding hash counts,
`executed_rounds`, `early_exit_reason`, `stop_reason`, `contraction_delta`, and
`adaptive_depth` under `trace_eval`. Raw diffs are never persisted. The runner
obeys each plan's `require_new_evidence`, `stop_on_unchanged_diff`,
`dedupe_findings`, and `stop_on_zero_contraction` booleans. Because the runner
has no write/fix phase, a failed round with an unchanged diff stops immediately
instead of replaying reviewer opinions. These fields only
explain whether the loop stabilized, needs another bounded round, or should
escalate to stronger review / human judgement; they do not override `max_rounds`,
the 5-round cap, production approvals, product-signal boundaries, or release
gates.

- `agmesh automation tcb . --json` for Thread Control Blocks instead of full sidecar context.
- `agmesh approval request|approve|reject` for production, secret, destructive git, migration, publish, or irreversible choices.
- `agmesh automation product-signal` for real-world macro-product evidence; `agent_score` is proxy-only.
- `agmesh automation skill-evolution --write` for human-reviewed skill/playbook Matter drafts.

These commands record evidence or pause/resume eligibility. They must not
auto-create product, marketing, skill rewrite, production, or approval
execution loops.

Hard limits:

- native: external=0 by default, one round, 20-minute wall clock; medium risk may use one verifier outside a redundant review-loop
- managed: at most 2 external panels, 1 round, 30-minute wall clock
- panel: at most 3 read-only panels, 2 rounds, 45-minute wall clock
- configured wall-clock budgets are capped at 60 minutes
- every panel must use the standard structured schema
- every round feeds unresolved `blocking_findings` / `missing` into the next
  round
- stop when required panels pass, verification commands pass, or the next
  decision belongs to a human or real-world data source

## 3. Panels

Recommended panels:

| Panel | Role | Focus |
|---|---|---|
| `contract` | critic | Goal, non-goals, scope, acceptance criteria, rollback. |
| `standards` | critic | Project coding standards, required skills, conventions, and code smells that are not fully enforced by tooling. |
| `spec` | critic | Task Contract/spec fidelity, missing or partial requirements, scope creep, and behavior that solves the wrong problem. |
| `tests` | verifier | Test/typecheck/build evidence tied to acceptance criteria. |
| `runtime` | verifier | Runtime behavior, timeout, deployment, smoke evidence. |
| `docs` | critic | README, workflows, templates, and user-facing wording. |
| `security` | critic | Secrets, permissions, auth, data exposure, irreversible operations. |
| `release` | verifier | Release gate, packaging, clean diff, rollback evidence. |

`standards` and `spec` are independent review axes. Keep each panel's
`verdict`, `missing`, `blocking_findings`, and `evidence` separate: compliance
with code standards cannot prove spec fidelity, and spec fidelity cannot mask a
standards violation. Do not merge, re-rank, or discard one panel because the
other passes. When both panels are requested, both are required; do not drop a
failed panel after dispatch merely to make the aggregate verdict pass.

Each panel output must include:

- `verdict`
- `score` as advisory proxy only
- `missing`
- `blocking_findings`
- `evidence`
- `next_action`

## 4. Signal Boundary

Agent score is only a proxy. It is not CTR, CVR, payment, retention, production
truth, or user demand. For demand discovery, marketing, and business direction,
use agent panels only to organize angles; the next round must be driven by real
signals or a human decision.

## 5. Completion

Before claiming done:

- cite the loop-trigger path when a signal triggered the loop
- cite the review-loop plan path when used
- cite each mailbox result that was actually run (DB mailbox in v2 projects, file path in legacy projects)
- run the Task Contract verification commands
- update coordination DB with the final PASS/FAIL/PARTIAL verdict; legacy projects update `progress.md`
- do not claim multi-agent review if only a plan was generated
