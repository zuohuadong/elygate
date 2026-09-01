# Task Contract Template

> 用于把 GitHub Issue、CNB Issue、GitLab Issue 或本地 `tasks.md` 统一成自动化可执行的任务契约。

```yaml
task_id: ""
provider: "local" # github | cnb | gitlab | local
repo: ""
source_url: ""
status: "ready" # ready | running | review | blocked | invalid | done
risk: "low" # low | medium | high
priority: "normal" # low | normal | high | urgent
owner: ""
model: "" # 仅在 ready/running executor 需要显式硬 pin 时填写；review/arbiter 不继承
needs_model: "" # 仅兼容旧任务；新高风险任务使用 review_class: review-high
review_class: "" # review-low | review-high；高风险任务的主标记
escalation_reason: ""
collaboration:
  mode: "solo" # solo | roundtable | critic | pipeline | split | swarm
  rationale: ""
orchestration:
  mode: "adaptive" # adaptive | native | managed | panel
  owner_model: ""
  capabilities: # 未知能力可留空；显式 true/false 覆盖 catalog metadata
    native_delegation:
    tool_call:
    long_horizon:
    structured_output:
    context_isolation:
    runtime_recovery:
  native:
    max_external_agents: 1 # low risk is resolved to 0; medium risk reserves one verifier
    max_reviewers: 1
    max_rounds: 1
    wall_clock_budget_minutes: 20
  managed:
    max_external_agents: 2
    max_reviewers: 1
    max_rounds: 1
    wall_clock_budget_minutes: 30
  panel:
    max_external_agents: 3
    max_reviewers: 3
    max_rounds: 2
    wall_clock_budget_minutes: 45
  stop_rules:
    require_new_evidence: true
    stop_on_unchanged_diff: true
    dedupe_findings: true
    stop_on_zero_contraction: true
model_route:
  profile: "" # routine-code | verification | high-risk-arbitration | ui-design-generation | ui-aesthetic-review | scheduler | task-default
  required_capabilities: [] # code.assist | tool.call | structured.output | vision.analyze 等
  engine: "" # legacy | shadow | contextual-v1；记录项目实际配置，不在任务里隐式切换
  policy_ref: "" # .agents/agent-team.config.json routing profile/role，或显式 task model pin
branch: ""
change_request_url: ""
created_at: ""
updated_at: ""
```

## Goal

写清楚任务目标。

## Non-goals

写清楚不做什么，避免自动执行时扩大范围。

## Acceptance Criteria

- [ ] 可验证标准 1
- [ ] 可验证标准 2

## Expected Scope

- 预计修改的模块、文件或目录

## Delivery Slicing

> 用于把多 session 交付拆成可演示的 tracer bullets，或记录 wide refactor / wayfinding 的当前边界。这些字段只是 Task Contract / Matter 的引用层，不创建第二套执行事实源。

```yaml
delivery_slicing:
  mode: "single-slice | tracer-bullets | wide-refactor | wayfinding"
  tickets:
    - title: ""
      delivers: ""
      blocked_by: []
      demoable: true
      context_window_fit: "yes | no | unknown"
  frontier: []
  fog: []
  out_of_scope: []
  wide_refactor:
    strategy: "expand-contract"
```

规则：

- 多 session 任务优先按端到端、可单独演示的 tracer bullets 拆分，不要只按技术层横向拆分。
- `frontier` 只包含由当前任务状态和 `blocked_by` 推导出的已解锁切片；只有 frontier 中的切片可被领取。
- `fog` 记录尚未确定的可能路径、待验证假设或未解决问题；`fog is not a task`，不能直接派发或当作 backlog。
- `wide-refactor` 必须使用 `expand-contract`：先扩展可兼容边界和迁移路径，再迁移调用方，最后收缩旧边界。
- 状态、owner 和可领取性仍以 coordination DB v2 `tasks` / legacy Task Ledger 为准；`delivery_slicing`、Matter 和 Goal Forge 只保存设计、引用与交付证据。

## Matter

> Matter 是 Task Contract 的交付现场视图；coordination DB v2 项目可用 `agmesh matter list|show` 查看当前阶段、验收、证据和最终结论。

