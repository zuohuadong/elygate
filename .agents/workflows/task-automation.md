---
description: 任务自动化 — 从任务契约领取、执行、提 PR/MR
---
// turbo-all

# Task Automation Workflow

## 0. Pre-Execution Gate
- coordination DB v2 项目优先读取 `agmesh context . --task <id>`、DB-backed Task Contract、recent events 和 pending/conflict mailbox 队列；legacy 项目才读取 `progress.md`、`.mailbox/`、`tasks.md` 和 Task Contract
- 若任务来源不明确，先看 Task Contract，再回查 provider 原始任务
- 识别任务相关 skill、项目代码规范、测试约定和提交规范
- 先看 skill 元数据和索引，命中后再渐进加载完整 `SKILL.md` 与必要引用；若用户或契约显式指定 `/skill-name`，只对本轮激活该 skill
- 若任务创建、扩展或依赖技术栈、Fullstack Web、数据库或部署目标选择，先补齐 Stack/Fullstack/Database/Deployment Profile、decision source、evidence、required skills 和 verification plan
- 若任务涉及高风险变更、生产环境、权限、密钥，先停下来澄清

## 1. Queue Strategy
- 默认优先级：Task Contract > provider 原始任务 > coordination DB / legacy `tasks.md`
- Provider 只负责任务来源，不决定执行策略
- coordination DB v2 项目的 `.agents/state/coordination.db` 是唯一执行源；legacy 项目的 Task Ledger / `tasks.md` 是唯一执行源；全局 dashboard 只能提供索引和总览
- 任务由人工或 AI 创建，但必须先标准化为 Task Contract，并写清楚：
  - 目标
  - 非目标
  - 验收标准
  - `collaboration.mode`；`agmesh automation orchestrate --json` 会展开为 `collaboration_plan`，用于说明拓扑、并行策略、角色 lane、证据策略和 warning
  - 相关 skill 和代码规范
  - 若涉及技术栈、Fullstack Web、数据库或部署目标选择：Stack/Fullstack/Database/Deployment Profile、决策来源、证据、非目标和验证计划
  - 影响文件/模块
  - 风险等级与回滚
  - Matter 交付字段：brief、owner、deliverables、acceptance、current_stage、decision_log、handoff_artifacts、final_verdict
  - Taste 反馈字段：scope、verdict、reason、source、permission_boundary
  - 多 session / 广域重构补充 `delivery_slicing`：mode、tickets、frontier、fog、out_of_scope 和 wide_refactor strategy
- 任务状态建议：`ready` → `running` → `review` → `done`

### Delivery slicing 与 wayfinding

- 多 session 任务优先拆成端到端、可单独演示的 tracer bullets；每个 ticket 记录 `delivers`、`blocked_by`、`demoable` 和 `context_window_fit`。
- `frontier` 由 coordination DB / Task Ledger 中的当前状态和 `blocked_by` 推导；执行器只能领取 current frontier 中已解锁的切片，不得越过 blocker 抢跑。
- `fog` 只是尚未确定的路径、假设和待调查问题；`fog is not a task`，不能直接领取、派发或当作 backlog。
- `wide-refactor` 采用 `expand-contract`：先增加兼容边界，再迁移调用方，最后删除旧边界；每一阶段都必须有可验证的 tracer bullet 和回滚点。
- `delivery_slicing`、Matter 和 Goal Forge 只是 Task Contract 的设计/证据引用层，不创建新 ledger。coordination DB v2 的 `.agents/state/coordination.db` 仍是唯一执行事实源；legacy 项目仍以 Task Ledger / `tasks.md` 为准。

## 2. Delegation Gate（能力自适应 + 风险分级）

**核心原则：行动型任务必须先做 Delegation Decision；模型/runtime 能力决定执行模式，任务风险决定验证强度，确定性证据决定是否完成。Orchestrator 管状态、权限、预算、证据和裁决，不重复接管强模型已经完成的内部编排。**

### 调度命令

```bash
# 派发子代理任务
agmesh subagent dispatch <role> "<prompt>" [--model <model>] [--runtime <codex|claude>] [--mailbox <file>]

# 查看可用角色
agmesh subagent list

# 检查运行时可用性
agmesh subagent status
agmesh subagent status --json  # 机器可读 runtime 能力矩阵

# 查看可查询的 AgentCard / runtime 能力档案
agmesh agent list . --json
```

### 默认模型映射

