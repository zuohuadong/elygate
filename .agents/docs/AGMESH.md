# Agmesh Expanded Rules

This file is deployed by `agmesh deploy` for on-demand reference. Keep `AGENTS.md` thin; load this document only when the task needs expanded automation, delegation, or context-management rules.

## Required Context

- In coordination DB v2 projects, `.agents/state/coordination.db` is the execution and coordination source. Use bounded DB queries through `agmesh context`, `agmesh automation status`, and task-specific evidence references; do not read historical logs wholesale.
- In legacy projects only, `progress.md`, `.mailbox/`, and `tasks.md` remain fallback coordination files. Read only the active task row/contract, newest relevant progress entries, and pending/conflicting mailbox frontmatter.
- `.agents/state/` contains machine-readable state, run records, and archives.
- `.agents/workflows/` and `.agents/prompts/` hold detailed procedures. Load only the workflow or role prompt needed by the current assignment.
- Use `agmesh automation context-pack . --type bug-fix|pr-review|deploy-verify|ui|db-migration` to get a task-type minimal context bundle before broad exploration.
- Use `agmesh context capsule . --source browser|github-issue|pr|docs --title "<title>" --summary "<summary>" --evidence <path> [--matter-task <id> --write]` to convert external context into a sanitized capsule; keep screenshots, transcripts, and large payloads as file-path evidence.

## Task Contract

Before execution, the Task Contract should state:

- goal and non-goals
- acceptance criteria
- collaboration mode (`solo`, `roundtable`, `critic`, `pipeline`, `split`, or `swarm`)
- expected files/modules
- required skills and code conventions
- verification plan
- risk and rollback
- provider/source links when applicable
- parent/source/reason for follow-up tasks

Use a minimal contract for low-risk local work. Require full Stack/Fullstack/Database/Deployment profiles only when the task creates, changes, or materially depends on those choices.

## Delegation Details

- Subagent requests must state role, exact scope, read/write ownership, allowed files/directories, context isolation, handoff artifacts, verification command(s), output schema, and mailbox persistence.
- Default every subagent to isolated context. Share evidence through Task Contract fields, coordination DB, `.mailbox/`, run records, or named artifacts.
- Do not run parallel writers unless file ownership is explicitly disjoint.
- If a subagent is interrupted, timed out, or malformed, record `interruption_recovery` with resume state, last stable artifact, dangling subagents, and recovery action.
- Failed review should return to the original PR/MR when possible. Create a follow-up only when the source cannot continue or the issue was already merged; include parent, source, and reason.

## Automation Rules

- Executors handle one eligible `ready` task at a time, then reread the current execution source and mailbox queue.
- Reviewers handle `review` tasks only.
- Health checks watch stuck tasks, auth/CI visibility, coordination context drift, and mailbox queue drift.
- `agmesh automation archive-ledger .` archives done/archived task rows and contracts.
- `agmesh automation archive-progress . --keep-recent 50` archives old legacy progress entries.
- `agmesh automation prune-mailbox . --max-bytes 131072 --archive-status done,archived,error --keep-recent 5` prunes reviewed mailbox history; pending/alert messages and referenced evidence must be preserved.
- `agmesh automation review-mailbox-errors . --all` must review retained error messages before they can be archived.
- `agmesh status` shows the current project's Matter summary when coordination DB v2 is active; use `agmesh matter list|show` for detailed delivery views.
- `agmesh skill candidate . --json` is advisory only: it currently extracts explicit Task Contract verification commands, event failure patterns, and Taste scope profiles; it does not read mailbox content or generate risk gates or rollback templates, and writing skills or templates still requires human confirmation.
- Taste feedback may be auto-recalled for public-facing subagent work such as docs, CLI copy, UI, and release notes; it affects prompts only and never overrides tests, facts, safety, or the latest user instruction.

## Context Hygiene

- Prefer summaries and stable artifact paths over raw logs. Do not paste base64/data URLs, large screenshots, full trace files, or large JSON blobs into chat, mailbox, progress, or Task Contract fields.
- Use `agmesh memory recall "<query>" --token-budget <n>` for stable decisions, known issues, architecture notes, and rollback constraints.
- Use `agmesh automation workflow-summary . --workflow <file> --max-lines <n>` before loading long workflow files.
- Use `agmesh automation tcb . --json` when only subagent Thread Control Blocks are needed.
- Use `agmesh automation inspect-session-context <session-id|session-file> --json` before forking a long thread or when image/tool payloads cause context pressure; read latest request token_count separately from cumulative token_count.

## Skill Loading

- Default to progressive loading: metadata and indexes first, then full `SKILL.md` and required references only when needed.
- If the user or Task Contract explicitly names a skill, treat it as activated for the current turn while still obeying project safety rules.
- Third-party skill archives are explicit opt-in only. Record name, description, version, author, compatibility, and source when used.

## Safety

- Never run destructive git or filesystem commands unless the user clearly requested them.
- Do not use `git push -f`.
- Do not expose raw chain-of-thought.
- Generated code, comments, and commit messages must not mention AI authorship.
- Commit messages, when requested, must follow Conventional Commits.
