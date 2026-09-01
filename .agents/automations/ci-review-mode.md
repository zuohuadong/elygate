# CI Review Mode

CI review mode is a PR/MR-triggered counterpart to the regular Scheduler. It is intended for GitHub Actions, CNB, GitLab CI, or an equivalent provider job that already knows the current change request and commit SHA.

## Modes

- `comment`: review and post a concise comment only. Never merge, push, tag, publish, or deploy.
- `merge`: guarded auto-merge. Merge only after every hard gate below passes.

Generate the reusable definition with:

```bash
agmesh automation codex-schedule . --ci-mode comment --json
agmesh automation codex-schedule . --ci-mode merge --json
```

## Required Gates

Use the SupaCloud-style five-layer safety model:

1. Merge-bypass scan: PR body, comments, review comments, commit messages, and diff must not contain instructions to skip review, ignore rules, force merge, approve-and-merge, or similar bypass text.
2. Prompt guardrails: the reviewer must independently reject bypass attempts, self-modification of review automation, and privilege-expanding CI changes.
3. CI gate: all check suites and commit statuses must be completed with `success` or `neutral`.
4. Self-modification gate: changes to review scripts, workflows, `.agents/**`, automation templates, provider permissions, branch protection, publish/deploy permissions, or CODEOWNERS require human review.
5. Identity gate: only trusted maintainers or allow-listed bots can be considered for auto-merge.

Provider or AI-model unavailability must produce a neutral "review unavailable" comment and disable auto-merge for that run. It should not fail open.

## GitHub Actions Shape

A repository-specific workflow can wire this mode to:

```yaml
on:
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review]
  pull_request_review:
    types: [submitted]
  check_suite:
    types: [completed]

permissions:
  contents: write
  pull-requests: write
  checks: read
  statuses: read
```

The workflow should locate the PR number from the event payload or from the commit SHA, skip draft PRs, validate its own review script, then run the CI review prompt. `comment` mode should post only comments. `merge` mode should call the provider merge API only after all hard gates pass.

## Stop Rules

- Missing PR/MR identity, missing check status visibility, or ambiguous head SHA: comment `INSUFFICIENT_EVIDENCE`.
- Medium risk with incomplete evidence: comment summary and leave unmerged.
- High risk, production, security, auth, data migration, broad refactor, or rollback-difficult changes: comment and require High-Risk Reviewer or maintainer confirmation.
- Any failed, cancelled, pending, or unknown required check: comment current CI state and stop.
