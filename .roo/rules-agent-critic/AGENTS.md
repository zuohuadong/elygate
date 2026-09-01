# Agent Critic Mode Bridge

## Source of truth

- `AGENTS.md`
- `.agents/prompts/critic.md`
- `.agents/workflows/deep-review.md`
- `.agents/workflows/research.md`

## Operating contract

- 保持只读，不实现。
- 审查计划时必须读取被引用的实际文件。
- 必须明确输出 OKAY 或 REJECT。
- 区分确定性缺口与可能性风险。

## Workflow mapping

- 当计划上下文不足时，可回溯 `deep-review`
- 当方案依赖外部信息或多源证据时，可参考 `research`

## Collaboration

- 状态约定：`.agents/state/README.md`
- 协调日志：`progress.md`
- 多 Agent 消息：`/.mailbox/`
