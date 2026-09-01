# Automation Runbook

## 推荐架构

1. **Task Contract**：每个任务先标准化为契约，再进入自动化队列
2. **Provider Adapter**：GitHub、CNB、GitLab 和本地 `tasks.md` 只负责映射任务来源，不参与核心决策
3. **Skill & Convention Gate**：领取前识别相关 skill、项目代码规范、测试约定和提交规范
4. **AgentCard**：`agmesh agent list . --json` 输出可查询的 runtime 能力档案；`--write` 可持久化到 coordination DB 的 `agent_registry`
5. **Matter / Taste**：`matter list|show|draft|advance|review` 呈现交付现场；`taste save|recall` 沉淀验收偏好，但不能覆盖测试、事实、安全边界或用户最新指令
6. **Scheduler**：默认只创建 1 个常规可见定时任务，使用 `gpt-5.3-codex-spark` 每 6 小时扫描并处理低/中风险流程；它不是最终仲裁者
7. **High-Risk Reviewer / Arbiter**：只创建 1 个高风险审查/仲裁定时任务，每 6 小时处理 `review_class: review-high`、生产/安全/数据/不可逆决策和 reviewer 分歧；`needs_model: gpt-5.5` 仅作为旧任务兼容触发。实际运行模型走高风险智能候选链，显式配置优先，默认 OpenAI fallback 为 `gpt-5.6-sol`
8. **内部流程**：执行器、低风险审查、健康检查和 smoke 都作为 Orchestrator 内部流程，不再推荐创建独立可见 automation
9. **工作方式**：每个任务单独分支或 worktree，避免相互污染
10. **分层原则**：全局只存规则、模板、skills 和 adapter 规范，项目级 ledger 才是执行源；空队列只输出 `NOOP`，不展开无任务对话

## Provider 检查

- GitHub：使用 `gh` 检查登录状态、仓库访问、Actions 可见性和 review PR 状态
- CNB：检查 git 远端访问和 `.cnb.yml` 可见性；如果设置 `CNB_TOKEN` 或 `CNB_API_TOKEN`，还会检查 API 里的 pull 和 commit status 状态
- GitLab：检查 git 远端访问；深度 MR/CI 检查需要 `glab`
- Provider 检查只补充诊断，不替代项目级 Task Ledger
- `agmesh provider status . --json` 输出 GitHub/CNB/GitLab/local 的统一 provider adapter 状态；`agmesh provider sync . --write` 可把 normalized snapshot 写入 `.agents/state/provider-adapter-status.json` 供 dashboard 或外部编排读取。

## 手动创建任务

- coordination DB v2 项目通过 `agmesh context` / DB-backed task state 更新任务；legacy 项目的人工作业才直接写入 `tasks.md`
- 如果项目已经有 GitHub 或 CNB 工作流，优先用 AI 帮你创建对应平台的任务对象
- 任务必须先转换成 Task Contract，否则不要进入自动执行队列
- 任务必须声明相关 skill 和代码规范；不确定时先让 Agent 在仓库内搜索并补齐

## 领取规则