| 角色 | 模型 | 用途 | 沙箱 |
|------|------|------|------|
| Orchestrator / Arbiter | `review_class: review-high` / 高风险候选链（OpenAI fallback: `gpt-5.6-sol`） | 任务拆解、风险分类、最终裁决、高风险审查、分歧仲裁 | — |
| Executor | 低风险候选链（默认 `gpt-5.3-codex-spark`，回退候选 `gpt-5.3-codex` / `sonnet` / `gemini-3-flash-agent`） | 实现、测试、修复、本地验证、提交准备 | workspace-write |
| Explorer | 低风险候选链 | 代码探索、根因分析、竞品调研 | read-only |
| Critic | verification/review-loop 候选链（balanced/pro 默认 `glm-5.2`） | 计划审查、方案评审 | read-only |
| Verifier | verification/review-loop 候选链（balanced/pro 默认 `glm-5.2`） | 完成验证、证据审查 | read-only |

低风险执行层优先使用 Codex/GPT 系列和 Claude Sonnet；`gemini-3-flash-agent` 只适合低风险、可重试的短任务兜底。国产模型默认不拆低风险专用型号，`glm` profile 会让常规执行和高风险裁决都使用 `glm-5.2`，但仍可通过 `--model`、`AGENT_TEAM_<ROLE>_MODEL(S)`、`AGENT_TEAM_LOW_RISK_MODELS` / `AGENT_TEAM_ROUTINE_MODELS` 或项目级 `models.routine_subagent_candidates` / `models.<role>_candidates` 覆盖。只有安全、数据、生产、不可逆决策或 reviewer 分歧无法收敛时才标记 `review_class: review-high`，并记录 `escalation_reason`；`needs_model: gpt-5.5` 仅作为旧任务兼容触发。实际运行模型可通过 `--model`、项目级 `.agents/agent-team.config.json`、`AGENT_TEAM_HIGH_RISK_MODEL(S)` 或 `AGENT_TEAM_ARBITER_MODEL(S)` 覆盖，未显式配置 OpenAI 候选时使用 `gpt-5.6-sol` 作为 OpenAI fallback。候选链会识别国产模型族以及 Codex/OpenAI、Claude Code、Zed/第三方网关常见模型名，包括 Claude、Gemini、Grok/xAI 和 Mistral；`gemini-pro-agent` 高风险优先级最低，只在更强候选不可用时尝试。runtime 能力必须以 `agmesh subagent status --json` 为准：runtime 通过 provider registry 统一声明是否支持 sandbox、last-message/output capture、JSON 输出、timeout、模型覆盖和 mailbox evidence；`builtin/codex-exec` 是当前默认自动检测 runtime，`explicit/claude-adapter` 默认只在显式 `--runtime claude` 时使用。只有配置 `AGENT_TEAM_SUBAGENT_RUNTIME_FALLBACKS=claude` 或项目级 `runtime.subagent_fallbacks: ["claude"]` 后，策略层才可在 Codex 不可用时显式 fallback 到 Claude，且 status 必须显示 `selectionPolicy.explicitFallbacks`；不要从 Codex 静默切换到 Claude。`editor/zed-rules` 只表示规则入口，不是可派发的 standalone 子代理 runtime；Zed 只有提供稳定 CLI/非交互 agent runtime 后才接入 dispatchable provider。
模型路由统一通过 `agmesh model resolve` 的 engine 执行：新配置和 install 补齐的全局配置使用 `contextual-v1`；已有项目级配置缺少 `routing.engine` 时保持 `legacy`，`shadow` 只观察 contextual 决策。`contextual-v1` 应用 capability hard filter、`pin/allow/deny/prefer`、probe TTL、circuit 和 outcome 排序。路由反馈必须 local-first：真实调用自动写入项目本地 `.agents/state/model-routing.db`，按 route profile 聚合；旧 `.agents/state/model-route-outcomes.json` 与显式 local `route_outcomes` 仅作兼容输入。中心/聚合遥测只能作为 catalog 先验、benchmark 或人工优化信号，不能覆盖客户自己的 relay/账号/地域结果。数据库不得保存 prompt、源码、diff、secret、URL 或原始输出。
UI 设计生成、审美改版或视觉质量修复不走普通 routine 排序：生成链默认 `gemini-3-flash-agent` / `gemini-3.5-flash` / `glm-5.2` / `qwen3-max` / `kimi-k2.7-code` 优先，GPT/Codex 只作落地兜底；审美评审链默认 `claude-sonnet-4-6` / `claude-opus-4-8` 优先。UI 任务必须把 `model_profile` 记录为 `ui-design-generation` 或 `ui-aesthetic-review`，并提供截图证据、响应式检查、无重叠/无溢出检查和审美 rubric 评审结论。
`automation review-loop-run` 可用 `--model`、`AGENT_TEAM_REVIEW_LOOP_MODEL` 或 `models.review_loop` 覆盖整轮评审；Goal Forge 深度设计/质证循环可用 `--model`、`AGENT_TEAM_GOAL_FORGE_MODEL` 或 `models.goal_forge` 覆盖；Scheduler 使用 `models.scheduler`，未显式 pin 的 task-default 路由使用 `models.task_default`，新任务行的 `model` 保持为空。

