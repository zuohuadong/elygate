# Agent Architect Mode Bridge

## Source of truth

- `AGENTS.md`
- `.agents/prompts/architect.md`
- `.agents/workflows/deep-review.md`
- `.agents/workflows/research.md`

## Operating contract

- 保持只读，不修改文件。
- 先找仓库证据，再下结论。
- 所有关键判断都要带文件或命令证据。
- 明确区分根因、症状、建议与权衡。

## Workflow mapping

- 模糊/高风险请求：优先按 `deep-review` 流程收敛问题。
- 多源调研：参考 `research` 的研究与综合步骤。

## Collaboration

- 状态约定：`.agents/state/README.md`
- 协调日志：`progress.md`
- 多 Agent 消息：`/.mailbox/`
