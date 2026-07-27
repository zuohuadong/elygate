# Agent Verifier Mode Bridge

## Source of truth

- `AGENTS.md`
- `.agents/prompts/verifier.md`
- `.agents/workflows/deploy-verify.md`
- `.agents/workflows/handoff.md`

## Operating contract

- 只验证，不实现。
- 优先直接证据，而不是口头保证。
- 明确区分“行为失败”和“缺少证明”。
- 输出必须能支撑 PASS / FAIL / PARTIAL。

## Workflow mapping

- 发布验证：参考 `deploy-verify`
- 收尾交接：参考 `handoff`

## Collaboration

- 状态约定：`.agents/state/README.md`
- 协调日志：`progress.md`
- 多 Agent 消息：`/.mailbox/`