### 默认执行流程

先统一解析 `orchestration.mode: adaptive|native|managed|panel`：

- `adaptive`：只有 Task Contract/项目显式 override，或 model catalog 与当前 host/runtime 的能力交集，证明 `native_delegation`、`tool_call`、`long_horizon`、`structured_output`、`context_isolation`、`runtime_recovery` 六项能力时才进入 `native`；证据不足回退 `managed`。
- `native`：单 owner/writer；低风险不派外部 agent，中风险最多增加一次 risk-triggered verifier。
- `managed`：只在根因未知、陌生区域、上下文不足或 owner 不具备可靠实现能力时按需派发 explorer/executor；verifier 仍由风险触发。
- `panel`：高风险、`review-high`、明确审查冲突或安全/生产/数据/迁移/不可逆操作；唯一 writer，加最多三个独立只读 reviewer，默认最多两轮。普通 `review` 状态本身不升级 panel。
- `human-loop`：产品方向、审美/品味、商业选择和不可逆判断不自动闭环，等待人类裁决或真实数据。

`collaboration.mode` 只保留为显式 legacy 协作形态；一旦填写就兼容解析为 `managed`，不覆盖统一的风险和 evidence gate：

- `solo`：单执行路径；它不降低风险等级。中风险仍需要一次独立 verifier，高风险由统一 resolver 升级为 panel。
- `critic`：做审分离，executor 写入后由 critic/verifier 独立复核。
- `pipeline`：显式 managed 流程，explorer → executor → verifier 串行交接，每一阶段把 evidence refs 传给下一阶段。
- `split`：只有 Task Contract 中每个 executor lane 的 `allowed_files` 互斥时才允许并行写入；重叠或缺失时降级为 read-only fanout / 串行。
- `roundtable` / `swarm`：只读讨论、多方案竞选或低风险生成，必须由 orchestrator 或 human 做最终裁决，不能自动并行写入。

**统一 owner 流程**：

1. **Owner 读取 Task Contract** → 解析 effective orchestration mode、风险、预算和 stop rules
2. **Owner 规划/实现** → native 由当前 owner 自主组织；managed 只派发缺失的必要 lane；panel 保持唯一 writer
3. **确定性验证** → 运行定向测试、构建、类型检查、静态检查和 diff 检查
4. **风险触发验证** → 中风险最多一次独立 verifier；高风险进入 bounded panel；human-loop 等待人类或真实数据
5. **Orchestrator 裁决** → 只有新鲜证据满足验收标准时才写入 PASS/FAIL/PARTIAL 和当前执行源

**低风险普通功能/修复**：

1. 当前 owner 直接实现
2. 运行确定性验证
3. diff 不变、没有新失败或没有新证据时停止，不追加“为了放心”的审查轮次

**纯解释/只读/简单命令/格式化/纯文档**（可跳过全部子代理，但必须记录跳过原因）：

1. Orchestrator 直接执行
2. 记录 `safe_skip_reason`

### 风险升级与 lane 触发

- `explorer`：只在根因未知、代码区域陌生、上下文不足、需要外部事实或存在多个实现路径时触发。
- `executor`：默认就是当前 owner；只有 managed 模式且 owner/runtime 不适合直接写入时才另派。
- `verifier`：中风险、跨模块、用户可见、UI/E2E、外部核验或证据冲突时触发，默认最多一次。
- `panel`：安全、生产、认证、权限、计费、数据模型/迁移、不可逆操作或 reviewer 分歧时触发；设计质量本身是交付物时可使用 `/design-review` 或等价 Goal Forge 质证流程。
- `human-loop`：产品方向、审美/品味、商业选择或无法由机器证据覆盖的不可逆判断。
- 强模型不能绕过 panel/审批；弱模型处理低风险任务也不应被强制完整三角色流水线。