- 串行循环处理任务，直到项目级 Task Ledger 没有 eligible `ready` 任务
- 同一时间只领取并持有一个任务；每完成或阻塞一个任务后，重新读取 ledger 和 mailbox
- 已有未合并的同主题 PR/MR 时，先审查现有 PR/MR，不要重复创建
- 出现高风险变更时，暂停自动合并，改为人工确认
- 高风险或复杂审查的新任务使用 `review_class: review-high` 升级给 High-Risk Reviewer；`needs_model: gpt-5.5` 仅保留给旧任务兼容，不要在新任务中写入。运行模型优先级为显式 `agmesh arbitrate --model`、`AGENT_TEAM_HIGH_RISK_MODEL(S)`、项目配置 `high_risk_arbiter` / `high_risk_arbiter_candidates`、`AGENT_TEAM_ARBITER_MODEL(S)`、项目配置 `arbiter`，然后才进入智能候选匹配；executor 的任务 `model` 和兼容字段都不决定 review/arbitration runtime。
- 高风险智能候选链会结合已配置/探测到的 catalog、模型能力和 runtime 可用性选择国产模型、Codex/OpenAI、Claude Code、Zed 或第三方网关候选；未显式配置 OpenAI 候选时，默认 OpenAI fallback 为 `gpt-5.6-sol`。模型示例包括 `gpt-5.6-sol`、`gpt-5.6-terra`、`gpt-5.6-luna`，它们也可以是 OpenAI-compatible gateway alias；可用 `agmesh model init --probe` 探测，并用 `models.high_risk_arbiter_candidates`、`arbitration.high_risk_models` 或 `AGENT_TEAM_HIGH_RISK_MODELS` 配置候选链。不要把 GPT-5.6 的 Pro 写成模型 slug；官方 Pro 是 `reasoning.mode`，本次不宣称已经支持 pro mode。
- 新配置默认 `routing.engine: contextual-v1`；`agmesh install` 会为已有全局配置补齐缺失字段而不覆盖显式选择，已有项目级配置缺少 engine 时仍保持 `legacy`。`shadow` 只观察不改变执行。统一解析器同时服务 model diagnostics、Scheduler/Orchestrator、subagent 和 arbitration；`pin` 是硬绑定，`allow`/`deny` 是硬过滤，`prefer` 是软排序，required capability 缺失不能被 prefer 绕过。
- probe cache、model/provider circuit 和按 route profile 聚合的自动 outcome 写入 `.agents/state/model-routing.db`。它是可重建的本地状态库，不是 coordination/task 事实源，并且不得保存 prompt、源码、diff、secret、URL 或原始输出。`--timeout-ms` 是整条候选链总预算，真实调用数受 `routing.max_attempts` 限制。
- 低风险执行层也走候选链，默认优先 `gpt-5.3-codex-spark -> gpt-5.3-codex -> sonnet -> gemini-3-flash-agent`；`gemini-3-flash-agent` 适合低风险、短上下文、可重试任务，不作为高风险默认。`glm` 等国产 profile 不拆低风险专用型号，默认低风险和高风险同用该国产模型；可用 `models.routine_subagent_candidates`、`models.<role>_candidates`、`AGENT_TEAM_LOW_RISK_MODELS` / `AGENT_TEAM_ROUTINE_MODELS` 覆盖。`gemini-pro-agent` 可作为高风险候选，但内置优先级最低。
- UI 设计生成和审美评审使用独立候选链，避免污染常规执行/高风险裁决。生成链默认 `gemini-3-flash-agent -> gemini-3.5-flash -> glm-5.2 -> qwen3-max -> kimi-k2.7-code -> claude-sonnet-4-6 -> gpt-5.6-sol -> gpt-5.3-codex`，审美评审链默认 `claude-sonnet-4-6 -> claude-opus-4-8 -> gemini-3.1-pro -> glm-5.2 -> gpt-5.6-sol`；可用 `models.ui_design_candidates`、`models.ui_aesthetic_review_candidates`、`AGENT_TEAM_UI_DESIGN_MODELS`、`AGENT_TEAM_UI_AESTHETIC_MODELS` 覆盖。UI 任务建议多方裁决：Gemini/GLM/Qwen 生成方案，Codex/GPT 或 GLM 落地代码，Playwright 截图验证，Claude/Sonnet 按 `ui-aesthetic-review` skill 的审美 rubric 评审。
- Delegation Gate 先解析 `adaptive | native | managed | panel | human-loop`：Task Contract/project override 优先，否则取 model catalog 与当前 host/runtime 能力交集；低风险 native 保持单 owner 且不派外部 agent，中风险 native 使用 1 个独立 verifier，能力缺失时 managed 只补缺失 lane，高风险、review-high 或 reviewer 分歧使用单 writer + 至多 3 reviewer 的 panel，普通 review 状态本身不升级；显式 legacy `collaboration.mode` 兼容映射为 managed。派发请求仍必须包含 role、scope、ownership、allowed files、验证命令、output schema 和 mailbox persistence
- 并行写入必须有明确 disjoint ownership；routine executor/explorer 默认走 Spark 优先的低风险候选链，普通 critic/verifier 走默认 `glm-5.2` 的 verification/review-loop profile。可通过 `subagent dispatch --model`、环境变量或项目模型配置提供首选；read-only `--model` 默认仍允许 contextual fallback，只有 `--no-model-fallback` 或 policy `pin` 才是硬绑定。executor 不自动换模型。Goal Forge、Scheduler 和 task-default 继续使用各自 profile；只有高风险/仲裁场景升级并写 `escalation_reason`。
- 审查不合格优先退回原 PR/MR 修复
- 只有原 PR/MR 无法继续，或者问题已经合并进入主线，才创建 follow-up 修复任务
- follow-up 修复任务必须包含 parent / source / reason

