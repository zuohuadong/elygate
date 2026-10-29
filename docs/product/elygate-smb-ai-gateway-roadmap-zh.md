# Elygate 中小企业 AI 网关产品规划

> 文档状态：执行基线 v1.0
>
> 日期：2026-08-30
>
> 目标版本：单机私有化 AI Gateway + 轻量控制面

## 1. 产品定位

Elygate 当前定位收敛为：

> **面向中小企业和研发团队的单机私有化 AI 流量治理与成本控制平台。**

产品由一个 Elygate 网关进程、一个 PostgreSQL 实例和内置管理面组成。首版不以大型集团多级组织、跨区域集群或完整 Agent 平台为目标。

核心价值只有四项：

1. 统一接入企业批准的模型与 MCP 工具。
2. 按项目和应用管理密钥、预算、模型范围与工具范围。
3. 记录请求、成本、策略结果和管理员操作。
4. 使用 Docker Compose 在单台服务器上完成安装、升级、备份和恢复。

## 2. 当前真实状态

以下状态以当前仓库的 API、持久化、权限、测试和页面闭环为依据，不以菜单或文档声明为依据。

| 能力 | 状态 | 当前边界 |
| --- | --- | --- |
| 多供应商统一 API、路由、回退 | Implemented | 已有成熟数据面能力 |
| Virtual Key、预算、限流、模型和 MCP 授权 | Implemented | 延续现有治理模型 |
| Project / Application | Implemented | 已有控制面 API、存储和管理页面 |
| Application 与 Virtual Key 绑定 | Implemented | 支持绑定、过期、撤销；optional 允许未绑定 Key，required 拒绝已解析但未绑定的 Key，disabled 跳过绑定检查 |
| Application Key 生命周期 | Implemented | 支持创建、一次性返回值、显式轮换、显式撤销；Key 变更同步到内存治理状态 |
| 非普通 HTTP 路径绑定校验 | Partial | WebSocket、WebRTC 接入、MCP、OAuth VK 模式和 Async 已接入；已建立 WebRTC 会话已在受支持的下一 turn 入口重校验，媒体流、活动 turn 内动作和全部路径仍未形成统一强保证 |
| Usage Ledger | Partial | 支持投影、筛选查询、全筛选范围汇总和 CSV/API 导出；项目/应用日月预算、持久化阈值告警及控制面板已闭环；预算告警处理已通过本地 SQLite 和双 PostgreSQL 生产运行链路与浏览器验收，输入为合成日志而非真实模型调用；已有历史周期重算、历史分析、管理员已读、告警确认与人工处理/重开，真实外部投递、多用户、预测及生产交付仍未完整 |
| Control Plane Audit | Partial | 控面与员工管理写操作已有事务内审计；上游管理事件已接持久化桥接，补齐 RSS、管理员认证配置、Warp 任务身份及显式会话删除事件；所有敏感操作覆盖、会话生命周期与跨存储原子性仍未完整 |
| 企业身份 | Partial | 本地管理员和员工体系可用；OIDC 后续实现，LDAP/SCIM 暂不做 |
| 统一策略中心 | Partial | 已有 CEL 路由、预算、限流和安全插件，并提供管理员离线路由仿真；仍缺统一版本、发布、回滚和在线 Shadow |
| 模型能力目录 | Partial | 已有模型、价格和扩展属性；区域、数据等级和健康策略未形成闭环 |
| Guardrail / DLP | Partial | 插件基础存在；未证明覆盖所有流式、多模态、文件和工具结果 |
| Capability / Gatekeeper | Not implemented | 保留为后续工具写操作治理，不进入首版阻塞项 |
| Kubernetes / 多节点 HA | Out of scope | 当前产品主线明确不验收 |

结论：**尚未全部实现。** 当前已完成可用的控制面第一条垂直闭环，但不能宣称完整企业治理平台已经交付。

### 2026-10-30 MCP 客户端面板契约增量

- 后续项 `mcp-panel-exposure`：parent 为上游 `248db77d0` 同步提交 `c723fb57e`，source 为 `panel/PARITY.md`，reason 为独立面板尚缺上游 MCP 协议上限、资源和提示词暴露策略的专用工作流。
- 创建和编辑客户端支持协议上限、全部/拒绝/JSON 名单策略，以及最近发现的资源、资源模板和提示词。名单原样保留 URI、模板、逗号和 RE2 字符串，按上游规则拒绝大小写不敏感的重复项；RE2 有效性仍由服务端校验。
- 更新时省略未修改的策略字段，显式清空协议发送 `""`；原生 dialog 内显示校验或保存错误并保留草稿。仅兼容 Bifrost 上游，不增加旧 Elygate 兼容层，不修改后端鉴权或请求数据面。
- 22 项定向测试、面板全量 303 项测试、Svelte 检查及隔离 Vite 生产构建通过；浏览器路由夹具验证回填、非法 JSON 不发请求、更新载荷以及亮暗主题桌面、375px 手机和横屏布局。此为本地 `PASS_SCOPED`，不证明真实外部 MCP 连接、完整生产部署或全产品验收。
- Relay 管理、日志和 Virtual Key relay grants 已补齐独立面板工作流；本地定向契约、Svelte 检查、隔离构建和桌面/手机/横屏亮暗主题夹具已通过。真实上游流量、外部凭据、生产 relay 验收，以及统一策略版本/发布/Shadow/回滚、完整敏感审计原子性和生产恢复验收仍未完成；原总目标保持 active / PARTIAL。

### 2026-10-30 Relay 面板工作流增量

- 新增 Relay 端点 CRUD、全认证方式（含 AWS SigV4）、完整 PUT 编辑、脱敏凭据往返、网络/代理/用量/流式/路由 JSON 编辑与本地用量预览；新增 Relay 日志筛选、分页、聚合统计、趋势、热门端点、详情和选中删除；Virtual Key 新增 relay grants 搜索、添加、移除和显式清空。
- 上游边界保持不变：日志使用 `start_time/end_time` RFC3339 时间窗，代理省略时保留全局继承，grant 未变化时省略、显式清空时发送 `[]`，不增加旧 Elygate 兼容层或请求数据面改动。
- 14 项 Relay helper 契约测试、面板 `svelte-check`（0 错误/0 警告）、隔离 Vite 构建及 Playwright fixture（草稿预览/失败保存保留、日志共享时间窗/详情/部分统计失败、grant 清空、桌面/375px/横屏亮暗布局）通过。既有 API proxy 测试早期超时，单独复跑及最终全量复跑均通过；最终面板 317 pass、0 fail、1738 个断言。
- OpenAPI 导入、图形化路由/用量编辑、完整日志归属/成本筛选和日志导出仍是明确缺口。该增量为本地 `PASS_SCOPED`，不代表真实外部 Relay/凭据、生产部署、完整审计原子性或总目标完成；总目标继续 active / PARTIAL。

### 2026-10-28 Application Key 接入校验增量

- 按 Virtual Key ID 校验与按值校验共用 Store 绑定策略：required 拒绝未绑定 ID，optional 允许未绑定 Key，disabled 不查询绑定存储；撤销和过期仍在启用检查时拒绝。
- 按值校验继续先检查旧值撤销记录；轮换复用 Key ID，新值与有效绑定不应因旧值记录而被误拒绝。未知值仍交由上游治理识别，不能把单独设置 binding required 宣称为强制所有流量携带 Application Key；认证还受 `EnforceAuthOnInference` 和凭据解析约束。
- WebRTC 的 GA 与 legacy SDP 接入共用 relay 校验：先恢复 ephemeral mapping、执行预请求钩子并检查凭据解析，再校验最终 Virtual Key，最后才选择供应商密钥、交换 SDP 和建立 relay。拒绝固定返回 401，不向客户端透传底层存储错误；原生 provider ephemeral token、无 Virtual Key 及未安装 checker 的上游行为不变。
- 此检查按 WebRTC 建连增加持久化访问，不是逐 chunk 开销；没有新增缓存或零分配、吞吐量承诺。新增测试覆盖三模式、双 API、存储失败、无数据库禁用、同 ID 轮换、映射恢复、钩子阶段凭据不可改写及校验顺序、四类真实路由和公开错误边界。
- 最终 SQLite 控面全包、`TestWebRTCRelayChecksResolvedVirtualKeyBeforeSelectingKey` / `TestWebRTCRoutesRejectInactiveVirtualKey` 定向测试、两包 `go vet`、格式及 diff 检查通过。初次预钩子夹具错误地假设可改写保留 VK，修正为核对上游不可改写约束和执行顺序，没有修改生产字段保护。未运行本增量的 PostgreSQL、`-race`、全仓、真实供应商或生产验收；尚未提交、推送或部署。
- 后续项 `application-binding-session-revalidation`：parent 为本接入校验增量，source 为本节及应用密钥撤销验收，reason 为已有 WebRTC 会话尚未逐动作检查绑定。该后续项已在下节以 `PASS_SCOPED` 完成；剩余边界仍保持原总目标 active / PARTIAL。

### 2026-10-28 WebRTC 已建立会话重校验增量

- `WebRTCRealtimeHandler` 将 Virtual Key 值访问检查器传入长期 relay；浏览器 `response.create`、供应商自动 `response.created` 以及转写 `input_audio_buffer.committed` 在没有活动 turn hook 时重新检查冻结的 Virtual Key 值。拒绝发生在输入记录、hook 启动和对应 relay 转发之前，公开错误固定为 401 `authentication_error`，不包含存储错误或密钥值。
- 真实 SQLite 生命周期覆盖有效首轮后撤销 Key、撤销 Application 绑定、绑定过期和同 ID 轮换；旧会话的下一受支持 turn 被拒绝，轮换后的新值在 Store 层仍可用。本地 Pion 双端数据通道覆盖首轮放行、撤销后浏览器错误帧、供应商未收到第二个 `response.create` 以及 relay 注册表排空。
- 最终源码下 handlers 定向回归输出 `ok`，保留二进制覆盖 53 个相关 Realtime/WebRTC 顶层测试，Pion 撤销场景连续 3 次通过；`go vet ./bifrost-http/handlers`、`gofmt` 和 `git diff --check` 通过。测试夹具补齐上游 `LLMPlugin.PreRequestHook`，没有修改生产字段保护。
- 这仍是 `PASS_SCOPED` 增量，不代表 RTP/媒体、非 turn 帧、活动 turn 中途撤销、检查与转发的原子性、真实供应商计费、PostgreSQL、生产部署或全平台验收。原总目标继续保持 active / PARTIAL。

### 2026-10-26 用量账本进展

- 管理面统一使用 `usage-ledger` 入口，不保留重复的旧入口或页面。
- 明细、汇总与 CSV 共享筛选条件和 `[start, end)` 时间窗口；管理面将本地时间转换为 UTC。
- 管理员汇总接口返回全筛选范围的成功、失败、取消请求数、输入/输出/总 Token 和成本，不受明细分页限制。
- 同步、数据库、明细、审计和应用筛选失败会显式呈现；过期请求不会覆盖当前筛选结果。
- 已通过 Control Plane Go 测试、面板 240 项单元测试、Svelte 检查和生产构建。浏览器路由夹具覆盖筛选、导出、失败组合、乱序返回和响应式布局；这不等同于真实后端或 PostgreSQL 端到端验收。
- 通知及历史周期阈值重算的后续进展见下；所有敏感管理员操作审计、完整 PostgreSQL 集成及单机部署备份恢复验收仍未完成。

### 2026-10-27 PostgreSQL 恢复验收增量

- 新增独立本地恢复验收：通过真实 `pg_dump`/`pg_restore`，将所选客户端配置、项目/应用预算、带过期时间的可用/已撤销 Key、绑定、合成用量投影、checkpoint 与管理员审计恢复到另一个新建数据库。
- 恢复后使用生产 configstore/controlplane 重新打开并对账；Key 只比较摘要，不输出原值。继续创建带预算的项目，检查恢复后的写入及序列分配；源库在备份后更新的配置不应被恢复操作改变。
- 冲突用例使用本轮新建库中的哨兵表，要求单事务恢复失败后不留下部分应用表，也不覆盖哨兵。不使用 `--clean` 或 `--create`，不连接现有或生产数据库。
- runner 已补充 `pg_dump`/`pg_restore` 前置检查，缺工具时在启动实例前失败；两个缺工具场景及 shell 语法检查已通过。数据库归档位于权限 0600 的测试临时文件，测试结束自动清理，不进入持久证据。
- 最终 PostgreSQL `-race` 专项通过 2 项顶层测试及 2 个恢复子场景，无失败、跳过或竞态报告；测试库清理检查及私有实例正常停机通过。同一 race 二进制的默认 SQLite 迁移回归通过，PostgreSQL 专用恢复测试明确跳过；归档清理、最终控面 vet、Go 格式及 diff 检查通过。
- 收尾检查修正了合成日志早于 Key 绑定生效的夹具错误，保留归属断言并明确核对请求数、Token、金额和 checkpoint；不改变生产账本规则。该局部验收为 `PASS_SCOPED`，未运行全仓套件，未提交、推送或部署。
- 此为控面数据库的本地验收，不证明独立原始日志库、文件/对象存储、部署配置、外部加密/签名材料、备份点后变更或整机生产恢复；Phase D 和原总目标继续 active / PARTIAL。

