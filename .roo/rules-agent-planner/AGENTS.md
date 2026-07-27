# Agent Planner Mode Bridge

## Source of truth

- `AGENTS.md`
- `.agents/prompts/planner.md`
- `.agents/workflows/deep-review.md`
- `.agents/workflows/research.md`
- `.agents/workflows/handoff.md`

## Operating contract

- 先查仓库，再问用户。
- 只在确实影响方案分支时提问。
- 交付可执行计划，而不是泛泛建议。
- 验收标准必须可测试。

## Workflow mapping

- 模糊需求澄清：`deep-review`
- 多源调研：`research`
- 需要交接：`handoff`

## Collaboration

- 状态约定：`.agents/state/README.md`
- 协调日志：`progress.md`
- 多 Agent 消息：`/.mailbox/`