## 记录规则

- coordination DB v2 项目把当前任务事件、mailbox 队列和 run refs 写入 `.agents/state/coordination.db`；默认用 `agmesh context . --task <id>` 读取有界上下文。
- legacy 项目更新 `progress.md` 时只写当前任务的 concise 事实；旧历史通过 `agmesh automation archive-progress . --keep-recent 50` 归档，不保留在默认上下文里。
- legacy 项目通过 `.mailbox/` 发送状态变化，并使用 `agmesh automation sync-state .` 从 `tasks.md` 同步 `.agents/state/tasks.json`；`agmesh automation claim <task_id> . --owner <owner> --branch <branch>` 会带锁推进 `ready -> running` 并同步状态
- 使用 `agmesh automation loop-strategy . --task <id> --domain auto` 先判断该任务应走 fanout、goal、micro-loop、macro-loop 还是 human-loop；只有机器验收或交付 QC 这类 `goal` / `micro-loop` 任务才适合自动评审闭环
- `loop-strategy` 同时给出 `parallelism` 建议：delivery/goal 默认 `read-only-fanout`，可并行 explorer/critic/verifier；fixed-list fanout 只有 Task Contract 为每个 executor 填写互斥 `allowed_files` 后才允许 `disjoint-writers`；marketing/demand/business 默认 `human-gated`，不得从指标或 agent score 直接启动写入型 agent
- 使用 `agmesh automation loop-trigger . --task <id> --source manual|schedule|doctor|mailbox|ci|metrics --event-key <key>` 记录触发信号；`manual` / `schedule` 是主动触发，只有显式 `--execute` 才能生成 review-loop 计划；`doctor` / `mailbox` / `ci` / `metrics` 是被动触发，只入队/记录，不能直接自动开 agent loop
- 使用 `agmesh automation review-loop . --task <id> --domain delivery --panels contract,tests,runtime --max-rounds 2` 生成有界计划；native 通常不启动外部 loop，managed 默认至多 1 reviewer/1 轮/30 分钟，panel 至多 3 reviewer/2 轮/45 分钟，总 wall-clock 上限 60 分钟。coordination DB v2 项目写入 `review_loops` 表，legacy 项目才生成 `.agents/state/review-loops/<task>.json`
- `review-loop-run` 会在 `parallelism.mode=read-only-fanout` 时并发运行同一轮只读 panel，以缩短审查墙钟时间；run record 和 mailbox 仍按 panel 单独记录，写入型 executor 不随 review-loop 自动并发
- `review-loop` 计划会持久化 mode budget、wall-clock budget 和 `stop_rules`；runner 以 fresh test、diff hash、finding hash 和 evidence ref 判定新证据，默认在失败轮次 diff 不变、零收敛或 finding 重复时停止，并输出明确 `stop_reason`。
- 使用 `agmesh automation loop-health . --json` 做闭环体检：汇总 runtime timeout/error mailbox、review-loop/Goal Forge run evidence 和 context snapshot 膨胀风险，并列出 runtime-health、trace-eval、context-hygiene、TCB sidecar、human approval、macro product signal、Taste、skill evolution 等受控入口。
- `review-loop` / `evaluator-optimizer` 必须服从 effective orchestration budget，不得超过 3 个 panel、2 轮或 60 分钟；agent score 只是代理指标，不是 CTR/CVR、付费、留存或生产真相。需求发现、营销获客和商业方向必须用 `agmesh automation product-signal` 记录真实世界数据或人工裁决；生产、secret、破坏性 git、迁移和发布必须走 `agmesh approval request|approve|reject`
- 使用 `agmesh automation archive-ledger .` 归档 `done` / `archived` task rows 和 contracts，避免 inactive 历史反复进入当前上下文
- 使用 `agmesh automation prune-mailbox . --max-bytes 131072 --archive-status done,archived,error --keep-recent 5` 清理或归档过大的 `done` / `archived` / reviewed-error mailbox 消息；先运行 `review-mailbox-errors --all` 登记已审阅的 error 后才能归档 error 文件；仍被 Task Contract 或 `.agents/state/tasks.json` 引用的 evidence mailbox 会被保留，pending/alert 消息必须保留
- `agmesh automation status|doctor .` 在 coordination DB v2 项目读取 DB 状态，在 legacy 项目检查 `tasks.md`、`progress.md` 和 mailbox 聚合体积；出现 coordination context warning 时先按建议 archive/prune 或升级到 coordination DB v2，再做宽范围 agent 工作
- 如果启用 `.agents/state/tasks.json`，同步记录 effective orchestration mode、确定性证据和所需 subagent/panel evidence；doctor 仅在该机器可读状态存在时执行缺失证据 warning，并会检查被引用的 `.mailbox/*.md` evidence 文件是否仍存在。legacy state 继续识别 accepted safe skip reason；adaptive 的中风险 native/managed 与高风险 panel 不能用 safe skip 替代独立 evidence，human-loop 不自动要求 subagent evidence。宿主工具策略、`create_thread` / parallel-agent 限制或用户未明确要求并行代理不是 accepted safe skip reason，应记录为 runtime/interruption/blocker evidence
- 中/高风险、长程、多子代理或可恢复任务可写 `.agents/state/runs/<run_id>.json`，按 `.agents/state/run-records.schema.json` 记录 run_id、task_id、子代理隔离、验证命令、证据引用和中断恢复状态
- 子代理默认上下文隔离，只通过 Task Contract、`.mailbox/`、run record 或命名 artifact 传递证据；子代理中断时先记录恢复动作，再继续执行
- 非显而易见决策写入 commit trailer