### 2026-10-27 用量账本维度筛选增量

- 明细、全筛选汇总与 CSV 增加 `user_id`、`provider`、`model` 精确条件，可与项目、应用、时间和会话条件取交集。不 trim、不折叠大小写、不解释通配符或 SQL；空值不限制该维度，无用户归属记录默认保留。
- CSV 补充用户 ID，并从零偏移导出，不受明细分页限制；保留现有 100,000 行上限，超过上限不代表完整导出。文本列对公式前缀及前导空白/BOM 加单引号，数字成本包括负向修正保持数字。
- 独立 `panel/` 补齐三项筛选和用户列；应用/Enter、翻页、刷新及导出保留维度，重置清除维度与页码，在途编辑不会显示旧明细或汇总。预算状态、历史及告警仍只按项目/应用限定，不因明细维度缩小。
- HTTP 红灯的 14 个叶场景均因缺少筛选、用户导出列或导出保留偏移而失败；面板红灯因缺少用户筛选状态失败。最终面板 270 项测试通过，Svelte 零错误/警告，独立生产构建通过，保留既有 chunk 体积提示。
- 浏览器 API 夹具通过 19 项检查，覆盖精确身份、特殊字符、共享条件、分页/导出、三个维度的旧响应拒绝、失败独立显示、键盘、375px、暗色、横屏与英文 Enter。首轮夹具将既有切语言重挂载误当作应持久化，修正验收范围后重跑通过，没有改动 App 生命周期。截图已视觉检查；这不是实际后端或模型端到端验收。
- SQLite 全控面 `-race` 通过 106 项顶层测试，隔离 PostgreSQL 聚焦 `-race` 通过 11 项，两边均含新增 14 个筛选叶场景，无失败、跳过或竞态报告；控面 vet、格式与 diff 检查通过，独立审查为 `PASS_SCOPED`。私有 PostgreSQL runner 的测试库泄漏检查及正常停机均通过，不访问现有数据库。
- provider-harness 场景/夹具仍待确认，已有独立草案而未修改集合或执行付费调用。统一策略、外部 Webhook、完整敏感审计与原子性、生产备份恢复等继续未完成；总目标保持 active / PARTIAL，本增量尚未提交、推送或部署。

### 2026-10-27 控面预算增量

- 控面包已可通过独立 PostgreSQL 测试 runner 执行迁移、Key 生命周期、账本和审计契约；这不等同于真实模型调用或生产部署验收。
- 项目与应用支持 USD 日/月告警预算的创建、完整替换与清除；更新与管理员审计处于同一事务。
- 按 UTC 自然日/月及 `[start, end)` 汇总账本，后台无需打开面板即可对账，并在 80%/100% 阈值写入持久化去重事件。
- 日志源缺失或同步失败时不触发告警；未配置预算时不因监控额外扫描日志。
- 此增量不替代 Bifrost 现有预算拦截。面板配置与告警展示已在 `panel/` 闭环，并通过 245 项面板测试、Svelte 检查、生产构建及 Playwright 交互验证；通知与已关闭周期重算的后续进展见下，预测、敏感操作完整审计、策略治理及单机生产交付继续保持未完成。

### 2026-10-27 管理员审计桥接增量

- 上游管理 handler 的 `RecordAuditChange` 原本只停留在请求上下文；现在由控面中间件同步持久化紧凑的操作者、事件和资源身份。
- 不落盘请求体、名称或变更快照；缓存 key 使用 SHA-256；Basic 身份只在密码校验成功后写入审计专用标记，不改变授权。
- 一个请求内的审计批次原子写入；后续 reload 错误或 panic 不丢弃已录制的变更。持久化失败保留已提交的一次性凭据响应，并通过响应头和错误日志暴露。
- 补齐 RSS 源创建、修改、删除与全局开关的事件生产；审计覆盖矩阵及剩余边界见 `management-audit-coverage.md`。
- 这不是所有 mutation 与审计的事务原子化：进程崩溃窗口、员工管理独立 appender 的失败处理、未盘点路由及生产验收仍未完成。

### 2026-10-27 管理员认证配置审计增量

- `PUT /api/config` 的实际认证配置保存成功后，单独产生 `auth_config.updated`，资源固定为 `auth_config/dashboard`；启用、禁用、凭据修改和保留原凭据的实际保存均记录。
- 事件在清理会话之前录制，因此保存成功、后续会话清理失败而返回 500 时仍保留审计；省略认证字段、没有实际保存、校验拒绝或保存失败时不产生认证配置事件。
- 快照仅白名单保留启用状态和用户名/密码是否配置三个布尔值，不含用户名、密码、hash、secret 引用或 setup/current password。持久化桥接仍只存身份和事件索引，不存快照。
- 新增聚焦 handler、脱敏边界和真实认证管理路由/服务端回调/审计桥接的回归，覆盖数据库重新打开后的审计持久性；不改变原认证规则或上游 API 合约。
- 聚焦竞态验证中 handlers、controlplane 通过；server 首轮因测试夹具的缺省配置触发无关插件重载而失败，修正为提交完整未变更配置后，五个真实路由场景及最终 server vet 通过。相关格式与 diff 检查通过，不代表全仓或生产验收。
- 这不是认证配置与审计的事务原子化。提交后进程崩溃窗口、批量会话失效等剩余生命周期、其余敏感路由和生产备份恢复仍未完成；登录/显式登出的新进展见下，原总目标保持 active / PARTIAL。

### 2026-10-27 管理员登录与登出事务审计

- 仅向 SessionHandler 注入控面 ConfigStore 包装，登录密码校验、公开登出、Cookie 与响应结构维持 Bifrost 合约。共享 DB-bound 会话函数保留上游 hash 查询、明文 fallback 和加密 hook，不修改 ConfigStore 接口或 mocks。
- 会话创建/删除与 `dashboard_session.created/deleted` 在同一事务提交，审计失败会回滚会话；SQLite 读前取得写锁，PostgreSQL 锁定匹配行，并发登出只追加一次删除事件。
- 资源仅存加密前计算的 token SHA-256 摘要，不存 token、密文、用户名、密码或请求快照。创建和有效会话删除固定为 `local-admin`，过期会话删除为匿名；空、未知、重复或密文 token 不产生事件，写入错误的公开文本不含数据库诊断。
- 初次路由夹具未初始化 fasthttp context，触发 panic 后清理等待并超时；修正为标准 RequestCtx.Init，没有修改生产鉴权、引入 nil 绕过或删减断言。最终验证覆盖真实注册登录/Cookie 登出、失效后的 401、Basic 审计 feed、五类失败回滚、加密/明文查询及数据库关闭重开。
- 同一保留 race 二进制用于 SQLite 与隔离 PostgreSQL 聚焦验证；结果及源码校验清单保留在 `.codex-tmp/dashboard-session-*`。独立源码复核及框架会话加密回归、server race、控面/框架/server vet 已通过；不代表全仓或生产验收。
- Apple M4 上的 race-instrumented SQLite 生命周期微基准，每次创建加删除，原始路径 262,047–271,831 ns/op、296–297 allocs/op；审计路径 599,317–652,740 ns/op、595–597 allocs/op，均为三次各 30 次迭代。迁移、密码哈希、加密和 HTTP 不在计时内；这些数字不代表 HTTP 端到端、推理开销或生产 SLA。没有新增内存缓存，审计使用既有持久表。
- 批量 FlushSessions、失败登录、setup/WS ticket、员工会话、其余敏感路由原子性和生产验收继续未完成；provider-harness 场景草案待确认，未修改集合或执行付费调用。总目标仍为 active / PARTIAL，没有提交、推送或部署。

### 2026-10-27 员工自助改密事务审计

- 原流程先更新密码，再撤销其他会话，删除失败时会留下部分成功状态。现在密码更新、其他现存员工会话撤销和 `employee.password_changed` 在同一事务提交；写入或审计失败时回滚，成功保留当前会话。
- 当前密码仍按既有规则校验；事务内通过已验证 hash 与启用状态的条件更新取得写锁，再锁定并复核保留会话的员工归属、token 摘要与有效期，拒绝被并发重置、停用或改密淘汰的状态。限流回调在每次获准尝试结束时恰好调用一次，仅完整提交算成功。
- 独立 self-service appender 仅接收会话认证后的员工 ID；紧凑与签名审计均使用 `employee:<id>`，不信任请求中的管理员标记、Header 或 JSON 身份，不授予管理员权限，也不保存密码、hash、Cookie、CSRF 或凭据快照。缺少审计接线时拒绝提交。
- 修复前两个回归分别因密码已提交、限流回调遗漏而失败。最终同一 race 二进制的 SQLite 员工包通过 26 项顶层测试、38 个子场景；PostgreSQL 专项通过 6 项真实 PostgreSQL 顶层测试及 19 个子场景，另执行 1 项 SQLite 专用关闭重开测试，无失败、跳过或竞态。服务端紧凑/签名审计身份及事务回滚 race、员工/server vet、独立源码复核、格式和 diff 检查通过；私有 PostgreSQL 测试库清理及实例停机已确认。
- 提交失败覆盖审计 INSERT 成功后取消标准 context、回调返回 nil 的实际 Commit 拒绝，以及 SQLite 关闭重开后的回滚和成功持久性；这不证明数据库提交确认丢失必然回滚，该结果仍可能不确定。
- Apple M4、race-instrumented SQLite 微基准含新密码 bcrypt，每组 3 次迭代、重复 3 组：原分步写入复现为 492,368,014–495,514,194 ns/op、197–198 allocs/op；新事务加测试审计表为 497,281,667–511,046,417 ns/op、364–366 allocs/op。不含 HTTP、当前密码验证、迁移/夹具或真实生产签名审计，不代表生产 SLA 或推理路径开销；未新增内存缓存。
- 员工登录/登出审计、旧密码验证与后续会话签发之间的并发竞态、剩余敏感操作、统一策略和生产验收继续未完成；provider-harness 场景草案待夹具批准，未修改集合或运行付费调用。总目标保持 active / PARTIAL，没有提交、推送或部署。

### 2026-10-27 员工登录与显式登出事务闭环

- 登录现在通过已验证 hash 与启用状态先取得员工写锁，再读取锁定期限并以 Go 时间类型判断真实时间点；成功登录元数据、会话和 `employee_session.created` 一起提交。改密、重置与停用先取得同一员工锁，两种锁顺序均已验证会拒绝旧凭据或撤销已签发会话。显式登出按员工、会话锁序与 `employee_session.deleted` 同事务提交，重复的已认证快照不追加事件。
- 凭据 Cookie 只在完整提交后签发或清除；认证读失败不再伪装过期并清除恢复 Cookie。审计仅使用可信员工身份及内部固定 `employee-password` / `employee-session` 认证方式，资源为随机会话 UUID，无凭据快照或管理员授权副作用。
- 三条修复前回归已确认失败。包含下述改密时区修复的最终同一员工 race 二进制通过 SQLite 全包 37 项顶层测试、103 个子场景；PostgreSQL 密码/会话矩阵通过 18 项真实 PostgreSQL 顶层测试、82 个子场景，另有 5 项 SQLite 专用顶层测试、12 个子场景，无失败、跳过或竞态。server 员工审计 race 通过 3 项顶层测试、16 个子场景，聚焦 vet、格式、diff、源码校验及独立复核通过。
- 早期完整上游 schema 初始化和测试库清理曾在外置卷 I/O 竞争下超时，旧失败/中止日志保留，不计为通过。最终私有 PostgreSQL 测试库清理和停机确认完成；为 SQL/锁语义测试关闭的 fsync 等设置不构成生产崩溃持久性或备份恢复验收。源码、二进制及结果入口为 `.codex-tmp/employee-session-results-20261027.json`。
- race-instrumented SQLite 基准每组 3 次迭代、重复 3 组：旧分离写入生命周期为 0.459–0.702 ms/op，新事务加测试审计为 0.916–0.937 ms/op；旧登出为 0.100–0.111 ms/op，新事务审计为 0.346–0.385 ms/op；含 bcrypt 的完整登录请求为 544.9–553.7 ms/op。使用相同登录/登出生产实现，测量不含生产签名审计、迁移、外部供应商或推理路径，不代表生产 SLA。
- provider-harness 草案另存于 `.codex-tmp/employee-session-harness-design-20261027.md`，仅提案，集合与付费供应商未运行。失败登录审计、自动过期清理、批量逐会话事件、完整管理认证链、其他敏感操作、统一策略和生产验收仍未完成；总目标保持 active / PARTIAL，本增量没有提交、推送或部署。

