# Goal Forge Integration

Selected runtime: npm package (@goalforge/cli@latest)

Source checkout fallback: /Volumes/Data/workspace/goal-forge

This directory is managed by `agmesh deploy`. It connects the project Task Contract / design-review workflow to Goal Forge without vendoring Goal Forge into this project. Runtime discovery prefers an explicit/local binary first, then the latest published npm package, and keeps a sibling source checkout as a development fallback.

Use Goal Forge when the deliverable is a design artifact, architecture/API/data model decision, migration plan, or any high-risk plan that benefits from adversarial review before implementation.

## Commands

Create a local review run:

```bash
npx -y @goalforge/cli@latest init --goal "<design goal>" --config "/Volumes/Data/workspace/elygate/.agents/goal-forge/goal-forge.config.json" --out "/Volumes/Data/workspace/elygate/.agents/goal-forge/runs/<run-id>"
```

Run a deterministic local round:

```bash
npx -y @goalforge/cli@latest run "/Volumes/Data/workspace/elygate/.agents/goal-forge/runs/<run-id>" --rounds 1 --adapter local
npx -y @goalforge/cli@latest validate "/Volumes/Data/workspace/elygate/.agents/goal-forge/runs/<run-id>" --strict
```

Run repository-aware verification through the Codex adapter:

```bash
npx -y @goalforge/cli@latest run "/Volumes/Data/workspace/elygate/.agents/goal-forge/runs/<run-id>" --rounds 1 --adapter codex --repo "/Volumes/Data/workspace/elygate" --model gpt-5.3-codex
```

Shortcuts from this project:

```bash
agmesh goal-forge status .
agmesh goal-forge init . "<design goal>"
```

## Coordination Rules

- In coordination DB v2 projects, keep `.agents/state/coordination.db` as the execution source and use `agmesh context` / `automation status` / `automation doctor` for bounded reads.
- In legacy projects only, `tasks.md`, `progress.md`, and `.mailbox/` remain the fallback coordination files until migration.
- Keep Goal Forge runs under `.agents/goal-forge/runs/` as review evidence for design artifacts.
- Record the final Goal Forge run path in the Task Contract under `goal_forge.run_dir`.
- Use Goal Forge to clarify `delivery_slicing` wayfinding when a design spans multiple sessions: identify end-to-end tracer bullets, their blockers, the current frontier, and unresolved fog.
- Derive `frontier` from Task Contract dependencies and coordination state. Only current-frontier slices may become executable work; Goal Forge must not claim or advance them.
- Treat `fog` as unresolved hypotheses, possible paths, or questions. Fog is not a task, backlog, or dispatch queue; promote it only after the Task Contract defines a deliverable and acceptance criteria.
- For `wide-refactor`, record an `expand-contract` sequence and its rollback points before implementation.
- Goal Forge runs are design evidence and Task Contract references only. Do not create a second ledger or execution source; coordination DB v2 remains canonical, with the legacy Task Ledger as the migration fallback.
- Do not place secrets in Goal Forge config or ledgers.

## Development Fallback

When working on Goal Forge itself, a source checkout at `/Volumes/Data/workspace/goal-forge` can still provide config templates and a fallback runtime when no binary/package runner is available.