```yaml
matter:
  brief: ""
  deliverables: []
  current_stage: "draft | ready | running | review | blocked | done"
  delivery_slicing_ref: "task-contract:delivery_slicing | none"
  frontier_refs: []
  fog_refs: []
  decision_log_refs: []
  handoff_artifacts: []
  final_verdict:
    status: "pending | partial | pass | fail | blocked"
    evidence_refs: []
```

规则：

- `matter` 不创建第二套执行事实源；状态仍以 coordination DB `tasks` / legacy Task Ledger 为准。
- `delivery_slicing_ref`、`frontier_refs`、`fog_refs` 只引用上方契约字段或证据路径，不复制 ticket、状态或 blocker 正文。
- `agmesh matter draft` 只生成或写入可编辑 Task Contract 草案；`matter advance` / `matter review` 必须留下 event 和 evidence ref。
- final verdict 必须引用测试、构建、CI、浏览器、部署健康检查、DB 查询或 live read-back 等证据。

## Taste Feedback

```yaml
taste_feedback:
  scope: "general | cli | docs | ui | release | code"
  verdict: "accepted | rejected | partial"
  reason: ""
  source: "human-review | cli | pr-review | release-review"
  permission_boundary: "taste affects ranking and prompts only; it never overrides facts, tests, safety, or the latest user instruction"
```

规则：

- `agmesh taste save` 将人类验收、打回原因和风格取舍写入结构化反馈；`taste recall` 按 scope 召回。
- Taste 只能影响候选排序、提示和文案偏好，不能作为权限、生产确认、测试通过或安全例外。
- 被打回的方案不应在同一任务中继续作为默认推荐，除非 Task Contract 明确记录新的证据或用户最新指令覆盖。

## Loop Control

```yaml
loop_control:
  trace_eval:
    run_ref: "review_loops:<task-id> | run_records:<run-id> | none"
    graders: ["tool_choice", "handoff_quality", "safety_contract", "improvement_signal"]
  context_hygiene:
    capsule_ref: ".agents/state/context-packs/<id>.json | none"
    large_payload_policy: "store evidence path + capsule, never raw base64"
  runtime_health:
    latest_mailbox_error: ".mailbox/<file>.md | coordination-db:mailbox_messages:<id> | none"
    retry_policy: "narrow prompt, inspect error mailbox, disable fallback when validating one model"
  tcb:
    command: "agmesh automation tcb . --json"
    policy: "read Thread Control Blocks before loading full sidecar context"
  approval:
    required_for: ["production", "secret", "destructive-git", "data-migration", "publish", "irreversible-decision"]
    command: "agmesh approval request . --task <id> --reason <reason> --risk <risk> --rollback <plan>"
  product_signal:
    command: "agmesh automation product-signal . --task <id> --hypothesis <text> --artifact <ref> --metric <metric> --value <value> --decision inconclusive"
    proxy_policy: "agent_score requires --proxy and is non-decisive"
  skill_evolution:
    command: "agmesh automation skill-evolution . --task <id> --source runtime|context|ci|review --reason <reason> --write"
    auto_apply: false
```

规则：

- `review-loop` / `evaluator-optimizer` 只适合机器验收、交付 QC、文档/CLI 文案和迁移方案等有明确验收标准的任务。
- `automation product-signal` 只记录真实互动、留资、付费、留存、访谈或人工裁决；agent score 不能作为生产或市场真相。
- `approval request` 会暂停任务，`approve --resume` 只恢复执行资格，不替代测试、发布门禁或 completion evidence。
- `skill-evolution --write` 只生成 Matter 草案；改 skill、runbook 或 workflow 前仍需人审和独立验证。

## Goal Forge

> 当设计文档、架构/API/数据模型、迁移方案或高风险计划本身是交付物时填写；普通实现任务可保持 disabled。