### 2026-10-27 员工改密保留会话时区修复

- 独立复核发现改密仍以 SQL `expires_at > now` 判断保留会话，SQLite 不同 UTC offset 的文本排序可能拒绝有效会话或接受过期会话。固定真实 SQLite 夹具分别复现了这两种相反错误，不修改全局时区。
- 现在保持原员工、会话锁序，在同一事务内先按员工与 token 摘要锁定会话，再用已解码的 Go 时间判断有效期；过期时在撤销其他会话或追加审计前整体回滚。HTTP 合约、身份边界、限流与其他会话撤销行为不变。
- 补充未来和过期的本地、UTC、+14、-12 offset 回归。当前源码已纳入上节同一 SQLite/PostgreSQL race 矩阵、server 审计、vet 和独立源码复核；仅本地限定范围验收通过，不扩大为完整产品或生产验收。

### 2026-10-27 Warp 后台任务审计身份修复

- 共享启动/取消 handler 原先把主题聚类错记为回填任务。任务规格现在显式提供审计类型：主题产生 `warp_topics.started/cancelled`，回填保留 `warp_backfill.started/cancelled`；资源类型同步区分。
- 只在实际入队或取消成功后记录；拒绝、非法输入、依赖不可用、查找/写入失败、冲突、未知/异类任务、终态和重复取消不虚报变更。提交后响应重读失败仍保留正确事件。
- 新增注册路由回归及真实 Basic 认证、审计列表读取和 SQLite 重开测试；任务调度存储使用测试夹具，不宣称真实任务执行或生产端到端已验收。修复前五个主题场景均因事件类型错误失败；最终 `-race` 通过 50 项 Warp 顶层测试，其中新增 60 个叶场景通过，无失败、跳过或竞态报告；handlers vet、格式及 diff 检查通过。
- 三轮本地微基准中，原固定事件名为 824–861 ns/op、849 B/op、20 allocs/op；按任务规格派生名称为 864–869 ns/op、873 B/op、21 allocs/op。额外 24 B 和一次分配仅发生于管理员任务审计，不经过模型推理热路径；此为事件录制微基准，不是完整 HTTP 延迟或生产性能证明。
- 不改变授权、任务调度、上游响应或快照结构，不引入旧 Elygate 兼容层。provider-harness 管理审计用例尚待场景/夹具确认并补入；会话删除审计、审计原子化及生产恢复继续未完成，原总目标保持 active / PARTIAL。本轮未提交、推送或部署。

### 2026-10-27 Warp 会话删除审计增量

- 显式删除会话成功后产生 `warp_conversation.deleted`，资源类型 `warp_conversation`。快照只保留会话 ID，不读取或复制标题、消息、工具参数、澄清问题、模型错误或归属 ID；持久化桥接仍只存紧凑身份索引。
- 沿用上游存储层的归属与不存在校验，不新增预读或删除。不属于当前用户、找不到、重复删除、ID 缺失、存储不可用或失败均不产生成功事件；上游响应与错误语义不变。
- 增加个人/共享/不透明用户 ID、伪造归属字段、读操作、关闭 Warp、真实 Basic 认证及共享归属的注册路由回归。认证关闭时可以按原规则删除共享会话，但审计列表仍必须返回 403；匿名事件只能由有权限的管理读取边界查询。
- 增加真实 SQLite 会话/消息删除、审计数据库重开及审计写入失败仍保留已提交 204 和失败响应头的检查。红灯中三个成功删除场景因缺少事件失败，七个拒绝或失败场景通过；最终 `-race` 通过 53 项 Warp 顶层测试，含会话新增 14 个叶场景，无失败、跳过或竞态报告，handlers vet 通过。
- 三轮事件录制微基准为 361.9 / 393.4 / 378.2 ns/op、576 B/op、9 allocs/op，仅发生于显式成功删除的审计记录，不新增会话读取或模型请求；不是完整 HTTP、数据库写入或生产性能证明。当前生产 diff 仅新增既有审计库 import 和成功分支调用，格式、diff 与 clean-code-guard 检查通过。
- 会话和审计分属 log store 与 config store，并非一个事务。提交后崩溃、会话创建/聊天与自动清理、provider-harness 管理场景、真实 PostgreSQL/ClickHouse 和生产恢复验收仍未完成。原总目标保持 active / PARTIAL，本轮未提交、推送或部署。

### 2026-10-27 员工管理事务审计增量

- 员工创建、批量导入、更新/停用、批次回滚和管理员重置密码在各自数据库事务内追加审计，审计失败则回滚员工、密钥绑定、批次、密码和会话变更。
- 未启用加密时写控面紧凑审计；启用加密时写治理签名链，由控面统一读取，每次变更只生成一种表示。管理 handler 缺失 appender 接线时拒绝提交。
- 员工更新先锁定并读取旧状态；导入/回滚重放不再重复写审计，审计快照不含密码、密码 hash 或虚拟密钥值。
- 此增量关闭上一节列出的员工管理独立 appender 失败处理缺口；员工自助与登录生命周期、其他上游管理 mutation 的原子化、通知投递、策略治理、PostgreSQL 并发及生产验收仍保持未完成。

### 2026-10-27 预算通知 outbox 增量

- 阈值告警与通知 outbox 在同一事务内写入；加法 v6 迁移按批补入已有告警，保留首次观察到的金额与周期。
- 后台定量领取、令牌校验、租约过期恢复和指数退避；日志源不可用或预算已清除时，已提交的通知仍可继续投递。
- 通知服务用稳定 UUID 幂等写入；通知已落库而确认失败后的重放不会新增第二条 feed 记录或改写原始内容及有效期。
- 稳定 ID 通知过期后仍保留数据库去重凭据，feed 继续隐藏过期记录；超过 30 天后恢复的 outbox 也不会重新广播旧通知。普通通知仍按期清理。
- 新通知仅向管理员广播，并可通过现有通知 feed 恢复读取；普通角色不可见。WebSocket 为尽力推送，不代表浏览器已收到、已读或已确认。
- 独立 `panel/` 的通知入口已在后续增量中完成前端验收，历史周期重算后端进展见下；外部预算 Webhook、用户确认、预测及生产投递验收仍未完成。此增量不是完整通知功能交付，不改变原总目标。

### 2026-10-27 独立面板通知增量

- 通过共享页头组件入口读取服务端授权的通知 feed，按游标加载历史、去重并保留服务端顺序；空页仍可继续翻页，显式刷新替换历史及游标。
- 轮询跳过隐藏页面、进行中的请求及打开的历史视图；失败或畸形响应显示错误，不清空已有记录和游标。
- 动作链接只允许内部路径，并把上游 `/workspace/...` 映射到面板 hash 路由；徽标仅代表已加载条数，不伪装成未读数。
- 使用原生顶层 popover，页头尺寸变化后重新定位；Escape 在分页控件移除导致焦点落到页面外时仍能关闭并返回触发按钮，卸载时中止请求并清理监听和轮询。
- 以锁定依赖 core 0.62.0、ui 0.88.1、Svelte 5.57.2、Vite 8.3.5 验证：255 项面板测试通过，Svelte 检查零错误零警告，前端生产构建通过，19 项浏览器夹具检查及桌面/手机/深色截图验收通过。
- 浏览器使用隔离 API 夹具，不代表真实预算事件到浏览器的端到端投递验收；预算后端 Go 检查及历史周期重算进展见后续章节，已读/确认持久化、外部 Webhook、预测和生产交付仍保持未完成。本增量未改写 Go 静态嵌入 UI，也未提交或推送。

### 2026-10-27 预算通知后端验收

- 补齐 transports 模块缺失的依赖校验和，并登记上游 framework 已使用的 Azure Blob 间接依赖；未升级依赖版本。
- 通知存储及 SQLite 预算检查已通过；私有 PostgreSQL 上的 7 项预算通知测试通过，覆盖事务原子性、稳定 ID 幂等、失败重试、重启恢复、发布后确认前崩溃、并发领取与旧令牌拒绝、分批迁移及重试边界。
- PostgreSQL 检查使用 `-mod=readonly`、每测试独立数据库和仅本地的私有 Unix socket；runner 已完成数据库清理并正常停止实例，没有访问生产数据。
- configstore、controlplane、handlers、server 四个包的通知/预算聚焦测试在 `-mod=readonly` 下复验通过，同范围 `go vet`、相关 Go 文件格式和 diff 空白检查通过；HTTP/WebSocket 授权覆盖管理员隔离及 ticket、token、cookie 会话入口，模块文件校验值未变化。
- 未执行完整测试套件或 `-race`；这不是完整 PostgreSQL 集成、真实浏览器端到端投递或生产备份恢复验收。本轮未提交、推送或部署，原总目标及其他未完成功能保持不变。

### 2026-10-27 历史预算周期重算增量

- 项目/应用预算创建、完整替换及清空持久化策略版本，与资源变更及适用的管理员审计同事务提交；使用 UTC 微秒时间及递增 ID 排序。
- 当前周期沿用当前额度；已关闭周期使用严格早于周期结束的最后版本。先选版本再判断额度是否为空，周期内清空不会回退旧额度，关闭后清空不会抹掉旧规则。
- 账本新增、金额纠正、跨日跨月时间纠正和完整快照删除同事务标记原/新项目与应用日/月周期；纠正不会重新归属请求。未关闭周期保留至关闭，重启后继续，每轮最多消费 64 个已关闭周期。
- 重算、告警、通知 outbox 和队列消费同事务；既有告警及原通知载荷不改写、不撤回，只有新越过的阈值生成事件。
- 全部当前预算清空后，只要历史曾有非空额度，仍同步源发现迟到结算；从未配置非空预算则不额外扫描。定量限制仅针对周期评估，不代表日志全量对账也被分批。
- 加法 v7 迁移只记录迁移时已知规则，不推测更早的预算；回滚拒绝删除历史和待处理任务，旧二进制可忽略加法表。
- 新增 13 项历史重算测试；最终源码的 SQLite 控面全包测试通过，私有 PostgreSQL 上全部 34 项预算相关测试通过（含新增 13 项），覆盖空版本与期末边界、原/新周期、两类删除、事务回滚、重启、并发、定量积压、清空后迟到结算和迁移。PostgreSQL 每测试使用独立数据库，清理检查通过并正常停止实例。
- 同范围 `go vet -mod=readonly -p 1`、格式及当前 diff 空白检查通过；复用既有只读复核者返回 `PASS_SCOPED`。模块文件校验值未变化，未运行全仓套件、`-race` 或生产迁移。
- 此增量不增加历史分析 API/界面，不替代上游预算拦截，也不关闭外部 Webhook、用户确认、预测、真实事件到浏览器投递及生产备份恢复验收。原总目标保持未完成，未提交、推送或部署。

### 2026-10-27 本地预算通知运行验收与手机布局修复

- 使用真实生产 `Bootstrap/Start`、隔离 SQLite、管理员认证和当前面板生产构建；通过实际 API 创建项目、应用和 Key，仅向官方 `LogStore.Create` 写入两条合成用量。不调用付费模型，不伪造 API，不直接创建通知，也不缩短监控周期。
- 未打开预算页面时，后台监控独立生成项目/应用的 80% 与 100% 告警；通知落库、一次性 ticket WebSocket 广播和面板轮询/手动刷新中的 ID 一致。匿名读取返回 401，通知动作可进入真实项目预算页。
- 服务重启后额外等待 65 秒，原通知 ID 不变；两轮生产实例均正常退出。停服后只读 SQL 对账为 4 条告警、4 条已投递 outbox、4 条通知、0 次重试，2 条用量合计 USD 1.15。
- 实际退出过程暴露 HTTP 工厂清理死锁：持读锁关闭 live facade 会重入工厂锁。修复为锁内快照已实例化的 inner client，解锁后关闭空闲连接；不修改请求路径或实例化新客户端。完整 network 包检查及四项聚焦竞态回归通过。
- 修复桌面切到手机时侧栏占位动画挤压页头的问题；375/390/767px 首帧正文铺满视口，页头按钮不重叠，手机导航与桌面侧栏开关通过真实后端回放。面板 256 项测试、Svelte 检查与生产构建通过，19 项浏览器夹具复验覆盖深色、横屏和键盘行为。
- 本地回放结果为 `PASS_SCOPED`，不代表真实模型计费、PostgreSQL 到浏览器全链路或生产迁移、备份恢复已验收。历史分析 API/界面、外部预算 Webhook、已读/确认持久化、预测、统一策略及完整审计仍未完成。原总目标保持 active / PARTIAL；本增量未提交、推送或部署。

