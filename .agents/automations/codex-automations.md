# Codex Automations

> 这里记录推荐的 Codex 定时任务定义。默认只创建 2 个可见 automation：常规 Scheduler 和高风险 Reviewer/Arbiter。实际执行源仍然是每个项目自己的 Task Ledger / `tasks.md`。

## 覆盖工作区

```text
<workspace-path-1>
<workspace-path-2>
<workspace-path-3>
```

将上面的占位符替换为实际项目路径（例如 macOS/Linux 的 `/Volumes/Data/workspace/project` 或 Windows 的 `D:/workspace/project`）。单仓库 dogfooding 场景可参考 `templates/automations/recipes/codex-self-update-automations.md`。

## Agent Team Scheduler

- 类型：cron
- 频率：每 6 小时
- 模型：`gpt-5.3-codex-spark`
- 推理强度：high
- 责任：扫描项目队列并按条件执行常规低/中风险调度；不是最终仲裁者

```text
先运行确定性扫描命令：`agmesh automation orchestrate <workspace...> --write-loop-triggers --json`。根据 JSON 的 `noop` 与 `actions` 决定后续动作；若 `noop=true`，最终只输出一行 NOOP 并停止。

如果 running/review action 带 `loop_triggers`，scheduler 只接受 passive 写入结果；除非用户或 schedule policy 明确批准，不得运行其中的 `active_execute_command`。

针对每个配置好的工作区执行 agent-team 自动化调度。初始阶段只读取判断队列是否有动作所需的最小信息：coordination DB v2 项目的 DB-backed task 状态、pending mailbox、sweep/smoke/provider health；legacy 项目才读取 `tasks.md` active 表格、最近 progress 条目、`.mailbox/` frontmatter 和必要状态文件。不要把完整 legacy `progress.md`、完整 `.mailbox/` 历史、archived task contracts 或 coordination DB dump 塞进提示词。

只有命中可处理项后才继续：ready/review action 先使用 deterministic scan 返回的 `model_route`，不要在 prompt 中自行重排模型。项目若启用 `routing.engine: contextual-v1`，由统一解析器应用 capability hard filter、pin/allow/deny/prefer、circuit 和本地 outcome；`shadow` 不改变执行，`legacy` 保持旧链。随后再读取对应 Task Contract、workflow、项目规则、skill 和必要证据。执行中仍必须遵守 Delegation Gate、Stack/Fullstack/Database/Deployment/Profile Gate、browser-profile、skill 渐进加载、run record、memory dedupe、高风险升级、follow-up parent/source/reason、以及“不触碰无关业务改动”等项目规则。

停止规则：没有 ready、review、超时 blocked/running、pending mailbox、provider 异常、smoke 到期或 sweep_open 时，输出 NOOP 并停止；不要写 progress、不发 mailbox、不创建 follow-up、不切模型、不展开宽范围审查。
```

## Agent Team High-Risk Reviewer / Arbiter

- 类型：cron
- 频率：每 6 小时
- 模型：`gpt-5.6-sol`（默认 OpenAI fallback；高风险 runtime 仍走智能候选链，显式配置优先）
- 推理强度：high
- 责任：只处理 `review_class: review-high` 的高风险审查、最终仲裁和 reviewer 分歧裁决；`needs_model: gpt-5.5` 仅作为旧任务兼容触发

```text
针对每个配置好的工作区，优先运行 `agmesh arbitrate --next --project <workspace>` 处理 Task Ledger / Task Contract 中明确标记为 `review_class: review-high` 的任务。旧任务若只有 `needs_model: gpt-5.5`，仍作为兼容触发识别；新任务不要再写该字段。若两种标记都没有匹配到，直接静默结束，不写 progress、不发 .mailbox、不创建 follow-up、不触碰普通 ready 队列、不输出逐项目长报告。发现高风险任务时，只读取匹配任务 row/contract、最近 progress、相关 mailbox 证据、`.agents/automations/task-contract.md`、`.agents/workflows/pr-review-merge.md`、相关 PR/MR diff、CI/check 状态、provider 原始任务、项目规则和相关 skills；不要加载完整历史。

高风险审查策略：如果没有匹配到 `review_class: review-high`，且也没有命中旧任务兼容标记，直接静默结束。模型选择交给 `agmesh arbitrate` 的统一解析器：显式 CLI `--model` 或 routing policy `pin` 为硬绑定，executor 的 task `model` 不参与 review/arbitration；allow/deny/capability/circuit 为硬门禁，prefer 与 profile-specific outcome 只做合格候选排序。未显式配置 OpenAI 候选时 fallback 为 `gpt-5.6-sol`。整条候选链共享 `--timeout-ms` 总预算并受 `routing.max_attempts` 限制，成功后停止；probe/circuit/outcome 只写本地 `.agents/state/model-routing.db`。其余 PR/MR 修复、blocked、follow-up、自动合并、人工确认和状态更新规则保持不变，不处理普通 ready 任务或无关改动。
```

## Agent Team CI Reviewer（可选）

默认不创建 CI reviewer。需要接入 PR/MR 事件时，用 `agmesh automation codex-schedule --project <path> --ci-mode comment|merge --json` 生成第三个定义，再接入 GitHub Actions / CNB / GitLab CI。

- `comment`：只评论审查结论、阻断项和下一步；永不合并。
- `merge`：guarded auto-merge；只有 merge-bypass 扫描、自修改阻断、CI 全绿、可信提交者、风险和 Task Contract 门禁全部通过才允许合并。
- provider、CI 可见性或 AI 模型不可用时，只发中性 unavailable / insufficient evidence 评论，不得 fail-open。

详细 workflow 形状和 stop rules 见 `templates/automations/ci-review-mode.md`。

## 内部流程参考

以下流程仍保留为 Orchestrator 内部调用规则，不建议再创建独立可见 automation：

- `task-automation`：常规 ready 任务执行
- `pr-review-merge`：低/中风险 review 审查合并
- `automation-health-check`：权限、CI 可见性、队列漂移检查
- `automation-smoke`：沙盒 no-op 冒烟测试