```yaml
goal_forge:
  enabled: false
  runtime: "binary | npm-package | source-checkout | unavailable"
  binary_path: "env:GOAL_FORGE_BIN | PATH:goalforge | PATH:goal-forge | unknown"
  package_spec: "@goalforge/cli@latest | pinned package | none"
  checkout_path: "../goal-forge | env:GOAL_FORGE_PATH | env:GOAL_FORGE_HOME | none"
  run_dir: ""
  config_path: ".agents/goal-forge/goal-forge.config.json"
  ledger_paths: []
  adapter: "local | codex | openai | none"
  evidence_summary: ""
  run_record_ref: "run_records:goal-forge:<run-id> | .agents/state/runs/<id>.json | none"
  wayfinding:
    delivery_slicing_ref: "task-contract:delivery_slicing | none"
    frontier_refs: []
    fog_refs: []
  verification:
    status_check: "agmesh goal-forge status ."
    init_check: "agmesh goal-forge init . '<goal>'"
    run_check: "agmesh goal-forge run . '<runDir>' --adapter local"
    loop_health_check: "agmesh automation loop-health . --json"
  non_goals:
    - "do not vendor Goal Forge into this project"
    - "do not require model-backed Goal Forge runs during deploy"
    - "do not place secrets in Goal Forge config or ledgers"
```

## Delegation Gate

```yaml
delegation:
  triggers_checked:
    risk: "low | medium | high"
    multi_subsystem: false
    architecture_api_data_security_production: false
    external_research: false
    review_of_own_work: false
  required: false
  parallelism:
    mode: "serial | read-only-fanout | disjoint-writers | human-gated"
    max_agents: 1
    writer_policy: "single writer; parallel write blocked unless allowed_files are disjoint"
    merge_policy: "orchestrator owns merge order and conflict resolution"
    lanes:
      - id: ""
        role: "explorer | executor | critic | verifier"
        scope: ""
        ownership: "read-only | write"
        parallel: false
        allowed_files: []
        start_after: []
    warnings: []
  subagents:
    - role: "explorer | critic | verifier | worker"
      model: "gpt-5.3-codex-spark | gpt-5.3-codex | gpt-5.6-sol | gpt-5.6-terra | gpt-5.6-luna | glm-5.2 | claude-opus-4-8 | sonnet | gemini-3-flash-agent | gemini-pro-agent | grok-4 | mistral-large-latest | custom gateway alias"
      model_profile: "routine | high-risk | ui-design-generation | ui-aesthetic-review | custom"
      escalation_reason: ""
      scope: ""
      ownership: "read-only | write"
      allowed_files: []
      context_isolation: "isolated | shared-readonly | shared-write | blocked"
      shared_context_allowed: []
      handoff_artifacts: []
      verification_command: ""
      output_schema: "verdict, evidence, blocking_findings, non_blocking_risks, recommended_next_action"
      mailbox_persistence: "required | optional | none"
      mailbox_ref: ""
  interruption_recovery:
    resume_state: "not-needed | resumable | blocked | unknown"
    last_stable_artifact: ""
    dangling_subagents: []
    recovery_owner: "orchestrator | original-subagent | verifier | blocked"
    recovery_action: "continue | rerun-subagent | request-human | mark-blocked | none"
    placeholder_evidence: []
  safe_skip_reason: ""
```

规则：