### 2026-10-27 历史预算分析增量

- 新增管理员历史分析接口及独立面板表格，支持 UTC 已关闭日/月周期、项目/应用交集筛选、范围校验及 SQL 分页；默认最近 30 日或 12 月，最多 366 日或 60 月。
- 每周期先选期末前最后策略版本再判断空额度，保留零用量周期；使用当前已对账金额及资源当前名称，不重复相加项目与应用成本，不改写既有告警与通知。计数、分页及金额在同一投影锁事务内读取。
- HTTP 拒绝非法、空、重复、溢出及显式零时间参数；面板区分加载、失败、畸形响应及空结果，支持独立日/月范围、分页、刷新、过期响应拒绝和卸载取消。
- 面板 262 项测试通过，Svelte 检查零错误零警告，隔离目录生产构建通过；23 项浏览器夹具检查及桌面/手机/深色截图核验通过。真实主题按钮切换后等待画面稳定，抽测深色文字对比度最低约 5.67:1；浏览器使用 API 夹具，不代表真实后端端到端验收。
- 最终源码的私有 PostgreSQL 8 项历史分析测试通过，含计数/分页/金额与对账互斥回归；测试数据库清理及实例停机检查通过。控面 `go vet`、Go 格式及 diff 空白检查通过。首次最终 SQLite 普通复验与竞态检查因构建/缓存等待停止，未作为通过证据；后续完整复验结果见下。
- 代表性本机夹具为 300 个范围、366 个日周期、300 个策略版本和 30,000 条账本；100 行查询约 SQLite 55ms、PostgreSQL 214ms，仅是本地样本，不是生产 SLA。分页上限不限制全部候选计数或源对账成本。
- 外部预算 Webhook、已读/确认持久化、预测、统一策略、完整审计及生产迁移、备份恢复仍未完成。原总目标保持 active / PARTIAL；未提交、推送或部署，也未覆盖 Go 静态嵌入 UI。

### 2026-10-27 历史分析最终 SQLite 与竞态复验

- 当前源码重新执行历史分析 `go test`，8 项通过；构建追踪确认此前长时间消耗发生在缓存物化及链接，不是用例超时。测试执行耗时 4.851 秒，不包含构建时间。
- 复用同轮最终源码构建保留的普通及竞态二进制，分别通过历史分析 8 项及控面整包 87 项测试，无跳过、无数据竞争报告；构建元数据确认竞态产物为 `-race=true`。新构建与复用普通产物的测试包缓存身份一致，源码与产物校验值已记录。
- 此复验关闭上一增量的最终 SQLite/竞态验证缺口，但仅覆盖本地 SQLite 控面包，不代表全仓套件、PostgreSQL 竞态、真实后端历史界面端到端或生产备份恢复验收。原总目标保持 active / PARTIAL，未提交、推送或部署。

### 2026-10-27 管理员通知已读持久化

- 独立控面 v8 回执表与 GET/PUT 接口，不改上游通知 feed 或共享 schema；当前单一本地管理员账号的 Basic 认证及不同登录会话共用状态，不宣称企业多用户隔离。
- 通知存活校验、回执与审计同事务；重复已读保留首次时间，不重复审计；标为未读删除回执。外键级联删除和后台过期清理独立于用量日志可用性，二进制回退不丢弃回执表。
- 面板显式切换已读/未读，角标仅计已加载未读；加载失败或写入结果不确定时显示未知并等待刷新确认，保存期间拒绝重复写入及刷新、翻页、轮询覆盖，键盘焦点保持。
- 当前源码 SQLite 控面整包 94 项通过；私有 PostgreSQL 7 项回执测试在 `-race` 下通过，无跳过、无竞态报告，测试库清理及实例停机检查通过；现有认证聚焦测试、控面与 handlers 的 `go vet`、相关 Go 格式及 diff 空白检查通过，未运行生产迁移。
- 最终面板 264 项测试、Svelte 检查及独立目录生产构建通过；17 项浏览器夹具检查覆盖未知态、已提交但响应无效、恢复刷新、交互互斥、键盘及手机/暗色/横屏，截图已核验。浏览器夹具与真实 Go 数据库/认证测试分别验证，不冒充真实后端端到端验收。
- 此增量关闭本地管理员通知已读持久化缺口，但已读不代表告警确认或处理。外部预算 Webhook、告警确认/处理、多用户身份、预测、统一策略、完整审计及生产迁移、备份恢复仍未完整。原总目标保持 active / PARTIAL，未提交、推送或部署，未覆盖 Go 静态嵌入 UI。

### 2026-10-27 预算告警确认

- 自有 v9 确认表与管理员 PUT 接口支持显式确认、撤销；GET 告警列表通过单查询关联确认状态，明确返回布尔值及可空时间、确认人，不增加旧 Elygate 兼容分支。
- 告警行写锁串行化状态变化，确认与审计同事务；同状态重试保留首次 UTC 微秒时间且不重复审计；告警外键级联删除并拒绝空 ID 和孤儿记录，禁止丢弃确认数据的破坏性迁移回退。
- 当前本地管理员账号在 Basic 及登录会话间共用服务端固定确认人。确认不改变预算超额状态、上游拦截、原始告警与通知 outbox，也不等于已读或告警已处理。
- 面板支持确认、撤销、时间及确认人显示；保存结果不确定时转为未知且禁止继续切换，刷新后恢复。保存与刷新、翻页互斥，键盘焦点保持；在途写入独立于视图，范围切换和卸载后重新挂载的读取等待写入结束，避免展示提交前旧快照。
- 最终源码构建的保留竞态二进制通过 SQLite 控面整包 103 项与私有 PostgreSQL 确认专项 9 项测试，无失败、跳过或竞态报告；源码及二进制校验和已复核。PostgreSQL 测试库全部清理，实例正常停止；控面 vet、格式及 diff 空白检查通过。
- 面板 268 项测试、Svelte 检查与独立生产构建通过；26 项浏览器夹具检查覆盖不确定状态、范围切换、卸载重挂载、分页及键盘、手机、暗色与英文。真实后端到浏览器的后续验收见下，不用夹具结果替代。
- 本增量仅覆盖本地管理员告警确认，不覆盖告警处理闭环、外部 Webhook、多用户、预测、统一策略、完整审计及生产迁移、备份恢复。原总目标保持 active / PARTIAL，未提交、推送或部署，未覆盖 Go 静态嵌入 UI。

### 2026-10-27 预算确认真实链路与面板代理修复

- 实际 Vite 转发测试复现 `changeOrigin: true` 将浏览器 Host 改为后端 Host、却保留浏览器 Origin 的问题，合法控制面写入因此不满足现有同源校验。改为保留 Host；不放宽后端认证或 Origin 校验，也不信任客户端转发头。回归覆盖 POST、PUT、DELETE 及同源、外来 Origin。
- 当前源码重新构建的生产 Bootstrap/Start 在隔离 SQLite 与随机管理员凭据下完成真实登录、浏览器项目/应用写入及官方日志存储合成用量写入。后台监控独立产生项目/应用的四条阈值告警，不依赖预算页面读取，也不调用通知创建接口。
- 真实面板键盘确认、撤销、刷新和重新加载通过；Basic 重试与会话共用服务端确认人，保留确认时间且不重复审计。实际提交后丢弃网络响应时，界面转未知，刷新后恢复真实状态。匿名确认返回 401，带认证的外来 Origin 写入仍返回 403。
- 重启同一存储并再等待一个监控周期后，会话、确认和精确审计数保持不变。所有验证实例、浏览器和验证代理正常退出；停止后只读核对告警 4、确认 1、状态转换审计 3、通知已读回执 0、已投递 outbox 4、通知 4。真实桌面与 375px 手机截图已检查。
- 面板最终 269 项测试、Svelte 检查（0 错误、0 警告）及独立生产构建通过；复用独立只读复核返回 `PASS_SCOPED`。本地链路结果同为 `PASS_SCOPED`，不代表真实模型计费、PostgreSQL 到浏览器链路或生产迁移、备份恢复验收。
- 原总目标保持 active / PARTIAL，告警处理闭环、外部 Webhook、多用户、预测、统一策略和完整审计仍待完成。本轮未提交、推送、部署或覆盖 Go 静态嵌入 UI。

### 2026-10-28 预算阈值外部 Webhook

- 新增 `budget.threshold_reached` 事件，并在预算告警、通知 outbox 与 Webhook 队列之间保持同一 GORM 事务；启用且订阅该事件的端点按批次 fan-out，稳定 `webhook-id` 由告警 ID 与端点 ID 派生，重复评估不会重复入队。
- 队列与投递历史保存 `resource_id` 和预算 payload 快照，预算投递不查询 async job；签名、SSRF、防重放 lease、重试、历史记录和 redelivery 继续复用既有 dispatcher 路径。面板编辑器、筛选、测试事件、来源 ID 和移动布局已验证。
- ConfigStore、LogStore、Dispatcher、控制面跨批次/回滚及 HTTP redelivery 的定向 Go 测试均已通过；面板 Webhook 测试 6 项、1440/375px 浏览器夹具、Svelte 检查（0 错误、0 警告）和独立生产构建也已通过。OpenAPI 的分片/生成契约检查现为 30 passed / 0 failed，并新增重复 YAML 键、重复 operationId、bundle 漂移和虚拟密钥轮换 cooldown 保护。
- 该增量仍在本地验收，不等于真实预算接收端、PostgreSQL 生产链路、告警处理闭环、多用户、预测、统一策略、完整审计或备份恢复验收。原总目标继续保持 active / PARTIAL；预算功能仍留在混合工作区，未单独提交、推送或部署。

### 2026-10-28 预算 Webhook 持久化链路验收后续项

- follow-up `budget-webhook-monitor-receiver-recovery`：parent 为预算阈值外部 Webhook，source 为上一节真实接收端验收缺口，reason 为既有签名/重试测试使用内存队列，尚未覆盖后台预算扫描与真实持久化队列、日志库、HTTP 接收端之间的连线。
- 本轮冻结范围为既有测试文件内新增集成回归及本验收记录；Native 单 writer、低风险、external=0，不新增业务 API、存储抽象或兼容层，不修改生产轮询间隔。
- 场景使用真实 SQLite 控面库及日志库、生产 `PluginLogManager`、`BudgetMonitor.Start()`、通知发布器、端点 resolver 和 Dispatcher；接收端首次 503 后，重新构造 Dispatcher 从持久化队列恢复，验证 204、签名、稳定 payload、两次历史记录、队列清理及下一次扫描不重复入队，没有手工修改重试到期时间。
- `go test ./bifrost-http/controlplane -run '^TestBudgetWebhook' -count=1 -p 1 -timeout 3m -v` 通过 5 项顶层测试，包内执行耗时 7.889s，其中新集成场景为 5.45s。保留同源码测试二进制 `.codex-tmp/budget-webhook-controlplane.test`，仅对新场景 `-test.count=3` 连续复跑全部通过（5.73s / 5.41s / 5.25s）；首次命令墙钟时间主要消耗在外盘构建缓存读取和链接，不能把包内执行耗时描述为完整等待时间。
- `go vet ./bifrost-http/controlplane`、新增测试文件 `gofmt` 及当前 tracked diff 的 `git diff --check` 均通过；新增未跟踪测试文件也单独完成空白检查。代码 guard 未发现本轮阻断项。
- 本轮为 `PASS_SCOPED`，未运行 `-race`、全控面或全仓套件；未改生产代码、未提交、推送或部署。原总目标仍为 active / PARTIAL；合成费用不代表真实模型计费，Dispatcher 重建不等于整机/数据库重启，且 PostgreSQL 预算 Webhook 链路、生产投递、告警处理闭环、多用户、预测、统一策略、完整审计与备份恢复尚未完成。

### 2026-10-28 预算 Webhook 双 PostgreSQL 后续项

- follow-up `budget-webhook-dual-postgres`：parent 为 `budget-webhook-monitor-receiver-recovery`，source 为上一节 PostgreSQL 链路缺口，reason 为原集成夹具即使选择 PostgreSQL 控面库，日志库仍固定为 SQLite，不能证明 PostgreSQL 投递历史和用量读取路径。
- 冻结范围为预算 Webhook 既有测试夹具和验收文档；Native 单 writer、低风险、external=0。复用既有 `ELYGATE_TEST_POSTGRES_SOCKET` 与独立测试库创建/清理逻辑，日志库通过生产 `logstore.NewLogStore` 连接另一个私有 PostgreSQL 数据库；默认 SQLite 不变，不新增业务接口、环境开关或 runner 功能。
- 使用项目原生私有 PostgreSQL runner、`GOWORK=off` 和 `/Volumes/Datas` 缓存/临时目录，不接触现有数据库，不关闭 PostgreSQL 的 fsync、同步提交或 full-page writes。最终双库场景通过（14.99s，包内 16.379s），日志明确断言控面及日志后端均为 PostgreSQL；runner 的测试库泄漏检查和正常关服通过。旧夹具的控面 PostgreSQL / 日志 SQLite 启动已主动停止，不计为通过。
- 首轮双库测试确实在上游日志库构造器处因 `postgres password is required` 失败（20.449s），没有改生产验证；修正为私有 trust socket 的日志配置生成随机一次性值满足构造器要求，并断言实际 GORM 后端。该填充值不代表密码认证验收；日志物化视图关闭，不修改事务、队列、历史或 PostgreSQL 持久化设置。同一最终源码二进制的默认双 SQLite 场景连续三次通过（5.28s / 5.32s / 5.26s）。
- 这仍是合成费用到本地 HTTP 接收端的专项验证；不代表真实供应商计费、整机重启、ClickHouse、浏览器、生产投递、跨库备份恢复或完整平台验收。原总目标继续 active / PARTIAL。