## Context Pack 与 Capability Benchmark

这两类命令默认都是本地手动触发，不进入 Scheduler，也不会自动调用昂贵模型：

```bash
agmesh automation context-pack . --type bug-fix
agmesh automation context-pack . --type pr-review
agmesh automation context-pack . --type deploy-verify
agmesh automation context-pack . --type ui
agmesh automation context-pack . --type db-migration

agmesh automation capability-benchmark . --suite pilot --write
agmesh automation capability-benchmark . --suite full --write
```

- `context-pack` 输出某类任务最小应注入的 workflows、skills、Task Contract section、证据类型和 stop rules。
- `capability-benchmark --suite pilot` 生成 5 个用例，覆盖 bug fix、PR review、deploy verify、UI 和 DB migration。
- `capability-benchmark --suite full` 生成 20 个用例，用于正式比较裸模型与 `agent-team` 机制的完成率、证据质量、返工次数、耗时和 token 成本。
- `capability-benchmark` 当前只生成本地计划文件，不执行模型调用；实际运行由人工或后续受控 runner 读取计划后触发。

## Skill Loading

- 默认渐进加载：先用 `references/skills/INDEX.md` 或已安装 skill 元数据判断命中，再读取完整 `SKILL.md` 和必要引用。
- 用户或 Task Contract 显式指定 `/skill-name` 时，视为本轮激活该 skill；仍需遵守项目规则、禁用列表和安全边界。
- 外部 `.skill` 归档或第三方 skill 只能作为显式选择，至少保留 `name`、`description`，推荐记录 `version`、`author`、`compatibility`；不要把外部仓库作为运行时 live dependency。