- `collaboration.mode` 定义任务的协作形态：`solo` 为单执行器；`roundtable` 为多方只读讨论后由 orchestrator 收束；`critic` 为做审分离；`pipeline` 为串行交接；`split` 为按互斥文件/模块分头执行后合并；`swarm` 为多方案竞选。未填写时，`agmesh automation orchestrate --json` 会按任务状态、风险、文本信号和写入型 `allowed_files` lane 推断 `collaboration_plan`；只有低风险局部任务且没有并发信号时才保持 `solo`。
- `orchestration.mode: adaptive` 先按 Task Contract/project override，或 model catalog 与当前 host/runtime 的能力交集，解析 `native_delegation`、`tool_call`、`long_horizon`、`structured_output`、`context_isolation`、`runtime_recovery` 六项能力。证据完整时可用 `native`；缺失时回退 `managed`；高风险、review-high 或 reviewer 分歧使用 `panel`，普通 review 状态本身不升级；无法机器验收的方向判断使用 `human-loop`，但高风险/不可逆操作仍优先 panel。
- `native` 保持单 owner model，低风险通常不派外部 agent，中风险至多增加 1 个独立 verifier；`managed` 只派发缺失的有界 lane；`panel` 保持单 writer、至多 3 个独立 reviewer、至多 2 轮。所有模式共享 fresh test、diff hash、finding hash、evidence ref 和明确 stop reason。
- 显式 legacy `collaboration.mode` 继续兼容并映射为 effective `managed`，不会隐式开启 model-native orchestration；现有 `collaboration_plan` 仍作为 additive 输出保留。
- wall-clock budget 可按任务或项目显式配置，但上限为 60 分钟。review-loop runner 必须读取持久化 plan 并遵守 `stop_rules`；默认在失败轮次 diff 不变时立即停止。
- `model_route` 记录任务需要的 route profile、capability hard filter、实际 engine 和策略证据；具体 `pin/allow/deny/prefer` 以项目 routing 配置为准。task `model` 只作为 `ready` / `running` executor 的显式硬约束，review、high-risk escalation 和 `arbitrate --task/--next` 不继承；`allow`/`deny` 是硬集合，`prefer` 只排序已通过 capability/circuit 门禁的候选。
- contextual routing 的 probe/circuit/outcome 保存在 `.agents/state/model-routing.db`，不得把 prompt、源码、diff、secret、URL 或原始输出写入 Task Contract 或路由库。subagent/arbitration 的 timeout 是候选链总预算，调用数受 `routing.max_attempts` 限制。
- 低风险 executor 默认走 routine profile（首选 `gpt-5.3-codex-spark`）；普通 critic/verifier 走 verification profile（默认 `models.review_loop: glm-5.2`）。可通过 routing profile/role、环境变量或显式 CLI policy 覆盖；不要为普通 delegation 固化 `--model`。
- 新任务使用 `review_class: review-high` 作为进入 High-Risk Reviewer / Arbiter 的主标记，并填写 `escalation_reason`；`needs_model: gpt-5.5` 仅用于兼容旧任务，自动化仍会识别，但不要在新任务中写入。
- 高风险 runtime 使用独立候选链。显式 CLI `--model`、`AGENT_TEAM_HIGH_RISK_MODEL(S)` / `AGENT_TEAM_ARBITER_MODEL(S)` 和项目配置优先；executor task `model` 不参与审查/裁决。未显式配置 OpenAI 候选时，默认 OpenAI fallback 为 `gpt-5.6-sol`。`gpt-5.6-sol`、`gpt-5.6-terra`、`gpt-5.6-luna` 也可以是 OpenAI-compatible gateway alias。不要把 GPT-5.6 的 Pro 写成模型 slug；官方 Pro 是 `reasoning.mode`，本模板不宣称已经支持 pro mode。
- UI 设计生成使用独立 `ui-design-generation` 候选链：Gemini/GLM/Qwen/Kimi 优先，GPT/Codex 作为落地兜底；审美评审使用 `ui-aesthetic-review` 候选链：Claude/Sonnet 优先，Gemini/GLM 次之。UI 任务的验收必须包含视觉截图证据、响应式检查、文本不溢出/不重叠、交互控件状态和审美 rubric 评审结论。
- Goal Forge 深度设计/质证循环用 `--model`、`AGENT_TEAM_GOAL_FORGE_MODEL` 或 `models.goal_forge` 覆盖；v2 项目中 `goal-forge run` strict validate 通过后会写入 `run_records`，作为 `loop-health` / trace evidence 的一部分；Scheduler 使用 `models.scheduler`，未显式 pin 的 task-default 路由使用 `models.task_default`，但新任务行的 `model` 保持为空。
- 不得以宿主工具策略、`create_thread` / parallel-agent 限制、或用户未明确要求并行代理作为 `safe_skip_reason`。当 resolved plan 要求 lane 时，agent-team 子代理以 `agmesh subagent dispatch` 或 `agent_team_dispatch_subagent` 为准；若 runtime 不可派发，应记录 runtime 证据和 `interruption_recovery`，并标记 `blocked` / `PARTIAL`。native 低风险 external=0 是有效 resolved plan，不是 safe skip 或 runtime gap。
- 推荐先用 `agmesh automation loop-strategy . --task <id> --domain auto` 生成 `parallelism` 建议：delivery/goal 默认只并行 read-only sidecar，fixed-list fanout 只有拆出互斥 `allowed_files` 后才允许并行 executor，marketing/demand/business 默认 human-gated。
- 并行 worker 只有在 `allowed_files` 明确互斥时才允许；未能证明互斥时，`parallelism.mode` 必须降级为 `read-only-fanout` 或 `serial`。
- 子代理默认 `context_isolation: isolated`，只能通过 `handoff_artifacts`、mailbox（v2 为 DB mailbox，legacy 为 `.mailbox/`）和 Task Contract 字段交换证据；不要假设其他子代理上下文可见。
- `shared-write` 只允许在文件所有权明确互斥且 Orchestrator 记录合并策略时使用；否则标 `blocked`。
- 子代理中断、超时或输出不完整时，先记录 `interruption_recovery`，再决定续跑、重派或阻塞；不要把半截输出当作完成证据。
- 任务进入 `review` / `done` 时必须记录 effective orchestration mode 对应的确定性证据；中风险 native 最多使用 1 个独立 verifier，高风险使用 panel evidence，human-loop 等待人工裁决。