### 2026-10-29 已提交面板类型检查修复后续项

- follow-up `panel-budget-props-typecheck`：parent 为预算 Webhook 交付，source 为已推送 `8d0204890` 的面板类型检查失败，reason 为主工作区同一行已随未提交告警确认功能改正，但隔离交付没有包含该类型修复。
- 冻结范围为独立 `panel/` 的预算概览 props 类型声明和本验收记录；Native 单 writer、低风险、external=0。不调整 API、授权、告警语义、依赖版本、静态嵌入 UI 或其他未提交功能，不自动提交、推送或部署。
- 隔离候选基于 `origin/dev` 的 `8d0204890771bea9d11a3c7e7477c646d9bc6c76`，位于 `.codex-tmp/panel-typecheck-20261029`；代码 diff 仅为一行类型声明，没有带入告警确认等其他功能。主工作区全部混合改动保留，本地 `dev` 仍落后 `origin/dev` 一个提交，未通过重置索引或覆盖文件进行同步。
- 候选 `bun run check` 通过（0 errors / 0 warnings）；预算及 Webhook 两个测试文件共 11 项通过（86 次断言）；独立 `vite build` 通过（17.61s），保留大 chunk 警告。输出位于 `.codex-tmp/panel-typecheck-build-20261029`，未执行 `copy-build`，没有覆盖 Go 静态嵌入 UI。主工作区的 Svelte 检查另行通过（0 errors / 0 warnings），不与候选证据混用。
- 使用已安装 Svelte 编译器分别生成修复前后的 client/server 代码，两种模式的 JavaScript 与 CSS 均逐字一致：这是擦除后的类型修复，没有增加运行时或推理请求路径成本。`git diff --check` 和代码 guard 通过；没有通过放宽类型检查、忽略诊断或改动依赖来消除错误。
- 本后续项为本地 `PASS_SCOPED`，未提交、推送或部署；不是全仓测试、浏览器后端联调、生产恢复或完整平台验收。告警处理闭环、多用户、统一策略、完整审计及生产交付等剩余要求不变，原总目标继续 active / PARTIAL。

### 2026-10-29 通知与告警布尔更新严格解析后续项

- follow-up `strict-boolean-mutations`：parent 为通知已读与预算告警确认交付，source 为 `48de02d06` 中通知接口对重复 `read` 字段取最后值、接受大小写别名，而告警确认接口拒绝这些请求，reason 为消除两个状态更新入口的歧义并保证无效请求没有状态或审计副作用。
- 冻结范围为控制面两个布尔 decoder、共用的单字段 JSON 解析、针对性测试和本验收记录；Native 单 writer、低风险、external=0。仅接受包含一个精确字段名及 boolean 的 JSON 对象，保留标准 JSON 转义字段名、合法 true/false、空白和原错误文案；不变更认证、数据库 schema、面板、依赖或其他功能，不自动提交、推送或部署。
- 验收要求：先复现旧通知 decoder 的重复/大小写字段问题；验证两个接口的合法与非法输入矩阵；真实路由在已设置/未设置两种初始状态下拒绝歧义请求，前后状态及审计完全一致；SQLite 与私有 PostgreSQL 定向回归；记录正常解析的 `ns/op`、`B/op`、`allocs/op` 前后结果。这里只影响控制面 mutation 的解析，不代表推理请求 RPS/SLA。
- 已先将两个原 decoder 原样移到独立源码文件，再以真实源码文件运行边界测试：旧通知实现的 7 个歧义用例失败，告警实现通过；修复后两者共 66 个用例通过。严格规则由两个实际调用者共用，不新增依赖；两个固定错误对象只在进程内常驻，不增加凭据、请求或流式内容缓存。
- Darwin/arm64、Apple M4、Go 1.27.3 的正常 payload 微基准使用 `-benchtime=200ms -count=3 -benchmem`；下表时间取三轮中位数。它只测 decoder，不包含 HTTP、认证、数据库或推理路径：

| Payload | Before ns/op | After ns/op | Before B/op | After B/op | Before allocs/op | After allocs/op |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| read=true | 260.6 | 164.2 | 632 | 536 | 9 | 9 |
| read=false | 259.8 | 157.1 | 632 | 536 | 9 | 9 |
| acknowledged=true | 234.0 | 157.5 | 568 | 544 | 12 | 9 |
| acknowledged=false | 234.4 | 157.2 | 568 | 544 | 12 | 9 |

- 同一最终源码的 SQLite 控制面整包回归通过：125 项顶层测试通过，仅 `TestPostgresControlPlaneBackupRestore` 因未配置 PostgreSQL socket 跳过，测试执行为 60.451s。私有 PostgreSQL 的解析、通知已读及告警确认相关 19 项顶层测试全部通过（102.543s），包括并发、审计失败回滚、Basic/session 主体一致性及两个新增路由回归；fixture 在运行时断言真实 PostgreSQL 后端，runner 检查临时数据库无泄漏并正常停止独立集群，没有连接现有数据库。
- 两个新增路由测试在 true/false 两种初始状态下共执行 36 次歧义请求，均返回 400，并比较完整状态和审计快照保持不变。日志位于 `.codex-tmp/strict-boolean-sqlite-20261029.jsonl`、`.codex-tmp/strict-boolean-postgres-20261029.log`；私有集群及退出日志位于 `.codex-tmp/elygate-cp-pg.rNFg7V/`。本轮较长的等待主要发生在测试执行前的外盘 Go 缓存装载，没有因观察超时重启测试。
- decoder 源码与边界测试的命名文件 `go vet` 通过；命名文件测试语句覆盖率为 100%，覆盖文件位于 `.codex-tmp/strict-boolean-coverage-20261029.out`，这不是控制面整包覆盖率。`gofmt`、`git diff --check` 和 clean-code-guard 通过。本后续项为本地 `PASS_SCOPED`，未提交、推送或部署；不构成完整后端包回归、生产迁移、备份恢复、认证环境或多用户验收。其他平台功能及生产验收缺口不变，原总目标继续 active / PARTIAL。

### 2026-10-29 管理员配置变更后的会话批量失效审计后续项

- follow-up `dashboard-session-flush-audit`：parent 为管理员会话审计与认证配置审计，source 为 `f7d335617` 及管理审计覆盖矩阵剩余项 2，reason 为认证配置改变后的会话批量删除尚未与审计同事务提交。完整冻结契约位于 `.codex-tmp/dashboard-session-flush-contract-20261029.md`。
- 范围为控制面会话审计、ConfigHandler 窄清理回调、server 注入及对应测试和文档。认证与事务高风险，panel 模式：root 唯一 writer、两位隔离只读 reviewer、最多两轮；升级原因为认证身份与批量删除事务安全。沿用 Go 1.27.3、fasthttp、GORM、SQLite/PostgreSQL，不改 schema、依赖、员工会话或推理路径；不自动提交、推送或部署。
- 删除与 `dashboard_sessions.flushed`（`dashboard_session/all`）聚合事件同事务，实际删到行才记一条；空表/重复清理不记事件，不逐行加载或解密凭据。身份取自变更前已验证请求的上下文；Basic 保留旧管理员身份，会话使用既有固定管理员身份，首次设置、bypass 与匿名保持匿名，客户端身份 header 不参与解析。
- 保留上游“保存认证配置后再清理会话”的部分成功边界：删除/审计失败或提交前取消时回滚删除及聚合审计，不回滚已保存配置、运行时发布及原有 `auth_config.updated` 事件；丢失提交确认仍为不确定结果，不能声称必定回滚。SQL 使用独立的 30 秒标准 context，不将 RequestCtx 传给数据库。并发新会话遵循单条 DELETE 的数据库可见性，本项不声称串行化登录与改密，也不补失败登录、自动过期或 setup/WS ticket 审计。
- 验证结果：Go 1.27.3 下三个相关包构建及 `-vet=all` 通过；最终控制面测试夹具修正后单独重新构建（`-ldflags='-s -w'`，未启用 race）。`^TestDashboardSession` 在 SQLite 和 PostgreSQL 各通过 15 项顶层测试，包含 15 个真实配置路由子场景及取消、并发、失败回滚、加密/损坏密文、数据库重新打开；handlers 的认证配置审计和 bypass 口令证明两组回归通过，server 真实认证路由的 5 个场景通过。两位只读 reviewer 各完成两轮，最终均为静态 `PASS_SCOPED`，不替代上述运行结果。
- 证据位于 `.codex-tmp/dashboard-flush-{sqlite,postgres}-verified-20261029.log`、`dashboard-flush-handlers-final-20261029.log`、`dashboard-flush-server-final-20261029.log` 和 `dashboard-flush-source-final-20261029.sha256`。PostgreSQL 沿用现有 runner 的私有 Unix socket 生命周期直接运行最终测试二进制，目录为 `.codex-tmp/elygate-cp-pg.gvHaEt/`；剩余测试数据库为 0，实例已停止。早期 RequestCtx 未初始化超时和客户端零值配置意外触发 compat 重载的夹具失败均已修正；原失败日志保留，未计作通过。较长等待主要发生在外盘依赖装载和 Go 链接阶段。
- 请求流成本：只在管理认证配置变更时运行，不改推理路径，也没有新增长驻缓存；一次 bulk DELETE、最多一个固定形状审计事件及独立 30 秒 context。最终原生非 race 微基准使用本机 Apple M4、外盘 SQLite，`-benchtime=10x -count=3 -benchmem`，各列三次采样中位数如下；日志为 `.codex-tmp/dashboard-flush-bench-verified-20261029.log`。小样本只描述此本地管理操作，不构成推理性能 SLA、生产容量或 PostgreSQL 性能结论。

| 会话数 | 上游 ns/op | 审计版 ns/op | 上游 B/op / allocs/op | 审计版 B/op / allocs/op |
| --- | ---: | ---: | ---: | ---: |
| 0 | 38158 | 40825 | 5408 / 63 | 8000 / 81 |
| 1 | 36167 | 80200 | 5408 / 63 | 13800 / 147 |
| 16 | 38688 | 77533 | 5408 / 63 | 13800 / 147 |

- `gofmt`、`git diff --check` 和 clean-code-guard 通过，本后续项为本地 `PASS_SCOPED`。本次提交和推送按用户明确指令执行，其他工作区改动不混入；未部署，未运行 race 或完整后端包回归，不构成生产迁移、恢复、真实外部账号或多用户验收。原总目标继续 active / PARTIAL。

### 2026-10-29 预算告警处理与重新打开后续项

