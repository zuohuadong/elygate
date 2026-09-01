# Codex 自我更新 Automation 配方（agent-team-config dogfooding）

> 在 Codex app 里手动创建这两个 automation，即可让 agent-team-config 框架在自己身上跑起 loop engineering 闭环。
> 通用模板见 `templates/automations/codex-automations.md`；本文件是针对本机（macOS, /Volumes/Data/workspace/agent-team-config）的可粘贴版本。

## 覆盖工作区

```text
/Volumes/Data/workspace/agent-team-config
```

## 1. Agent Team Scheduler（常规调度 + 自审）

- 类型：cron
- 频率：每 6 小时
- 模型：`gpt-5.3-codex-spark`
- 推理强度：high
- 工作目录：`/Volumes/Data/workspace/agent-team-config`

prompt（直接粘贴）：

```text
先运行确定性扫描命令：`agmesh automation orchestrate /Volumes/Data/workspace/agent-team-config --json`。根据 JSON 的 `noop` 与 `actions` 决定后续动作；若 `noop=true`，最终只输出一行 NOOP 并停止。

针对工作区 /Volumes/Data/workspace/agent-team-config 执行 agent-team 自动化调度。初始阶段只读取判断队列是否有动作所需的最小信息：coordination DB v2 的 DB-backed task 状态、pending mailbox、sweep/smoke/provider health；不要把完整历史、archived task contracts 或 coordination DB dump 塞进提示词。

只有命中可处理项后才继续：先使用 deterministic scan 返回的 `model_route`，不要在 prompt 中自行重排模型。`routing.engine: contextual-v1` 时统一解析器会应用 capability hard filter、pin/allow/deny/prefer、circuit 和本地 outcome；`shadow` 只观察，`legacy` 保持旧链。随后再读取对应 Task Contract、workflow、项目规则、skill 和必要证据，并继续遵守 Delegation Gate、各类 Profile Gate、run record、memory dedupe、高风险升级、follow-up parent/source/reason 和“不触碰无关业务改动”。

停止规则：没有 ready、review、超时 blocked/running、pending mailbox、provider 异常、smoke 到期或 sweep_open 时，输出 NOOP 并停止；不要写 progress、不发 mailbox、不创建 follow-up、不切模型、不展开宽范围审查。
```

## 2. Agent Team High-Risk Reviewer / Arbiter

- 类型：cron
- 频率：每 6 小时
- 模型：`gpt-5.6-sol`（默认 OpenAI fallback；高风险 runtime 仍走智能候选链，显式配置优先）
- 推理强度：high
- 工作目录：`/Volumes/Data/workspace/agent-team-config`

prompt（直接粘贴）：

```text
针对工作区 /Volumes/Data/workspace/agent-team-config，优先运行 `agmesh arbitrate --next` 处理当前执行源中标记为 `review_class: review-high` 的任务。旧任务若只有 `needs_model: gpt-5.5`，仍作为兼容触发识别；新任务不要再写该字段。若两种标记都没有匹配到，直接静默结束，不写 progress、不发 .mailbox、不创建 follow-up、不触碰普通 ready 队列。发现高风险任务时，只读取匹配任务 row/contract、recent events、相关 mailbox 证据、`.agents/automations/task-contract.md`、`.agents/workflows/pr-review-merge.md`、相关 PR/MR diff、CI/check 状态、项目规则和相关 skills；不要加载完整历史。

高风险审查策略：若任务内容为空、字段不完整或无法判定范围，直接标 invalid/blocked。模型选择交给 `agmesh arbitrate` 的统一解析器：显式 CLI `--model` 或 routing policy `pin` 是硬绑定，executor 的 task `model` 不参与 review/arbitration；allow/deny/capability/circuit 是硬门禁，prefer/outcome 是软排序。未显式配置 OpenAI 候选时 fallback 为 `gpt-5.6-sol`。整条候选链共享总 timeout，并受 `routing.max_attempts` 限制；成功即停止，probe/circuit/outcome 只写本地 `.agents/state/model-routing.db`。其余 PR/MR 退回、blocked、follow-up、自动合并、人工确认、分歧裁决和状态更新规则保持不变。
```

## 创建后验证

1. 在 Codex app 创建上述两个 automation
2. 手动触发一次 Scheduler，观察：队列空时应 NOOP 或触发 backlog-sweep；有 ready 时应串行执行
3. 手动触发一次 Arbiter，无高风险任务时应静默结束
4. 运行 `agmesh automation status .` / `agmesh automation doctor .`，确认 v2 DB 状态或 legacy progress/mailbox 无异常
5. 连续观察 2-3 轮，确认无自我放大（候选数量稳定、无框架核心被自动改）