## Browser Automation Profile

涉及页面预览、截图、UI smoke、登录态验证或 CDP 诊断时，优先用任务描述选择入口：`agmesh automation browser-profile . --task "本地页面截图预览" --json`。已经明确 intent 时仍可用 `--intent <intent>`；需要落验收证据时加 `--verify --json`，再选择具体执行工具。

- `auto` / `light-smoke`：优先 `bun-webview`，失败或能力不足时升级到 `playwright`；Bun.WebView 是 lightweight fast path，不作为唯一验收后端。
- `local-preview`：优先 Codex 内置浏览器；没有可调用内置浏览器时用 `bun-webview` 或 `playwright`。
- `ci-e2e`：优先 `playwright`，因为它适合可复现脚本、trace、截图、移动端模拟和跨浏览器。
- `authenticated`：只有需要真实 Chrome 登录态、扩展或用户 profile 时才用 `chrome-cdp`；不要把用户 Chrome 作为普通 fallback。
- `cdp-debug`：优先 `chrome-cdp`，用于 DevTools protocol、网络/性能等底层证据。
- `--task` 会输出 `task_analysis`，包含推断出的 intent、命中的关键词、置信度、推荐验证命令；显式 `--intent` 优先级高于任务描述。

默认安全边界：不需要浏览器时不用浏览器；不要读取 cookies、密码、localStorage 或 profile 数据；提交表单、上传文件、改权限或产生外部副作用前必须有明确授权。

## Memory Adapter

- 默认记忆 provider 是 `local-file`，读写 `.agents/state/project-memory.json`，不需要外部服务或密钥。
- `mem0` / OpenMemory 作为现成 Agent Memory 方案只允许显式 opt-in：设置 `AGENT_TEAM_MEMORY_PROVIDER=mem0` 或 `openmemory`，并在 Task Contract 的 `memory_profile` 中记录证据、scope、secrets 策略和验证计划。
- 任务开始前可运行 `agmesh memory recall "<query>" --token-budget 1200`，只把命中摘要注入 prompt。
- 任务完成后可运行 `agmesh memory save decisions "<compact decision>"` 保存稳定决策。
- 不要把 legacy `progress.md`、`tasks.md` 或 `.mailbox/` 整文件写入 memory；coordination DB v2 项目以 `.agents/state/coordination.db` 为任务事实源，memory 只做可重建检索索引。
- 追加记忆前先按 `dedupe_policy` 去重；重复事实更新 source/last_seen，不重复堆积。
- 任何外部 provider 都不能绕过 token budget，也不能成为默认依赖。

## Subagent Context Budget

- `agmesh subagent dispatch` 默认会压缩 role prompt；verifier/explorer/critic 的长 task prompt 还会压成 `Orchestrator Evidence Capsule`，只保留 scope、allow-list 验证命令、验收标准和证据路径。
- `verification_command:` / `verification_commands:`、`--verification-command "<cmd>"`、旧式 `allowed command exactly once:` / `allowed command:` 都会被规范化为 sidecar 的完整命令 allow-list；显式 `--verification-command` 会由 orchestrator 在派发前执行一次并把 exit/stdout/stderr 作为 `Orchestrator Verification Evidence` 注入 verifier prompt；不要把完整 `progress.md`、完整 `.mailbox/` 历史或长日志粘进 verifier prompt。
- 用 `AGENT_TEAM_SIDECAR_TASK_PROMPT_TOKEN_BUDGET` 调整 read-only sidecar task capsule 预算；只有少数需要完整上下文的人工派发才使用 `--no-token-budget`。

## Goal Forge Integration