- follow-up `budget-alert-resolution`：parent 为预算告警确认交付，source 为本路线图与 `panel/PARITY.md` 的人工处理闭环缺口，reason 为确认不等同于处理完成。冻结范围为控制面状态、查询、路由、测试及独立面板和文档；Native、中风险、root 唯一 writer、一位独立只读 verifier。契约位于 `.codex-tmp/budget-alert-resolution-contract-20261029.md`，不新增旧 Elygate 兼容层，不改上游 `ui/`。
- 新增 v10 独立处理记录表和严格单布尔 `PUT /api/control-plane/budget-alerts/{id}/resolution`；支持处理/重开、首次时间与固定服务端管理员身份、幂等和审计同事务。确认与处理共用告警行锁，事务内回读完整联合视图；处理不改变原始告警、确认、通知已读、预算拦截、阈值去重或 Webhook/outbox。GET 的 all/open/resolved 先筛选后分页，并与项目/应用交集；拒绝已知参数重复、空值及非法分页。
- 面板提供独立处理按钮、时间/操作者、筛选及未知状态；两种写入共享跨 scope/unmount 的 pending barrier。行退出筛选后补第一页，只在移除行导致焦点丢失且用户未另移焦点时回到筛选器。确认辅助模块直接重命名为 `budget-alert-mutations`，没有旧模块 re-export。
- 最终 Go 1.27.3 构建及 `-vet=all` 通过，未启用 race。同一最终二进制在 SQLite 控制面整包通过 145 项顶层测试，仅 PostgreSQL 专属备份恢复测试因未配置 socket 跳过；私有 PostgreSQL 18 的处理、确认及布尔解析定向回归通过 22 项顶层测试。覆盖迁移、并发、幂等、失败/取消回滚、外键、授权、Origin 和查询边界；临时测试库剩余 0，实例正常停止。私有集群关闭 fsync 等仅验证 SQL/锁语义，不证明崩溃持久性。
- 面板 279 项测试、1360 次断言通过，Svelte 检查 0 错误/警告，独立 Vite 构建通过，保留 chunk 体积提示；没有执行 `copy-build` 或覆盖 Go 静态嵌入 UI。Playwright API fixtures 的 23 组交互检查覆盖筛选补页、失败恢复、乱序隔离、写入 barrier、键盘、桌面/手机/横屏/暗色，6 项暗色文字对比度最低 4.822；截图已检查，临时浏览器及开发服务已关闭。这不是实际后端到浏览器联调。
- 请求流成本仅影响管理告警查询/写入，不改推理路径或新增长驻缓存；处理表每个已处理告警最多一行，重开或删除告警后释放。Apple M4、外盘 SQLite、25 条告警、`-benchmem -benchtime=100x -count=3` 的读查询中位数：仅确认 JOIN 为 73897 ns/op、36371 B/op、833 allocs/op；新增处理 JOIN 为 83963 ns/op、40090 B/op、933 allocs/op。两者使用同一当前视图类型，是查询形状比较，不是旧二进制全链路 before/after，也不代表 PostgreSQL 或推理性能。
- 证据位于 `.codex-tmp/budget-resolutions-{sqlite,postgres,bench}-final.log`、`budget-resolutions-panel-{tests,check-final,build-final}.log`、`budget-resolutions-browser-verified.log` 及 `budget-resolutions-source-final.sha256`。独立只读复核、源码校验、格式与 diff 检查通过。本增量为本地 `PASS_SCOPED`，按用户本轮明确要求提交推送，未部署；真实供应商费用、真实后端浏览器链路、多用户、统一策略、模型治理、全路径撤销、完整审计、生产迁移及整机备份恢复仍未完成，原总目标保持 active / PARTIAL。

### 2026-10-29 预算告警处理真实运行验收后续项

- follow-up `budget-resolution-runtime`：parent 为 `budget-alert-resolution`，source 为上一节真实后端浏览器链路缺口，reason 为数据库回归与浏览器 API 夹具不能替代生产 Bootstrap/Start 到面板的连线验收。范围为已有私有 SQLite 运行夹具、本地协调脚本与验收文档；Native、低风险、root 唯一 writer、external=0，不改业务语义或轮询间隔。
- 基于 `37da8b23a` 的当前生产后端源码重新构建，复用官方日志库存入合成费用，后台监控独立生成项目/应用 4 条阈值告警；真实登录、同源写入、键盘处理、Basic 幂等、确认与处理独立、筛选后重开及焦点恢复、提交后丢响应的未知态/刷新恢复、精确审计均通过。匿名请求 401、已认证外来 Origin 请求 403，未使用 API fulfilled/mock 响应。桌面、375px、暗色和横屏截图已检查。
- 完整停止后端进程，再用相同数据重启；真实会话和状态仍有效，额外等待 65 秒监控周期没有重复告警/审计。两次后端均正常退出；停机后 immutable SQLite 对账为 alerts=4、resolved=1、acknowledged=0、audits=5、read_receipts=0、delivered=4、notifications=4，后续只读复核一致，无 WAL 或运行残留进程。
- 16 项检查全部通过，报告 `.codex-tmp/budget-resolution-runtime-dO65ou/report.json` 的时间为 2026-10-29 02:46:15Z 至 02:48:25Z，errors=[]。证据为 `.codex-tmp/budget-resolutions-runtime-final.log`、对应二进制指纹及 buildinfo；原产品源码清单已全部核对，脚本最终定位器/主题等待修正后的 harness 指纹已刷新。前两轮脚本定位器与主题切换时序失败不计为产品通过，原失败报告保留，没有为它们修改业务代码。
- 本后续项为本地 `PASS_SCOPED`，关闭上一节的 SQLite 真实后端到浏览器处理链路缺口；不证明真实模型计费、PostgreSQL 浏览器链路、多用户、统一策略、模型治理、全路径撤销、完整审计、生产迁移或整机备份恢复。未部署、未改 Go 静态嵌入 UI；运行截图暴露的暗色徽标可读性单列为 `budget-status-theme` 后续项，不以此报告冒充后来 CSS 的运行证据。原总目标仍 active / PARTIAL。

### 2026-10-29 预算状态徽标主题可读性后续项

- follow-up `budget-status-theme`：parent 为 `budget-resolution-runtime`，source 为真实运行截图中预算 healthy/warning 徽标的暗色可读性缺口；范围冻结为独立面板 CSS、一个回归测试、浏览器主题验收和文档，不改 API、Go、依赖或静态嵌入 UI。Native、低风险、root 唯一 writer、external=0。
- 修复前暗色固定深色文字在 tinted surface 上约 `2.55:1`；改为现有主题 `--foreground` 与 `--success`、`--warning`、`--destructive` 的语义 tinted surface。修复后真实渲染的三种状态在浅色/暗色及 1440px、375px、横屏均至少 `11.79:1`，文字不重叠、不截断，页面无横向溢出，reduced-motion 开启且无浏览器错误。
- 面板 280 项测试、1370 次断言通过；`svelte-check` 0 错误/警告；独立 Vite 构建通过并保留既有大 chunk 提示。证据为 `.codex-tmp/budget-status-theme-browser-verified.log`、`.codex-tmp/budget-status-theme-{tests,check,build}.log` 和 `output/playwright/budget-status-theme-{light,dark}-{1440,375,812}.png`。
- 本后续项为本地 `PASS_SCOPED`，不代表完整平台、真实模型费用、PostgreSQL 浏览器链路、生产部署/恢复或其他 active / PARTIAL 边界已完成。

### 2026-10-29 预算告警处理双 PostgreSQL 真实运行后续项

- follow-up `budget-resolution-postgres-runtime`：parent 为 `budget-resolution-runtime`，source 为 Phase A 和该后续项的 PostgreSQL 浏览器缺口，reason 为数据库回归及 SQLite 运行证据不能替代 PostgreSQL Bootstrap/Start 到面板验收。范围为复用运行夹具、新增本地协调脚本和文档；Native、低风险、root 唯一 writer、external=0，无业务、Go、依赖或推理路径变更。
- 私有 PostgreSQL 18.4 集群只监听权限 0700 的 Unix socket，fsync、synchronous_commit、full_page_writes 均为 on；配置和日志各用一个独立新建库。启动及重启后均核对两个库各有真实连接，应用目录不存在 config.db/logs.db；日志库构造器使用内存随机非空值满足校验，连接采用 trust socket，不代表密码认证或 TLS 验收。日志物化视图维护关闭，未改事务和数据库持久化参数。
- 复用已核验 SHA-256 的 Go 1.27.3 后端二进制；相关 Go 源码与原清单全部一致，唯一面板源码差异为上一节单独验证的徽标修复，本轮使用其独立构建。真实登录、同源管理写入、官方合成费用日志、后台 4 条阈值告警、键盘处理/重开、确认独立、Basic 幂等、匿名 401、外来 Origin 403、筛选焦点恢复、实际提交后丢响应及 5 条精确审计全部通过，无 API fulfilled/mock；桌面、375px、暗色及横屏截图保留，桌面和手机暗色已视觉复核。
- 首次停止后端后 SQL 对账，再完整停止并重启 PostgreSQL 和后端；同一会话及处理状态有效，额外等待 65 秒监控周期未重复告警或审计。两次停机对账一致：配置库 alerts=4、resolved=1、acknowledged=0、audits=5、read_receipts=0、delivered=4、notifications=4，独立日志库 logs=1。两个私有数据库均删除且剩余 0，两次后端和 PostgreSQL 正常退出并回收，无本轮运行残留。
- 23 个验收检查点通过，errors=[]，时间为 2026-10-29 03:50:53Z 至 03:53:13Z；报告 `.codex-tmp/budget-resolution-pg-euoFWz/report.json`，日志 `budget-resolutions-postgres-runtime-final.log`，夹具及指纹为 `budget-resolutions-postgres-runtime.mjs` 与 `budget-resolutions-postgres-runtime-final.sha256`。首轮在脚本 trim 尾部空字段的断言处失败、未进入产品流程，已修正并保留失败报告，未改生产代码。
- 本后续项为本地 `PASS_SCOPED`，关闭预算告警处理的 PostgreSQL 后端到浏览器和干净进程重启缺口，不证明真实模型计费、其他功能的完整 PostgreSQL 集成、多用户、密码/TLS、外部投递、统一策略、全路径撤销、完整审计、生产迁移、崩溃或整机备份恢复。未提交、推送、部署或替换静态嵌入 UI；原总目标仍 active / PARTIAL。

### 2026-10-29 管理员失败登录匿名审计后续项

- follow-up `failed-dashboard-login-audit`：parent 为管理员会话事务审计，source 为审计覆盖清单剩余项 2，reason 为三条凭据拒绝分支缺失事件。root 唯一 writer，认证边界高风险，panel 两位只读 reviewer、两轮收敛；仅增加现有 producer/bridge 的窄补丁和聚焦回归，不增加接口、配置、依赖、schema 或旧系统兼容层。
- 用户名不匹配、hash 比较错误、密码不匹配各记录一条 `dashboard_session.login_failed`，资源固定 `dashboard_session/dashboard`，空名称、nil 快照；持久化按事件强制 anonymous，API-key/已有可信 actor 不能冒充，且不污染同批其他事件。原 401 文案不变；审计失败保留完整响应并给出失败标头和固定无敏感日志。malformed、未启用/缺失认证、配置读取错误和会话写失败不误记凭据拒绝。
- 基线二进制仅移除本轮三个调用，新回归准确检出三条分支缺事件；恢复后的 handler 3 个顶层测试和 10 个 producer 子测试通过。SQLite race 与私有 PostgreSQL 各 25 个顶层测试、42 个子测试通过，覆盖既有成功会话、退出/批量失效、失败回滚、受保护 feed 和真实关闭重开。PostgreSQL 测试库清零，服务已正常停止回收；两包 vet、gofmt、diff 检查和两位源码复核通过，`clean-code-guard: clean`。
- 请求路径成本：Apple M4、Go 1.27.3、bcrypt MinCost 和测试 ConfigStore，无真实网络/数据库；1000 次、3 轮中位数（before → after，ns/op、allocs/op）：错误用户名 1462/10 → 1133/12，错误密码 743243/21 → 743631/23，hash 错误 1070/12 → 1141/14，成功 746089/21 → 737296/21。时间差含本地噪声，不宣称提速；失败 producer 增加 2 次分配、136 B，成功及推理路径无该 producer。单独 SQLite 样本中 producer-only 为 89.29 ns、136 B、2 allocs，含桥接事务为 69550 ns、10996 B、117 allocs；不是 PostgreSQL 或生产吞吐基准。
- 固定元数据只随 RequestCtx 存活，无新增长期缓存；每次拒绝新增一条持久事件和同步事务，表存储随次数增长，没有新增限流或自动清理。错误用户名不需 bcrypt 即可触发写入，须保留匿名写放大风险。进程崩溃窗口、setup/WS tickets、员工失败登录、其他敏感路由、生产部署/恢复和整体路线图仍未完成。
- 本项本地 `PASS_SCOPED`，报告 `.codex-tmp/failed-login-audit-results-20261029.json`，源码指纹 `.codex-tmp/failed-login-final-source.sha256`，测试、基线和基准日志均以 `failed-login-` 为前缀。未提交、推送或部署本轮修改，原总目标仍 active / PARTIAL。

### 2026-10-29 Dashboard 登录限流后续项