## Skill Loading

```yaml
skill_loading:
  required_skills: []
  optional_skills: []
  activation_mode: "auto | explicit | task-contract | disabled"
  invocation_policy:
    auto: []
    task_contract: []
    explicit: []
    internal: []
    router: "agent-team-router | none"
  progressive_loading: true
  loaded_for_turn: []
  disabled_skills: []
  metadata_required:
    - "name"
    - "description"
  compatibility_notes: []
  non_goals:
    - "do not load every installed skill into every prompt"
    - "do not bypass project AGENTS.md or task-specific conventions"
```

规则：

- 默认渐进加载：先读取 skill 元数据和索引，只有任务命中时才完整读取 `SKILL.md` 及其必要引用。
- 明确用户写出 `/skill-name` 或 Task Contract 指定 skill 时，可视为单轮显式激活；仍需遵守禁用列表、项目规则和安全边界。
- `invocation_policy` 是 Task Contract / skill 索引层的分类：`auto` 可按语义匹配自动加载，`task_contract` 必须由契约列出，`explicit` 必须由用户显式触发，`internal` 只供其他 skill/workflow 调用；router 只推荐路由，不会自动运行 explicit skill。
- 不要为了记录调用模式向 `SKILL.md` frontmatter 添加自定义字段；Codex skill frontmatter 仍只保留 `name` 和 `description`。
- `.skill` 归档或外部 skill 若被引入，应至少保留 `name`、`description`，推荐记录 `version`、`author`、`compatibility`；外部来源不能成为运行时 live dependency，除非任务契约显式允许。

## Run Record

```yaml
run_record:
  enabled: false
  run_id: ""
  schema_path: ".agents/state/run-records.schema.json"
  record_path: ".agents/state/runs/<run_id>.json"
  trace_tags: []
  evidence_refs: []
  privacy:
    secrets_redacted: true
    raw_logs_stored: false
```

规则：

- v2 项目的 coordination DB events 面向默认协作入口；legacy 项目的 `progress.md` 面向人类协作；run record 面向 automation doctor、dashboard 和后续观测工具。
- 默认不接入 LangSmith/Langfuse；若未来接入，只引用 run record 的 ID、标签和证据路径，不上传 secrets 或完整 mailbox 历史。
- 中/高风险、长程、多子代理或需恢复的任务建议开启 run record。

## Stack Profile

> 只有当任务创建、扩展或依赖技术栈、Fullstack Web、数据库或部署选择时才需要填写对应 profile。推荐栈/推荐数据库/推荐平台只是 greenfield fallback，不得覆盖已有项目证据。

```yaml
stack_profile: ""
stack_decision_source: "user | docs | detected | project-overlay | recommended-fallback | blocked"
stack_maturity: "mature | modern | experimental | existing"
stack_evidence: []
default_stack_reason: ""
stack_non_goals:
  - "do not migrate framework unless explicitly requested"
  - "do not rewrite build tooling unless explicitly requested"
```

后端/API 任务补充：