### 记录要求

- 使用了子代理：记录角色、范围、收到的证据和最终如何采纳
- 子代理 mailbox / run record 应关联 AgentCard（例如 `agent_id`、runtime、model），便于审查执行来源
- resolver 选择 native 且预算为 external=0：记录 resolved mode、能力证据、风险和确定性验证；这不是 `safe_skip_reason`
- Delegation Gate 整体未运行：只允许纯解释/只读/简单命令/格式化/纯文档，并记录为什么安全跳过（`safe_skip_reason`）
- 若子代理结论冲突，先通过 `.mailbox/` 或 Task Contract 收敛，不要直接声明完成

### Post-edit evidence/review gate（会话级）

- 行动型变更只要创建或修改了代码、测试、workflow、自动化、配置，或会影响行为的文档，最终回复前必须先用 `git diff --name-only` 和目标 diff 检查本轮改动范围
- diff 检查后按 effective mode 和风险执行验证：低风险 native/managed 可由确定性证据闭环；中风险最多派发一次独立 Verifier；高风险必须进入 panel；human-loop 不得自动声明方向性结论
- 该 gate 只产生 session-scoped review evidence，不自动创建 coordination DB 任务，也不改变 scheduler / orchestrate 的唯一执行事实源
- 当 resolved plan 要求 Verifier/panel 时，超时、失败、输出不完整或 mailbox 缺失必须先记录 `interruption_recovery`；没有可采纳独立 evidence 时最终裁决只能是 `PARTIAL` / `blocked`，不能声明 `PASS`

### 子代理请求契约

每个子代理 dispatch 必须写清楚：

- `role`：`executor` / `explorer` / `critic` / `verifier`
- `exact scope`：要回答的问题或负责的实现切片
- `read/write ownership`：只读，或允许修改的文件/目录
- `allowed files/directories`：明确边界，避免并行写冲突
- `context isolation`：默认 isolated；显式列出 shared context、handoff artifacts 和合并策略
- `verification command`：需要运行或复核的命令
- `output schema`：至少包含 `verdict`、`evidence`、`blocking_findings`、`non_blocking_risks`、`recommended_next_action`
- `mailbox persistence`：是否必须写 `.mailbox/`，以及 request/response 文件名

不要为常规实现设置 `review_class: review-high` 或强行使用高风险候选链，也不要创建多个 always-on executor 竞争同一个队列。并行写入只有在文件所有权明确互斥时才允许。

### 中断恢复

- 子代理超时、中断、输出结构不完整或 mailbox 缺失时，先更新 Task Contract 的 `interruption_recovery` 字段
- 记录 `resume_state`、`last_stable_artifact`、`dangling_subagents`、`recovery_owner` 和 `recovery_action`
- 只有最后稳定证据足以支撑验收时才能继续；否则重派子代理、请求用户输入或标记 blocked
- 不要把半截输出、未写入 mailbox 的结论或未验证的推测当作完成证据

## 3. 循环执行器（Codex 优先）
- 模型优先：由 routine profile/config 解析，balanced/pro 首选 `gpt-5.3-codex-spark`
- 在每个项目内串行循环，直到没有 eligible `ready` 任务
- 同一时间只领取并持有 1 个任务，避免并发抢占
- 每完成或阻塞一个任务后，coordination DB v2 项目重新读取 `agmesh context` / DB 状态；legacy 项目重新读取 `tasks.md`、`progress.md` 和 `.mailbox/` 再决定是否领取下一个
- 先创建独立分支或 worktree，再修改代码
- 实施顺序：
  1. 读取 Task Contract，确认目标和非目标
  2. 按 `skill_loading` 渐进加载相关 skill 和项目代码规范
  3. 领取任务并写入 owner / branch / provider 状态
  4. 执行 Delegation Gate；解析 effective orchestration mode，只派发 resolver 要求的 lane，并应用外部 agent、轮次和 wall-clock 预算
  5. 最小实现
  6. 测试 / 类型检查 / 构建
  7. 提交并推送
  8. 创建 PR/MR
