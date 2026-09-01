---
description: PR/MR 审查合并 — 基于任务契约审查并合并安全变更
---
// turbo-all

# PR/MR Review and Merge Workflow

## 0. Pre-Execution Gate
- 只处理已经进入 `review` 的 PR/MR
- 先读取 Task Contract，再读取 diff 和 CI 状态
- 若 CI 未完成，先等待或重新检查
- 若 PR/MR 涉及认证、权限、数据迁移、生产配置，默认不自动合并

### 0.1 Simple Merge Fast Path

当用户只要求合并/推送一个已经完成审查的窄范围 PR/MR，且本轮不编写代码、已有 CI 与 review/Task Contract 证据仍然新鲜、没有冲突或高风险边界时，直接走快速路径：

- 先运行 `git rev-parse --show-toplevel`，再确认当前 branch、remote、PR/MR head/base 与目标仓库一致；工作树或 worktree 不匹配时立即停止，不在错误仓库继续编排。
- 复用现有 CI、独立审查和 completion evidence；条件已满足时不得重复派发 verifier，也不得为了“再确认一次”重跑相同模型审查。
- 使用 routine/low reasoning 执行远端状态检查、merge/push 和最终 SHA/任务状态核验；普通简单合并不得升级到 `review-high`、`gpt-5.6-sol` 或 xhigh 推理，除非新发现高风险、证据冲突或不可逆边界。
- 快速路径只省略重复推理，不省略远端真相检查、分支保护、CI 绿灯、权限确认、合并结果与目标分支 SHA 验证。

## 1. Contract-aware Review
- 目标是否逐条满足 Task Contract
- 非目标是否被尊重，是否存在范围膨胀
- 验收标准是否有测试、类型检查、构建或运行证据
- 是否识别并遵守相关 skill、项目代码规范和测试约定
- diff 是否最小且可读
- 风险等级是否准确，是否需要人工确认
- 是否存在回滚困难、兼容性问题或安全风险

## 2. Independent Review Gate
以下情况必须使用独立 verifier/critic 子智能体，或留下等价的独立审查证据：
- `risk: medium/high`
- 审查者也是实现者，或 PR/MR 是当前会话刚完成的工作
- 缺少新鲜测试、构建、类型检查、截图、运行日志等验收证据
- 涉及认证、权限、数据迁移、生产配置、安全、计费或不可逆变更
- diff 范围大、跨多个 subsystem，或回滚路径不明确

若跳过独立审查，必须在 review 摘要中说明原因。若独立审查和主审查结论冲突，先退回或升级，不要自动合并。

模型升级规则：高风险审查、生产/安全/数据/不可逆变更或 reviewer 分歧使用 `review_class: review-high` 进入独立高风险候选链，未显式配置 OpenAI 候选时 fallback 为 `gpt-5.6-sol`；旧任务的 `needs_model: gpt-5.5` 继续兼容。升级时必须写明 `escalation_reason`、触发条件和已有证据；普通 low/medium 审查走 verification/review-loop profile，balanced/pro 默认使用 `glm-5.2` verifier/critic，不继承 executor task `model`。

## 3. Standards and Spec Fidelity Axes

每次审查都分别输出以下两个轴，不能合并、互相遮蔽或用总分重排后丢弃：

- **Standards**：检查项目代码规范、必需 skill、框架/目录/命名/测试约定，以及工具尚未自动拦截的 code smell；单独记录 `verdict`、`findings`、`evidence`。
- **Spec Fidelity**：逐条检查 Task Contract / spec 的目标、非目标和验收标准，识别遗漏、只实现一部分、范围膨胀或实现了错误行为；单独记录 `verdict`、`findings`、`evidence`。

两个轴默认都是 required；只有 Task Contract 在派发审查前用证据说明某一轴确实不适用时，才可将其标为 `N/A`。任一 required 轴 `FAIL` 或缺少证据，整体审查就不能 `PASS`。Standards 通过不能掩盖 Spec Fidelity 失败，Spec Fidelity 通过也不能掩盖 Standards 失败。

## 4. Task-specific Review Focus
- 配置变更：重点查默认值、环境变量、回滚路径和生产兼容性
- API 变更：重点查请求/响应兼容、错误处理和调用方影响
- UI 变更：重点查关键流程、响应式布局和截图证据
- 数据迁移：重点查备份、幂等、回滚和数据完整性
- 文档/规则变更：重点查后续执行者是否能无歧义操作
- 技术栈变更：重点查是否加载对应 skill，并符合项目既有代码风格

## 5. Review Policy
- `risk: low` 且检查全绿：可自动合并
- `risk: medium`：审查通过后可合并，但必须留下审查摘要
- `risk: high`：只评论，不自动合并，等人工确认
- 多个 PR/MR 同时可合并时，按风险从低到高处理
- 审查不合格优先退回到原 PR/MR，要求原作者修复后继续审查
- 只有当原 PR/MR 无法继续，或者问题已经合并入主线，才新增修复任务
- 新增修复任务必须包含 parent / source / reason，避免任务泛滥

## 6. Merge Output
- 合并后更新任务状态为 `done`
- 合并前必须确认 Task Contract 的 `completion_evidence` 至少有 1 条新鲜证据（本轮执行的测试/CI/diff/构建/截图/部署 URL 之一）；纯文档也至少有 `git diff --check` 或类型检查通过的证据
- 没有证据的 PR/MR 一律退回，不允许合并；状态只能标 `partial` 或 `blocked`
- 在 `progress.md` 记录合并结果，并引用证据路径
- 必要时在 `.mailbox/` 广播结果
- 若退回，说明缺失的契约项或验证证据
- 若退回是因为 skill 或代码规范缺失，明确指出应加载的 skill 或应遵循的规范
- 若退回需要派生修复任务，必须在 Task Contract 中引用原 PR/MR 和原任务，并说明为什么不能继续原 PR/MR
- 若审查依赖子智能体，摘要必须引用子智能体 response 或 `.mailbox/` 证据；若缺失证据且任务为中/高风险，应退回补证据或升级，不要直接合并。