```yaml
backend_profile:
  framework: "existing | elysia | nestjs | hono | blocked"
  runtime: "bun | node | edge | deno | unknown"
  decision_source: "user | docs | detected | project-overlay | recommended-fallback | blocked"
  evidence: []
  architecture_weight: "light | standard | heavy | unknown"
  required_capabilities: []
  required_skills: []
  verification:
    typecheck: ""
    lint: ""
    test: ""
    build: ""
    runtime_smoke: ""
  non_goals:
    - "do not migrate backend framework unless explicitly requested"
```

前端 UI 任务补充：

```yaml
frontend_profile:
  framework: "existing | svelte | vue | alpine | blocked"
  decision_source: "user | docs | detected | project-overlay | recommended-fallback | blocked"
  evidence: []
  ui_complexity: "static | light-interaction | app-workbench | dashboard | unknown"
  required_skills: []
  verification:
    typecheck: ""
    lint: ""
    build: ""
    runtime_or_visual_checks: ""
  non_goals:
    - "do not migrate frontend framework unless explicitly requested"
```

Fullstack Web / SSR / SSG / 路由任务补充：

```yaml
fullstack_profile:
  framework: "existing | sveltekit | nuxt | separated-frontend-backend | blocked"
  render_mode: "static | spa | ssr | hybrid | unknown"
  api_surface: "none | server-routes | separate-api | edge-functions | unknown"
  decision_source: "user | docs | detected | project-overlay | recommended-fallback | blocked"
  evidence: []
  adapter_or_platform: ""
  required_skills: []
  verification:
    typecheck: ""
    lint: ""
    build: ""
    runtime_or_preview: ""
  non_goals:
    - "do not migrate fullstack framework unless explicitly requested"
```

浏览器自动化任务补充：

```yaml
browser_automation_profile:
  mode: "auto | builtin-browser | bun-webview | playwright | chrome-cdp | none"
  intent: "auto | local-preview | light-smoke | ci-e2e | authenticated | cdp-debug"
  task: ""
  selected_mode: ""
  decision_source: "agmesh automation browser-profile --task | agmesh automation browser-profile --intent | user | task-contract | unavailable"
  evidence:
    command: "agmesh automation browser-profile . --task '<task>' --json"
    choice: {}
    task_analysis: {}
    capabilities: []
    fallback_chain: []
  priority_rules:
    - "avoid a browser when direct API/CLI/log evidence is enough"
    - "builtin-browser for Codex-local preview, visible interaction, screenshots, and handoff"
    - "bun-webview for lightweight CLI smoke and simple page-state capture; treat as experimental"
    - "playwright for durable CI/E2E, traces, cross-browser checks, and regression coverage"
    - "chrome-cdp only for real Chrome profile, login state, extensions, or DevTools protocol evidence"
  safety:
    - "do not inspect cookies, passwords, local storage, or browser profiles unless explicitly authorized"
    - "confirm before submitting forms, changing permissions, uploading files, or causing external side effects"
  verification:
    profile_check: "agmesh automation browser-profile . --intent <intent> --json"
    task_profile_check: "agmesh automation browser-profile . --task '<task>' --json"
    runtime_smoke: "agmesh automation browser-profile . --task '<task>' --verify --json"
  non_goals:
    - "do not make Bun.WebView the only browser backend while it remains experimental"
    - "do not use the user's Chrome profile as a default fallback"
```

部署或托管目标任务补充：

```yaml
deployment_profile:
  target: "existing | none | supacloud | svadmin | edgeone-pages | edgeone-functions | cloudflare-pages | cloudflare-workers | cloudflare-pages-functions | blocked"
  decision_source: "user | docs | detected | project-overlay | recommended-fallback | blocked"
  evidence: []
  runtime_kind: "static | edge-function | fullstack | backend | admin-ui | unknown"
  target_region: "global | china-mainland | private-infra | unknown"
  data_residency: "none | public-content | user-data | sensitive | unknown"
  domain_dns_owner: "cloudflare | tencent-edgeone | supacloud-caddy | existing | unknown"
  stateful_services: []
  secrets_strategy: ""
  required_skills: []
  verification:
    build: ""
    local_preview: ""
    deploy_or_dry_run: ""
    runtime_smoke: ""
    rollback: ""
  non_goals:
    - "do not migrate hosting provider unless explicitly requested"
    - "do not introduce a managed platform when a static/no-backend target is sufficient"
```