- 完成后把任务状态改为 `review`
- 遇到模糊、风险高、缺少验收标准、缺少 skill/代码规范或邮箱冲突的任务，标记 `blocked` 或留下明确说明，然后重新读取 ledger，继续处理下一个 eligible `ready` 任务
- 遇到 Stack/Fullstack/Database/Deployment Profile 缺失、推荐栈与现有项目证据冲突、隐含框架/数据库/托管平台迁移、只写“app/小程序”但目标不清、SSR/SSG/API 所有权不清、桌面/移动/Mpx/数据库/部署运行边界不清时，标记 `blocked` 并要求补齐契约，不要自动套默认栈、默认数据库或默认平台
- 若要让 `automation doctor` 对缺失 subagent evidence 发出强 warning，必须先存在 `.agents/state/tasks.json` 这样的机器可读 task state；不要只靠 Markdown 表格正则推断执行证据。

## 4. 审查移交
- 执行器不自行合并自己的 PR/MR
- PR/MR 描述必须引用 Task Contract，并逐条列出验收证据、使用的 skill 和遵循的代码规范
- PR/MR 描述必须说明 Delegation Gate 结果：使用了哪些子智能体，或为什么安全跳过
- 若发现契约缺失、任务过大或风险上升，改为 `blocked` 并说明原因

## 4.5. Evidence Gate (Hard Gate)

任务进入 `done` 或 `review` 前，必须满足以下硬约束：

- 至少引用一条新鲜证据：测试命令及退出码、CI run URL、`git diff --check` 输出、构建日志、截图、部署 URL/健康检查、DB 查询结果或日志行之一
- 证据必须是本轮执行的，不接受引用上次运行或上一个 PR 的旧证据
- 没有证据只能标 `partial` 或 `blocked`，不能标 `done`
- 中风险任务必须有确定性证据，并由最多一次独立 verifier 复核；高风险任务必须有 panel evidence 和所需审批。orchestrator 自己重跑命令只能补充确定性证据，不能替代风险要求的独立复核
- 纯文档/格式化任务也必须引用 `git diff --check` 或构建/类型检查通过的证据
- 涉及生产数据库、生产对象存储、线上 CMS/KB、搜索索引或外部 API 状态写入时，Task Contract 必须填写 `production_data_gate`；没有通过用户确认生产端点的 live read-back 证据时，不能标 `done`、`PASS` 或“已修复”

此规则适用于所有完成路径，包括 `/dev`、`/task-automation` 和 `/pr-review-merge`。

## 5. 记录要求
- coordination DB v2 项目每次领取、暂停、完成都要写入 DB event / mailbox 队列；legacy 项目才更新 `progress.md` 或通过 `.mailbox/` 留消息
- 中/高风险、长程、多子代理或可恢复任务建议写入 `.agents/state/runs/<run_id>.json`，按 `.agents/state/run-records.schema.json` 保存证据引用、命令和 redaction 状态
- 任务完成后只把稳定事实、决策、已知坑、否决方案或回滚约束写入 `.agents/state/project-memory.json`，并先去重；不要把 coordination DB dump 或 legacy `tasks.md`、`progress.md`、`.mailbox/` 整文件灌入 memory
- 使用 `agmesh matter list|show . --json` 查看 Task Contract 的交付现场；`matter draft|advance|review` 可以生成草案、推进阶段或记录 review event，但不能替代 coordination DB / Task Ledger 状态。
- 使用 `agmesh taste save|recall . --scope <scope> --json` 保存和召回验收偏好；Taste 只影响排序、提示和文案偏好，不能覆盖测试、事实、安全边界、生产确认或用户最新指令。
- 使用 `agmesh automation tcb . --json` 查看 sidecar Thread Control Block；除非必须复核具体证据，否则不要把完整子线程上下文塞回主线程。
- 使用 `agmesh approval request|approve|reject` 记录生产、secret、破坏性 git、数据迁移、发布或不可逆决策的人审暂停/恢复；批准只恢复执行资格，不替代验证。
- 使用 `agmesh automation product-signal` 记录需求/增长/商业方向的真实信号；`agent_score` 只能作为 `--proxy` 上下文，不能作为 CTR/CVR、付费、留存或生产真相。
- 使用 `agmesh automation skill-evolution --write` 把重复 runtime/context/CI/review 失败转成 Matter 草案；不要自动改 skill、workflow 或 runbook。
- 非显而易见的决策写进 commit body 的 `Rejected:` / `Constraint:` / `Directive:`
- 任务平台变更时只更新 provider adapter，不改 Task Contract 语义