- `agmesh deploy .` 会创建 `.agents/goal-forge/README.md`、`.agents/goal-forge/goal-forge.config.json` 和 `.agents/goal-forge/runs/`。
- Goal Forge runtime 发现顺序：`GOAL_FORGE_BIN`、PATH 中的 `goalforge` / `goal-forge`、`npx -y @goalforge/cli@latest`、最后是 `../goal-forge` / `GOAL_FORGE_PATH` / `GOAL_FORGE_HOME` source checkout。
- 设计文档、架构/API/数据模型、迁移方案或高风险计划本身是交付物时，可运行 `agmesh goal-forge init . "<goal>"` 创建质证 run；需要实际执行时再运行 `agmesh goal-forge run . <runDir>`。
- coordination DB v2 项目以 `.agents/state/coordination.db` 为执行源；legacy 项目才以 `tasks.md`、`progress.md`、`.mailbox/` 和 Task Contract 为执行源。Goal Forge run/ledger 作为设计质证证据，在 Task Contract 的 `goal_forge.run_dir` / `goal_forge.ledger_paths` 中引用；v2 项目中 strict validate 通过的 `goal-forge run` 会写入 `run_records`，供 `loop-health` 和 trace evidence 使用。
- `agmesh automation status|doctor .` 会检查 Goal Forge runtime、项目配置和可选 checkout fallback；找不到 checkout 不阻塞二进制/package-first 运行。

## 任务契约模板

deploy 会生成 `.agents/automations/task-contract.md`，用于把不同平台的任务统一到同一结构。

## Codex 定时任务参考

deploy 会生成 `.agents/automations/codex-automations.md`，记录当前推荐的 Codex 定时任务、中文 prompt、模型、频率和覆盖工作区，方便提交到 GitHub 后供其他项目参考。

`templates/automations/recipes/codex-self-update-automations.md` 提供针对单一仓库（dogfooding 场景）的可粘贴 automation 配方，含覆盖工作区、Scheduler/Arbiter prompt 和创建后验证步骤，适合先在一个项目上跑通 loop engineering 闭环再推广。

`agmesh automation codex-schedule --project <path> --write` 会生成 Scheduler 和 High-Risk Reviewer / Arbiter 两个 Codex automation 定义到 `.agents/state/codex-automations.json`。在 Codex app 环境中加 `--sync-global` 会同步真实 `~/.codex/automations/*/automation.toml` cron automation，避免全局调度仍使用旧模型或旧 prompt；不要再创建 executor/reviewer/health/smoke 四个分散的可见定时任务。

需要接入 PR/MR 级 CI 审查时，显式加 `--ci-mode comment|merge` 生成第三个 CI reviewer 定义。`comment` 只评论不合并；`merge` 也必须经过 merge-bypass、自修改、CI、身份、风险和契约门禁后才允许自动合并。详细接线见 `ci-review-mode.md`，可参考 SupaCloud 的 AI Review & Auto-Merge 机制，但不要把 provider 不可用或模型失败当作允许合并的信号。

## Global Dashboard

`agmesh dashboard status --project <path> --project <path> --json` 聚合多个项目的 provider、Task Ledger / coordination DB 状态、mailbox、Goal Forge runtime 和 smoke 信号。dashboard 只做总览和索引，不能成为执行任务源。

## Sandbox Smoke

```bash
agmesh automation smoke
agmesh automation skills-smoke
agmesh automation release-check
```

- 默认创建临时沙盒，完成后自动清理
- 使用 `agmesh automation smoke ./tmp-smoke --keep` 可保留沙盒排查
- `skills-smoke` 验证 `references/skills/*/SKILL.md` 已同步到 Codex skill 目录
- `release-check` 验证 skill 同步、`setup.ts` 打包、deploy、Task Ledger、mailbox、分支、no-op 提交、review/done 状态和 `git diff --check`
- 不访问 GitHub / CNB / GitLab，不创建真实 PR/MR，不污染生产仓库