数据库或持久化任务补充：

```yaml
memory_profile:
  target: "none | sqlite-hybrid | local-file | mem0 | openmemory | tencentdb | blocked"
  decision_source: "user | docs | detected | project-overlay | recommended-fallback | blocked"
  evidence: []
  scope: "global-user | project | task | repo | unknown"
  recall_token_budget: 1200
  save_policy: "stable-facts-only | disabled | provider-managed | unknown"
  secrets_strategy: "none | env-explicit | provider-managed | blocked"
  required_skills: []
  verification:
    status_check: "agmesh memory status ."
    recall_check: "agmesh memory recall '<query>' --token-budget 1200"
    save_check: "agmesh memory save decisions '<compact decision>'"
  non_goals:
    - "do not inject unbounded memory into prompts"
    - "do not require mem0/OpenMemory/TencentDB unless explicitly configured"
    - "do not wire TencentDB/OpenClaw L0-L3 into default core"
    - "do not migrate task ledgers, progress logs, or mailbox history into memory unless explicitly requested"
```

规则：

- 默认 `target: sqlite-hybrid`，使用 `.agents/state/memory/memory.db` 可重建索引；coordination DB v2 项目以 `.agents/state/coordination.db` 为执行事实源，legacy 项目才以 `.agents/state/project-memory.json`、`tasks.md`、`progress.md` 和 `.mailbox/` 为源文件。
- `local-file` 是旧 JSON-only fallback；`mem0` / OpenMemory / TencentDB 是外部 Agent Memory 方案的 opt-in adapter，不是默认 provider。
- TencentDB/OpenClaw L0-L3 自动记忆管线不进入默认 core；只定期审查 upstream release，并手工移植适合 `MemoryProvider` 抽象的去重、召回评分、保留策略等能力。
- 外部 provider 必须记录 secrets 策略、scope 边界和 token budget；不得硬编码 API key。
- `recall` 结果必须受 token budget 限制；记忆召回不能替代读取项目事实源。

```yaml
database_profile:
  target: "none | existing | sqlite | cloudflare-d1 | postgres | blocked"
  decision_source: "user | docs | detected | project-overlay | recommended-fallback | blocked"
  evidence: []
  data_scope: "none | local-single-user | edge-app | multi-user | enterprise | unknown"
  consistency: "local-file | relational | transactional | globally-distributed | unknown"
  access_pattern: "embedded | server-only | edge-binding | direct-tcp | http-api | unknown"
  migration_strategy: ""
  backup_restore: ""
  required_skills: []
  verification:
    schema_check: ""
    migration_check: ""
    integration_test: ""
    runtime_smoke: ""
  non_goals:
    - "do not migrate database unless explicitly requested"
```

生产数据或线上内容写入任务补充：

```yaml
production_data_gate:
  applies: false
  user_confirmed_endpoint: ""
  write_target: "database | storage | api | cms | search-index | other | unknown"
  affected_records: []
  pre_write_snapshot_ref: ""
  write_command_or_change_ref: ""
  live_readback_command: ""
  live_readback_expected: []
  live_readback_evidence_ref: ""
  rollback_command_or_plan: ""
  completion_rule: "do not mark done before live read-back passes against the user-confirmed production endpoint"
```

规则：

- 任何会修改生产数据库、生产对象存储、线上 CMS/KB、搜索索引或外部 API 状态的任务，必须设置 `applies: true`。
- `user_confirmed_endpoint` 必须来自用户、项目配置或现场探测确认；如果发现候选域名冲突，先阻塞或询问，不能沿用旧记忆。
- 写入前必须记录 `pre_write_snapshot_ref`；写入后必须运行 `live_readback_command`，并把输出或文件路径写入 `live_readback_evidence_ref`。
- `live_readback_expected` 至少覆盖被修记录 ID、关键字段、反向断言（例如不再包含旧错误片段）和更新时间/版本信号。
- read-back 未通过或没有证据时，任务只能标 `partial` 或 `blocked`，不能标 `done`、`PASS` 或“已修复”。

