# Claude Code Agent Rules

You are acting within the `agent-team-config` framework. Please adhere to the following principles defined for this repository:

1. **Check Context**: If `.agents/state/coordination.json` exists, use `agmesh context . --task <id>` / `agmesh automation status .` for the active task, recent events, and pending mailbox queue. Legacy projects only: read `progress.md`, `tasks.md`, and `.mailbox/` slices.
2. **Mailbox Coordination**: In v2 projects, check DB-backed pending/conflict mailbox via `agmesh automation status .` or task context. In legacy projects, check `.mailbox/` frontmatter. Wait for user input if conflicting instructions are found.
3. **Roles and Workflows**: Depending on your exact assignment, rely on `.agents/prompts/` and `.agents/workflows/` for specialized instructions (e.g. executing `/dev`, `/deploy-verify`, etc.).
4. **No Secrets**: Never hardcode API keys or secrets in logs or code.
5. **No Scope Reduction**: Do not silently reduce the scope of the task if you find it complex. Stop and ask the user.
6. **Verify First**: Verify changes via tests or building before declaring a task done. Record material claim state in the current execution source: coordination DB for v2, `progress.md` for legacy.
7. **Capability-Adaptive Orchestration**: 行动型请求先解析 `orchestration.mode: adaptive|native|managed|panel`。adaptive 只有显式 Task Contract/项目 override，或 model catalog 与当前 host/runtime 的能力交集，证明六项 native capability 时才进入 native，否则回退 managed。native 是单 owner/writer（低风险 external=0；中风险一次 verifier）；managed 只按需派发必要角色；高风险、review-high 或 reviewer 分歧进入 bounded panel（唯一 writer、最多三个只读 reviewer、默认最多两轮），普通 review 状态本身不升级 panel；产品方向、审美/品味和商业判断进入 human-loop，但高风险/不可逆操作仍优先 panel。显式 legacy `collaboration.mode` 自动 managed 兼容。所有模式共享 tests/build/typecheck/diff、审批、恢复和真实 PASS/FAIL/PARTIAL evidence gate。子代理模型按当前 runtime/profile 配置选择，不要硬填其他宿主专属模型，也不要把切换宿主 runtime 当作 verifier 恢复策略。Design deliverables continue through `/design-review`; Goal Forge runtime discovery remains `GOAL_FORGE_BIN` / PATH, then `npx -y @goalforge/cli@latest`, then source-checkout fallback.

## Task Automation

- coordination DB v2 projects use `.agents/state/coordination.db` as the execution source; legacy projects use Task Ledger (`tasks.md`). Re-read the current execution source and mailbox queue after completing or blocking any task.
- Claim only one task at a time. Update coordination DB for every claim, block, or completion; legacy projects update `progress.md` / Task Ledger.
- Before execution, form a Task Contract with goal, non-goals, acceptance criteria, required skills, and verification plan; low-risk local work may use a minimal contract.
- Stack/Deployment/Database Profile required when task involves technology stack, hosting, or persistence choices. Use recommended fallbacks only for greenfield projects.

## Skills and Conventions

- Load relevant skills from `~/.agent-team-config/references/skills/` or project-level `.agents/` before implementation.
- Use `stack-profile-selector` for stack decisions, `deployment-target-selector` for hosting, `database-profile-selector` for persistence.
- Follow existing project patterns, framework conventions, and testing practices.

## Safety

- Never use `git push -f` or `rm -rf /`.
- Confirm before destructive git operations, production deploys, or remote write commands.
- State management files are in `.agents/state/`.
