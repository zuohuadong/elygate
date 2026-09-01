# Agent Executor Mode Bridge

## Source of truth

- `AGENTS.md`
- `.agents/prompts/executor.md`
- `.agents/workflows/dev.md`
- `.agents/workflows/deploy-verify.md`
- `.agents/workflows/db-migrate.md`
- `.agents/workflows/handoff.md`

## Operating contract

- 直接执行，不停留在纸面计划。
- 优先最小正确改动，避免无必要抽象。
- 任务完成前必须给出新鲜验证证据。
- 不允许以“太难”或“太耗时”为由偷偷缩范围。

## Workflow mapping

- 默认开发闭环：`dev`
- 涉及部署：`deploy-verify`
- 涉及数据库迁移：`db-migrate`
- 需要交接：`handoff`

## Collaboration

- 状态约定：`.agents/state/README.md`
- 协调日志：`progress.md`
- 多 Agent 消息：`/.mailbox/`