桌面应用任务补充：

```yaml
desktop_profile:
  kind: "desktop-app"
  runtime: "desktop-existing | electron | tauri | electrobun | unknown"
  decision_source: "user | docs | detected | project-overlay | recommended-fallback | blocked"
  maturity: "mature | lightweight-security | experimental | existing"
  evidence: []
  target_platforms: []
  distribution: "local | installer | app-store | enterprise | unknown"
  native_capabilities: []
  migration_scope: "none | small | large | blocked"
  required_skills: []
  verification:
    typecheck: ""
    build_targets: []
    runtime_smoke: ""
    package_check: ""
  non_goals:
    - "do not migrate desktop runtime unless explicitly requested"
```

移动端、小程序或 Mpx 任务补充：

```yaml
app_profile:
  kind: "mobile-app | miniapp | mpx-app"
  stack: "mobile-existing | mobile-expo-rn | mobile-capacitor-pwa | mobile-flutter | mobile-native | mini-existing | mini-native | mini-taro | mini-uniapp | mpx-app | unknown"
  decision_source: "user | docs | detected | project-overlay | recommended-fallback | blocked"
  evidence: []
  target_platforms: []
  native_capabilities: []
  migration_scope: "none | small | large | blocked"
  required_skills: []
  verification:
    lint: ""
    typecheck: ""
    build_targets: []
    runtime_or_visual_checks: []
  non_goals:
    - "do not migrate framework unless explicitly requested"
```

Mpx 任务再补充：

```yaml
mpx:
  output_targets: []
  target_detection_evidence: []
  local_docs_checked: []
  preserve_directory_structure: true
  preserve_conditional_compile_style: true
  preserve_style_units: true
  rn_style_compat_required: false
```

## Completion Evidence

> 任务进入 `done` 或 `review` 前必须填写。没有证据只能标 `partial` 或 `blocked`。

```yaml
completion_evidence:
  status: "pending | partial | verified | blocked"
  evidence_items:
    - kind: "test-command | ci-run | git-diff-check | build-log | screenshot | deploy-url | health-check | db-query | log-line | other"
      description: ""
      ref: ""
      fresh: true
  verifier_reviewed: false
  verifier_ref: ""
  orchestrator_confirmed: false
  notes: ""
```

规则：

- `evidence_items` 至少 1 条，`ref` 必须指向本轮执行的证据（命令输出、CI URL、文件路径、截图路径等）。
- `fresh: true` 表示是本轮执行产出；引用旧 PR 或上次运行的证据视为无效。
- 中风险 native 至多使用 1 个独立 verifier；高风险任务必须 `verifier_reviewed: true` 并引用 panel/verifier mailbox evidence。
- orchestrator 亲自运行验收命令确认后可标 `orchestrator_confirmed: true`，作为确定性证据；它不能替代中风险要求的独立 verifier 或高风险 panel evidence。
- 纯文档/格式化任务也必须引用 `git diff --check` 或类型检查/构建通过的证据。

## Required Skills and Conventions

- 相关 skill：
- 项目规则：
- 代码规范：
- 测试约定：

> 不确定相关 skill 时，先参考全局 `references/skills/INDEX.md` 或已安装的 `~/.codex/skills/agent-team/INDEX.md`，再结合项目级 `AGENTS.md` / `GEMINI.md` 补齐。

## Verification Plan

- 类型检查：
- 测试：
- 构建：
- 运行时/截图/接口验证：

## Risk and Rollback

- 风险：
- 回滚：

## Provider Notes

- GitHub/CNB/GitLab/local 的原始任务链接、标签、状态映射或备注。

## Parent and Follow-up

- parent_task_id:
- parent_source_url:
- related_pr_or_mr:
- follow_up_reason:
- why_not_reuse_original_pr:

## Review Escalation

- 若审查不合格，优先回到原 PR/MR 修复
- 只有当原 PR/MR 无法继续或问题已进入主线，才创建新的 follow-up 修复任务
- 新任务必须明确挂到 parent 下，不要作为孤立任务