- follow-up `dashboard-login-rate-limit`：parent 为 `failed-dashboard-login-audit`，source 为失败登录审计的未完成成本边界，reason 为匿名错误凭据会为每次尝试同步写入审计事务。root 唯一 writer；认证和未授权资源放大按高风险处理，两位只读 reviewer 最终通过。本项只扩展现有 `PasswordLimiter` 和 Dashboard SessionHandler，不新增依赖、schema、配置、环境变量、分布式状态或旧 Elygate 兼容层。
- 生产 `NewSessionHandler` 使用 RemoteIP-only、空 username 的进程内 limiter：每个连接来源滚动 15 分钟最多 5 次，最多保留 4096 个来源桶，每桶最多 5 个时间戳。用户名轮换、`X-Forwarded-For`、`X-Real-IP` 不能重置桶；已存在来源在容量满时仍可消耗余额，新来源在满容量时拒绝且不驱逐活跃桶。满容量扫描最多每秒一次；重启清空，多实例不共享，代理/NAT 共享来源预算，这不是完整分布式安全边界。
- JSON malformed 仍在 limiter 前返回 400，缺少 config store 仍返回 403；已耗尽请求优先稳定返回 429，不读取认证配置、不比较 bcrypt、不创建 session、不生成失败审计。被准入请求保留既有 200/401/403/500 语义，并且成功、认证关闭、配置读取失败、会话写失败都消费一次预算；失败审计仍只为实际凭据拒绝生成一条事件。生产构造器始终初始化 limiter，现有 direct `SessionHandler` 测试构造的 nil limiter 旁路保持显式且仅限同包测试。
- 覆盖 0/1/5/6 次、用户名及转发头轮换、不同来源、fresh handler、满容量与过期回收、清扫节流、并发同源/多源、malformed 优先级、disabled/config/session/success、finish 回调和原有员工 limiter 语义；控制面真实路由覆盖前五次审计、第六次无审计/无 session、不同来源成功。SQLite 控制面 26 个顶层测试、42 个子测试及 handler/lib race 通过；私有 PostgreSQL 同范围通过，测试库剩余 0、实例已停止；员工认证聚焦 race 通过；四包 vet、gofmt、diff 检查和面板 auth 测试通过。
- 基准条件为 Apple M4、Go 1.27.3、无真实网络；限流器旧实现 admitted/denied 约 60/64 ns、8 B、1 alloc，修改后原构造路径约 71/78 ns、bounded 约 70/76 ns、8 B、1 alloc；handler 错误用户名中位数约 1.19 µs/12 alloc → 2.18 µs/15 alloc，错误密码约 747 µs/23 alloc → 762 µs/26 alloc，成功约 763 µs/21 alloc → 748 µs/24 alloc。handler 使用 bcrypt MinCost 与测试 ConfigStore，准入样本每五次在计时外换新 limiter，包含每五次一次的冷来源成本；4096 活跃桶强制清扫中位数 36189 ns、16 B、1 alloc，默认最多每秒一次。数字含本地负载噪声，不宣称生产吞吐或提速；结果 `.codex-tmp/dashboard-login-rate-limit-results-20261029.json`，日志 `.codex-tmp/dashboard-login-limit-*`，源码指纹 `.codex-tmp/dashboard-login-limit-source.sha256`。
- 本项本地 `PASS_SCOPED`，未部署、未做多实例/代理真实环境或生产恢复验收；审计 retention、crash window、setup/WS tickets、员工失败登录事件、其他敏感路由、统一策略和完整产品路线图仍未完成。原总目标保持 active / PARTIAL。

### 2026-10-29 离线路由仿真面板后续项

- follow-up `routing-simulation-panel`：parent 为离线路由仿真后端 checkpoint，reason 为后端已提交推送但独立面板验收仍未闭环。本项保持管理员离线、请求级状态和上游路由引擎边界，不引入实时 Shadow、策略版本、发布、回滚、真实用量读取或供应商调用。
- 面板从完整 `/api/routing/rules` 快照导入候选规则；拒绝截断/超大快照并保留原草稿，不带入数据库只读字段，不虚构 provider、model、身份或用量。编辑器校验规则、样本、链深和请求体大小，严格校验响应顺序、重复样本名、决策、错误和 trace；支持取消、切换视图、卸载、编辑后的迟到响应丢弃，以及 JSON 导出。
- `routing-simulation-browser.js` 使用 API 夹具完成 10 个交互检查点，覆盖键盘提交、错误聚焦、导入语义保留、无匹配/失败/决策结果、导出、取消与 stale-response 防护；亮暗主题、1440px、375px、812x375 横屏和 reduced-motion 均通过，无页面错误或横向溢出。截图位于 `output/playwright/routing-simulation-*`。
- 独立复核发现 malformed fallback 和负数/小数 TTFT 会被当作成功决策，已增加与后端契约一致的校验及正负边界回归；禁用 TTFT、未固定目标 Key、provider-only fallback 和固定 Key 时保留的空白 `provider_key_name` 不被误拒绝，非空配置别名仍拒绝。截图实测发现浅色错误文字仅 `3.73:1`，改用现有语义 token 的局部混色后，亮/暗文字与错误摘要分别为 `6.66:1` / `7.22:1`。不改 API、上游引擎或推理路径，没有新增长期状态。
- 面板全量测试 294 项、1522 个断言通过，`svelte-check` 零错误/警告，Vite 生产构建通过；Go 路由仿真 handlers/server 定向测试通过。浏览器夹具不是真实管理员后端、数据库、部署或生产验收，真实后端到面板联调仍待补；统一策略的版本、发布、在线 Shadow、回滚仍未完成，原总目标保持 active / PARTIAL。

### 2026-10-29 离线路由仿真真实本地联调

- follow-up `routing-simulation-live-local`：parent 为 `routing-simulation-panel`，source 为 `e0eef1f1c` 后仍缺真实管理员后端到面板连线证据，reason 为 API fixture 与单独 Go 回归不能替代实际连线。Native、低风险、root 单 writer、external=0；仅使用临时目录、随机口令、loopback 和已有生产启动入口，不修改业务语义、生产数据或扩展验收框架。
- 新编译 Go 1.27.3 夹具执行真实 `Bootstrap/Start`，使用独立 SQLite 控面/配置/日志库；当前生产面板 bundle 经保留 Host 的同源 Vite proxy 完成 Cookie 登录和完整规则导入，无浏览器 API 拦截。匿名仿真返回 401，已认证的异 Origin 请求返回 403。
- 12 项联调检查通过：真实后端的匹配、未匹配和缺用量错误分别呈现；候选目标 Key、1234ms TTFT、空白 fallback alias 与固定 fallback Key、引擎 trace 均保留；下载 JSON 与提交输入和真实响应严格相等；后端 400 保留候选输入、清除结果且禁用导出。1440px/375px、亮/暗主题结果截图已检查，无横向溢出或页面异常。
- 仿真前后的完整已存规则响应一致，浏览器路由写入仅有仿真 POST；正常停机且 WAL 消失后，以 immutable 只读 URI 再查 SQLite，确认仍只有原始规则、fallback 和未固定 Key 的目标。未配置 provider，样本使用显式合成快照，不代表实际供应商或用量验收。临时后端、preview 和浏览器均已关闭。
- `.codex-tmp/routing-simulation-live-report.json` 记录源码 SHA、二进制/入口 bundle/夹具指纹、检查项及停机查询；源码为同目录 `routing-simulation-live-runtime.go`、`routing-simulation-live.mjs`，截图和下载位于 `output/playwright/routing-simulation-live-*`。最初链接因系统临时盘不足失败，改用 `/Volumes/Datas` 临时目录后构建通过；首次停机只读探测需改用既有 immutable URI 方式，随后全流程重跑通过。`bun run build` 同时刷新了 ignored HTTP UI 目录，无已跟踪产物变更或部署。
- 本项为本地 `PASS_SCOPED`，关闭 SQLite 真实管理员后端到面板的连线缺口；PostgreSQL 浏览器链路、真实 Key 授权/计费、多用户、策略版本/发布/回滚/在线 Shadow、其他路线图功能和生产部署/恢复仍未完成。未提交或推送本增量，原总目标保持 active / PARTIAL。

### 2026-10-29 Prompt 仓库刷新失败审计后续项

- follow-up `prompt-audit-reload`：parent 为路由与 Skill 审计回读后续项，source 为当前 `prompts.go` producer inventory，reason 为 11 个 Prompt/Folder/Version/Session 写入口在缓存刷新后才记录审计；刷新 panic 会让已成功落库的变更漏记。
- 事件现在在写入成功后、`ReloadPromptCache` 前记录；刷新返回错误仍不改变原成功响应，刷新 panic 仍由既有恢复中间件返回 500，但已记录的变更会继续交给管理审计桥接。未改变授权、存储事务、缓存接口、API/schema、推理路径或旧 Elygate 兼容层。
- 先在未修复源码上确认 11 个 panic 场景均因缺少审计事件失败，再用 `c91a03a43` 原始 `prompts.go` 的 overlay 复验同样红灯。最终 handler race 通过 55 个叶场景，包含 nil/error reloader、写入失败无事件，以及 rename 前后快照；真实注册路由覆盖成功、刷新 panic、写入拒绝、审计失败加 panic、未授权、身份与消息/变量内容排除。
- SQLite 的 Prompt/Skill 控面 race 合计通过 62 个叶场景（148.785s）；私有 PostgreSQL Prompt 的 44 个叶场景独立通过（165.299s，未启用 race），runner 确认数据库清空并停机。首次合并 PostgreSQL race 运行中 Prompt 44 个场景已通过，但后续 Skill 迁移触及 5 分钟时限，因此该次包级结果是失败，不计作全量 PostgreSQL 通过；超时遗留的 1 个私有测试库已删除，剩余 0，实例已停止。
- 请求成本仅涉及这 11 个管理员入口：重排已有调用，不新增快照字段、SQL、驻留缓存或推理路径工作。Apple M4、Go 1.27.3、非 race、内存 ConfigStore/reloader 夹具的 handler 微基准，`-benchtime=100ms -count=3 -benchmem`，各列三次中位数如下。计时含请求解析、现有审计序列化和响应，但不含真实数据库、网络、集群缓存刷新或生产签名；小样本不能证明统计显著性或生产 SLA。

| 管理入口 | 原始 / 修复 ns/op | 原始 / 修复 B/op | 原始 / 修复 allocs/op |
| --- | --- | --- | --- |
| deleteFolder | 1073 / 1111 | 1506 / 1505 | 25 / 25 |
| createPrompt | 1846 / 1842 | 2134 / 2112 | 29 / 29 |
| updatePrompt | 2645 / 2642 | 3074 / 3078 | 50 / 50 |
| deletePrompt | 1105 / 1126 | 1576 / 1573 | 25 / 25 |
| createVersion | 3293 / 3433 | 3606 / 3619 | 51 / 51 |
| deleteVersion | 2075 / 2120 | 2277 / 2290 | 44 / 44 |
| createSession | 3356 / 3429 | 3656 / 3658 | 50 / 50 |
| updateSession | 4903 / 4970 | 4829 / 4887 | 83 / 83 |
| deleteSession | 2083 / 2120 | 2404 / 2392 | 44 / 44 |
| renameSession | 4554 / 4652 | 4676 / 4625 | 80 / 80 |
| commitSession | 2696 / 2663 | 3108 / 3138 | 43 / 43 |

- 证据位于 `.codex-tmp/prompt-audit-baseline-red-20261029.jsonl`、`prompt-audit-handlers-race-20261029.jsonl`、`prompt-skill-audit-sqlite-20261029.jsonl`、`prompt-audit-postgres-only-20261029.jsonl`、`prompt-audit-bench-{before,after}-20261029.log` 和 `prompt-audit-timeout-cleanup-20261029.log`；两个相关包的 `go vet`、格式和 diff 检查通过。
- 本项为本地 `PASS_SCOPED`，未提交、推送或部署新补丁。进程崩溃造成的 mutation/bridge 窗口、完整 transactional outbox、生产部署/恢复、统一策略版本/发布/Shadow/回滚和 provider-harness 管理场景仍未完成；后者的隔离失败注入夹具方案位于 `.codex-tmp/prompt-audit-harness-design-20261029.md`，按项目 skill 待用户确认，集合与付费调用未动。总目标保持 active / PARTIAL。

### 2026-10-29 Skills 回读审计 PostgreSQL 补充验收

- 已推送的 `c91a03a43` 在 Skill 更新/版本切换写入成功后先记录事件，随后回读成功才补充脱敏 `after`；回读错误或 panic 时保留事件且不虚构后状态，失败写入不产生事件，不改变 Skill 版本、serve 或授权规则。
- 本轮未再修改 Skills 生产代码：复用现有三个入口与六类结果的 18 个场景。SQLite race 已包含在上节 62 场景中，PostgreSQL race 分组独立通过全部 18 场景（113.523s），失败/跳过/竞态报告均为 0，覆盖真实数据库写入、Basic 认证路由、审计 feed、失败响应头及敏感字段排除。
- 独立 runner 的临时数据库清空和实例正常停机已确认；日志为 `.codex-tmp/skill-audit-postgres-race-20261029.jsonl`，实例日志为 `.codex-tmp/elygate-cp-pg.bcxM2n/postgres.log`。首次混合运行的 5 分钟超时证据继续保留，不用后续通过覆盖失败历史。
- 此为现有修复的本地 PostgreSQL 验证补充，不代表上传文件全生命周期、进程崩溃原子性、生产备份恢复或总目标完成；provider-harness 方案仍待确认，没有修改集合或执行付费调用。

### 2026-10-29 审计关联真实浏览器与重启验收

- follow-up `audit-correlation-live-visibility`：parent 为已推送的审计 Request/Trace 关联实现，source 为 `management-audit-coverage.md` 的浏览器可见性缺口，reason 为单元测试尚不能证明真实网络、面板布局及独立进程重启后的持久化。采用 Native、低风险、root 单 writer、external=0，仅做本地验收与文档补充，不改生产请求路径。
- 从 `0e38df3d5` 源码重新编译真实 `Bootstrap`/`Start` 运行程序与隔离面板，使用 loopback、随机管理员密码和 `/Volumes/Datas` 下临时 SQLite。合成 v10 形状历史表经当前启动过程升级到 v11 后保留原行且不虚构关联；这是隔离迁移夹具，不是真实旧版生产升级。
- 真实浏览器登录后，通过同源 fetch 验证项目/应用、应用密钥签发/轮换/撤销、项目/应用预算、绑定/撤销/重绑，以及 management bridge 下的禁用路由创建，共 13 项 mutation 保留各自 Request ID 与可信操作者。128 字节边界完整保留，缺失/恶意 ID 被省略，入站 Trace header 不会被冒认为可信 Trace；这不是全部资源表单的交互验收。
- 正常停机后对照 SQLite 落盘值，新后端进程打开同一数据库，全部既有事件、时间、操作者及关联值与停机前逐项一致，既有会话仍有效。随后真实登出撤销 feed 访问，重新登录可见携带对应 Request ID 的 session 删除事件；最终 migration 记录唯一且数据库完整性检查通过。没有模拟强杀、掉电或整机恢复。
- 1440x1000、375x812、812x375 的亮暗主题截图与尺寸检查通过，关联列可在表格内滚动完整查看，长 ID 换行且页面无横向溢出。亮/暗模式标签对比度 7.38:1 / 7.47:1，ID 对比度 14.70:1 / 16.30:1，页面异常为 0。Trace-only/双字段及恶意文本转义使用明确标注的数据库展示夹具，不冒充真实 tracing 链路。面板 295 测试、1528 断言、Svelte 零错误/警告与隔离 Vite 构建通过。
- 报告 `.codex-tmp/audit-correlation-live-report.json` 记录源码/二进制哈希、三次后端启动、mutation 矩阵及布局数值，截图位于 `output/playwright/audit-correlation-live-*` 和 `audit-correlation-fixtures-*`。全部本轮进程正常停止，未调用供应商、未改 provider-harness、未部署或覆盖 Go 静态嵌入 UI。
- 本后续项为本地 `PASS_SCOPED`；真实管理 Trace、审计完整覆盖/transactional outbox、策略版本/发布/Shadow/回滚和生产部署/恢复仍未完成。PostgreSQL 浏览器关联见下一个独立验收项，原总目标继续 active / PARTIAL。

### 2026-10-30 审计关联 PostgreSQL 真实浏览器与重启验收

- follow-up `audit-correlation-postgres-visibility`：parent 为同一审计 Request/Trace 关联实现，source 为 PostgreSQL 浏览器可见性边界，reason 为证明生产 `Bootstrap`/`Start` 路径实际使用 PostgreSQL，并在独立进程重启后保留 feed。采用 Native、低风险、root 单 writer、external=0；未修改生产请求路径或认证代码。
- 从已推送的 `aadb59c48` 重新编译真实运行程序；面板源码未变化，复用前项隔离构建，运行于 10 月 29 日启动、10 月 30 日零点完成。私有 PostgreSQL 18.4 仅 Unix socket、拒绝 host 认证，`fsync`、`synchronous_commit`、`full_page_writes` 默认开启；随机 config/log 两个数据库均由生产配置打开，未生成 SQLite fallback 文件。
- 匿名 feed 返回 401；真实 Chromium 登录后通过同源请求验证项目/应用、应用密钥创建/轮换/撤销、项目/应用预算、绑定/撤销/重绑和禁用 routing-rule management bridge。13 个 mutation case 均保留各自 Request ID 与 `local-admin`，登录/登出/重登生命周期事件另行检查；128 字节边界原样保留，缺失、恶意、超长 ID 被省略，入站 `traceparent`/`x-bifrost-trace-id` 不会变成可信 Trace。
- 直接 PostgreSQL SQL 行与浏览器 feed 的 ID、操作者、动作、资源、时间及关联字段逐项一致。后端与 PostgreSQL 独立正常停机/重启后，会话和既有事件全部一致；Trace-only/双字段/缺失字段展示夹具无 HTML 注入。登出事件带 Request ID，重新登录可见，最终 PostgreSQL 重启仍保留登出与重登事件。
- 1440x1000、375x812、812x375 的亮暗主题和 reduced motion 检查通过，表格内部滚动、长 ID 换行、页面无横向溢出；页面异常为 0。后端两次、PostgreSQL 三次、浏览器、Vite preview 与两个数据库的清理退出均成功。
- 报告 `.codex-tmp/audit-correlation-postgres-live-report.json` 记录 `PASS_SCOPED_POSTGRES`、源码/二进制哈希、12 项检查、布局与清理状态；截图为 `output/playwright/audit-correlation-postgres-{light,dark}-{1440,375,812}.png`。这是本地 PostgreSQL 浏览器/正常重启证据，不是真实管理 Trace、强杀/掉电恢复、生产迁移、完整审计覆盖、transactional outbox 或生产部署验收。总目标继续 active / PARTIAL。

## 3. 单机部署架构

```text
Browser / SDK / Agent
        |
        v
Elygate single process
  - AI and MCP gateway
  - management panel
  - policy enforcement
  - background workers
        |
        v
PostgreSQL 16+
  - config and governance
  - request logs and usage ledger
  - durable jobs and outbox
  - advisory locks
  - LISTEN/NOTIFY when needed
  - pgvector when semantic cache is enabled
```

### PostgreSQL 取代额外协调组件

首版不部署 Redis。借鉴 Postgres-first / no-Redis 的产品思路，但不直接引入面向 Bun/Node.js 的 Postgresx 包。Elygate 是 Go 服务，继续使用现有 PostgreSQL、GORM 和 pgx 能力：

- 事务表和条件更新承担持久化状态机。
- PostgreSQL advisory lock 承担互斥和迁移锁。
- 现有数据库任务表承担持久化后台任务。
- `LISTEN/NOTIFY` 仅在真正需要低延迟通知时增加，不作为数据真相源。
- `pgvector` 作为语义缓存的推荐向量存储，Redis Vector Store 保留为可选兼容项。

单机版仍允许数据库与 Elygate 运行在同一台服务器的不同容器中。PostgreSQL 是唯一必须持久化和备份的基础服务。

## 4. 当前版本范围

### Must

- 单进程 Elygate + PostgreSQL Docker Compose 安装。
- Project、Application、Environment 和 Application Key 生命周期。
- Key 过期、撤销、轮换以及模型/MCP allowlist。
- 每个受管请求绑定 `project_id`、`application_id`、`virtual_key_id` 和 `trace_id`。
- Usage Ledger 按项目、应用、用户、模型和 Provider 查询与导出。
- 日/月预算、限流和超额告警。
- 管理员 mutation、模型调用、MCP 调用和 Guardrail 命中审计。
- 策略草稿、发布版本、回滚和 Shadow Evaluation。
- 数据库备份、恢复、升级前检查和失败回滚说明。
- `/health`、日志保留和基础 Prometheus 指标。

### Should

- OIDC 登录，保留本地管理员作为恢复入口。
- 模型目录的数据等级、区域、能力、价格和健康属性。
- 写操作 MCP 风险等级、审批和 Kill Switch。
- PostgreSQL outbox 驱动 Webhook 和异步通知。
- 语义缓存使用 pgvector，避免为缓存单独部署 Redis。

### Could

- 轻量审批队列。
- 应用级成本预测。
- 策略历史回放。
- 预置国产模型目录和基准模板。

## 5. 明确延期或删除

以下内容不进入当前两个季度的完成标准：

- Kubernetes、Helm、多节点 mesh、跨区域 HA。
- Redis、Valkey 或独立消息队列作为必需组件。
- LDAP、AD、SCIM 自动同步；首版最多实现 OIDC。
- 外部 KMS、HSM、国密服务和动态云 IAM 数据库认证产品化。
- WORM 审计、法定存证和完整离线验签包。
- openGauss、达梦、人大金仓以及大规模信创兼容矩阵。
- 全量离线镜像仓库、依赖仓库和模型仓库。
- Agent 应用生成器、完整工作区运行时和多 Agent 调度平台。
- 双人复核、资金、采购、权限授予和生产自动化。
- 跨租户 SaaS 计费、经销商和复杂许可证系统。

## 6. SBOM 与镜像签名决策

对当前中小企业单机版，**SBOM、镜像签名和离线验签工具不应成为产品功能或发布阻塞项**。它们解决供应链和强监管采购问题，不直接提升日常网关治理体验。

当前只保留低成本基线：

- 发布版本固定，不使用无法追溯的生产 `latest`。
- 发布页提供二进制或镜像 digest、SHA-256 和变更记录。
- CI 保留依赖漏洞扫描和许可证检查。
- 数据库迁移版本与应用版本对应。

以下条件出现时再升级为完整供应链交付：

- 客户采购条款明确要求 SBOM。
- 需要完全离线交付或内部镜像仓库验签。
- 进入金融、政务或强监管客户生产环境。
- 开始向第三方发布 Skill、插件或 Agent 执行包。

## 7. 精简后的路线图

### Phase A：可采购的单机控制面

- 完成 Application Key 创建、轮换、撤销和强制绑定模式。
- 补齐 Usage Ledger 归属、预算周期、导出和告警。
- 将当前 mutation 审计扩展到所有敏感管理员操作。
- 移除或明确标识所有无后端的企业占位页。
- 完成真实 PostgreSQL 集成测试。

退出标准：创建项目和应用后，可签发 Key、调用模型、记录成本、触发预算或策略，并在审计中完整检索。

### Phase B：统一策略与模型治理

- 统一模型、数据等级、Provider、预算、限流和 Guardrail 策略。
- 支持策略版本、发布、Shadow、回滚和决策解释。
- 模型目录补齐区域、数据等级、能力和健康状态。
- 所有普通 HTTP、WebSocket、WebRTC、MCP 和异步路径使用同一策略入口。

退出标准：管理员可以解释每次请求为何允许、拒绝或选择某个模型，并能回滚策略。

### Phase C：可信工具调用

- MCP 工具风险分级。
- 写操作审批、短期授权和参数级限制。
- Agent、Application 和 Tool Kill Switch。
- 工具调用结果、审批和验证统一进入审计。

退出标准：高风险 MCP 写操作未经批准不能执行，批准后授权仅对目标动作短期有效。

### Phase D：单机生产交付

- Docker Compose、反向代理、TLS 边界和升级手册。
- PostgreSQL 备份、恢复、连接池和容量建议。
- 配置检查、健康检查、日志保留和磁盘告警。
- 固定版本发布、校验和、回滚版本和已知限制。

退出标准：在一台服务器上完成全新安装、升级、备份恢复和回滚演练。

## 8. 产品验收指标

- 100% 受管 Application Key 可过期、轮换和撤销。
- 100% 受管请求可归属到 Project/Application。
- 100% 敏感管理员 mutation 进入审计。
- 100% 已发布策略可回滚。
- 撤销 Application Key 后，普通 HTTP、WebSocket、WebRTC、MCP 和异步执行全部拒绝下一次动作。
- 单机部署不依赖 Kubernetes、Redis、外部 KMS 或对象存储。
- PostgreSQL 备份恢复后，配置、Key 绑定、Usage Ledger 和审计数据一致。

## 9. 下一实现顺序

1. Application Key 强制绑定模式与轮换 API。
2. Usage Ledger 预算周期、聚合和告警。
3. 管理员操作审计覆盖矩阵。
4. 策略版本、发布、Shadow 和回滚。
5. 模型目录数据等级与区域约束。
6. MCP 写操作审批和 Kill Switch。
7. PostgreSQL 单机安装、备份恢复和升级验收自动化。

### Application Key API（当前已实现）

应用 Key 使用现有 Virtual Key 数据面，但由 Application 绑定和控制面接口管理：

```text
POST   /api/control-plane/applications/{application_id}/keys
GET    /api/control-plane/applications/{application_id}/keys
POST   /api/control-plane/applications/{application_id}/keys/{virtual_key_id}/rotate
DELETE /api/control-plane/applications/{application_id}/keys/{virtual_key_id}
```

创建和轮换响应中的 `value` 只在该次响应返回；查询接口只返回绑定元数据，不重新披露密钥值。轮换和撤销均在 PostgreSQL 事务内写入审计事件，随后刷新网关内存状态。
