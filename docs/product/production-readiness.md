# Elygate 生产发布验收

检查日期：2026-10-31。状态：**PARTIAL / 不可据此批准生产切换**。

本清单承接 [产品规划](elygate-smb-ai-gateway-roadmap-zh.md) 的原始范围，
不以本次已实现的功能重新定义完成标准。新系统只兼容 Bifrost 上游契约，
不增加旧 Elygate 兼容层；独立 `panel/` 不替换为上游 `ui/`。

## 候选版本

- 草稿 API 初始源码基线：`dev` / `826067def`，包含 Bifrost `c34bd4360`。
  面板草稿接入基线为 `b508f90e7`；不可变版本 API 为 `d5669bde5`，
  面板版本历史为 `d4a4be649`，另有本地初始化竞态修复与验收文档。
  最终发布前仍需重新固定候选 SHA、构建产物和部署镜像。
- 以下既有 Relay 运行/恢复证据来自 `9635d01a3` 及其验收脚本后续增量；
  旧构建不包含新增草稿 API，不能复用于该 API 的运行证明。
  最终发布前需重新固定 SHA 并对其复验，不将本地二进制视为已发布制品。
- 草稿面板阶段全量回归：367 单测、2198 断言及 1 代理集成测试
  （12 断言）通过；此前代理测试超时，单独复跑和全量复跑均通过，
  未修改测试或放宽超时。
  Svelte 检查零错误、零警告，Vite 生产构建通过。
- `core/relay` 与 `core/schemas` 使用外部链接的定向 Go 回归通过。
- 既有 Relay 验收按 Makefile 的 macOS PIE、外部链接和 `sqlite_static` 参数构建的
  标准网关已完成；`go version -m` 记录历史基线 `e6b14def5`，
  `vcs.modified=true`（构建时 tracked 文件无改动，存在本地产物）。
  本地二进制 SHA-256：
  `6a02fce618bcc59e7e251a662ce8020cf660fcd7296a2dbcad511a41c83f5fe0`。
- 增强后的 Relay 真实本地运行验收 `1 pass / 0 fail`：登录、预览、CRUD、
  脱敏凭据往返、Key 创建/轮换/到期/撤销、grant、本地转发、SSE、
  费用、持久化日志、统计、CSV 导出和绑定撤销均通过；
  拒绝请求上游命中数为零，子进程优雅退出与临时目录清理通过。
- 首轮脚本把保留查询串的 `/v1/echo?q=kept` 误判为 `/v1/echo`，已改为
  查询串完整匹配。扩展生命周期夹具初次重复使用同一 Key 名称而被上游拒绝，
  已使用各自 Application ID 命名并重跑通过。未改变网关业务或削弱断言。
- 先前中止的构建/测试和旧 stdin 包装程序启动失败不计为通过；
  本次成功来自新构建的标准 CLI，而非旧包装程序。
- 本机 Docker daemon 不可用；Dockerfile、Compose 或镜像 manifest
  的检查不能替代镜像实际构建与启动。
- 本地 Relay 双 PostgreSQL 真实生命周期、数据库/网关正常重启和停机备份恢复
  已通过，详见下节。这不等于整机、其他功能、升级回滚或生产恢复验收。
- CI、镜像 digest、部署状态和生产数据均需针对最终候选重新核实。
- 员工凭据拒绝已补固定匿名审计和有界来源 IP 限流，详见
  [专项记录](employee-login-failure-audit.md)。失败计数与审计仍为独立事务，
  未关闭 crash window；进程本地限流不替代多实例或反向代理环境验收。
  本次提交推送不构成镜像、部署或生产切换验收。

## 功能验收门

| 要求 | 必须提供的证据 | 当前未闭合边界 |
| --- | --- | --- |
| Application Key 生命周期与授权 | 真实 HTTP 创建、调用、过期、轮换、撤销；普通 HTTP、WebSocket、WebRTC、MCP、异步下一动作拒绝 | 不把局部路径测试外推为全路径保证；活动 turn 和媒体流边界仍需明确 |
| 使用量与计费归属 | 项目/应用/用户/供应商/模型可检索，明细、汇总、导出和预算一致 | 合成日志不证明真实供应商计费；多用户、外部通知仍需完整验收 |
| 敏感管理员操作审计 | 按覆盖矩阵逐路由验证成功、失败、取消、重放和持久化 | 完整覆盖及跨存储事务原子性尚未证明 |
| 统一策略与模型治理 | 草稿、发布版本、Shadow、回滚、决策解释；区域与数据等级约束 | 草稿与不可变版本已通过 SQLite/PostgreSQL canonical gateway API 和真实浏览器联调；历史可载入为新草稿但不是发布；仍缺发布、回滚、在线 Shadow 与模型治理约束，不以离线仿真替代 |
| MCP 工具治理 | 风险分级、审批、短期授权、Kill Switch、结果审计 | 按产品规划继续实现；不得将占位页面视作已交付 |
| Relay 独立面板 | 序列化到真实网关、转发、SSE、日志、费用、授权与撤权一致 | 本地 SQLite 和双 PostgreSQL API/正常重启/停机恢复验收已通过；浏览器、外部凭据、真实供应商与生产验收另计 |
| 上游与独立面板集成 | 对最终 SHA 的 Go、面板测试、类型检查及发布构建 | 保留 `panel/`、安全插件与控制面集成，静态嵌入资产需与发布构建一致 |

原始 Must、Should、Could 和明确延期事项仍以产品规划为准；
本文不擅自将未完成 Must 降为可选。

## 路由草稿验证后续项

- parent 为 `826067def`，source 为功能验收门 4，reason 为草稿增量提交时
  Go 测试中断且缺少注册路由回归。具体 API 与边界见
  [路由策略草稿](routing-drafts.md)。
- 2026-10-30 的只读复核发现嵌套 fallback 自定义解码会忽略未知字段，
  原始草稿 JSON 可能携带非法字段落库；后续修复在草稿入口严格校验
  对象字段，保持上游字符串/对象解析不变，不修改共享上游解码器。
- 新增测试覆盖全部草稿注册路由的鉴权、Origin、媒体类型、分页、UUID、
  revision、审计失败原子回滚、安全错误和数据库关闭重开；server 回归核对
  真实编译器拒绝非法 POST/PUT 后草稿、审计及活动规则不变。
- 独立只读复核为 `PASS_SCOPED`，仅代表源码复核。2026-10-30 使用
  Go 1.27.3、`-mod=readonly -vet=off -p 1 -count=1` 的定向运行通过：
  handlers `^TestValidateRoutingDraft`、SQLite controlplane 及 server
  `^TestRouting(Draft|Simulation)`；该修复尚未部署。
- PostgreSQL 首轮发现时间戳 `Location` 的整结构比较误报，已将测试改为
  UTC 归一化后严格比较全部字段。随后使用当前重建的 canonical gateway，
  SQLite 与 PostgreSQL 18 的完整 runtime acceptance 均通过，并确认临时
  存储与进程清理完成。
  此前中断的命令不计通过；后续 `TestRoutingDraft*` 私有 PostgreSQL
  定向测试和 controlplane、handlers、server 三包 `go vet` 已正常退出通过。
- `b508f90e7` 后又尝试默认启用 vet 的控制面 `^TestRoutingDraft`
  定向命令；进程采样和子进程检查确认仍在运行 vet，尚无测试结果时
  显式中断，退出码 130。该次不计通过，也不据此认定业务测试失败；
  后续完成的定向测试与独立 vet 结果才计为通过，不将此次中断当作失败或成功。
- 管理员草稿校验 benchmark：Apple M4、`GOMAXPROCS=2`，
  `43848 ns/op`、`54065 B/op`、`756 allocs/op`。这不是推理路径基准；
  校验只发生在管理员保存草稿时，不给推理请求增加 hook 或缓存。
- 草稿 API 后续项为本地 Native 单 writer、中风险、一名只读复核者。
  不引入推理 hook 或请求缓存；SQL/编译仅用于管理员草稿操作。
  面板接入已在 `b508f90e7` 提交推送：新增分页 CRUD、revision 冲突保留、
  未确认写入锁和认证代次隔离的 SPA 编辑恢复，独立复核 `PASS_SCOPED`。
  草稿 API 已在当前重建 gateway 上完成 SQLite 与 PostgreSQL 18 隔离运行验收；
  浏览器也已通过两种存储的真实网关联调。证据仍是本地验收，不等于部署、
  生产 TLS/SSE/WebSocket、真实供应商或发布回滚验收。
  发布版本、Shadow、回滚、模型治理约束及原生产上线目标保持未完成。
- 本次增量只增加运行验收脚本、修复已加载草稿的选择器名称/revision 显示，
  并补回归断言和文档；Native 单 writer、低风险、external=0。
  面板和 canonical CLI 已重新构建；最终本地二进制 SHA-256 为
  `dbf4f308d80505ee1b9921854d6872f629baf8df2895c84fef2dde11fd3ce557`，
  不视作已发布镜像或生产验收。

## 路由版本历史验收后续项

- follow-up `routing-version-history-live`：parent 为 `d4a4be649`，source 为功能
  验收门 4，reason 为版本面板重启后的浏览器验收未通过。
  本项 Native 单 writer、低风险、external=0，只修复面板初始化顺序及补充证据，
  不修改 Go、鉴权、上游 API 或推理请求路径，不自动提交、推送或部署。
- 真实重跑确认并非单纯脚本等待不足：版本子组件可能先持有共享 busy，
  导致初始草稿列表请求被跳过且不会重试。现改为草稿列表初始化结束后再
  自动读取版本；脚本等待选择器真正启用并包含目标选项，不延长超时。
- 同一重建面板已分别通过 SQLite 和 PostgreSQL 18 浏览器完整流程：
  固定修订响应丢失重试、确认覆盖后保存为新草稿、网关/数据库重启、
  会话保留、源草稿删除后历史可载入，活动规则完整对账不变。
  1440/375/812 亮暗主题无页面横向溢出，页面异常均为 0，临时存储和进程正常清理。
- 本地修复后的面板全量回归为 371 单测、2229 断言及 1 代理集成测试
  （12 断言）；Svelte 零错误/警告，生产构建通过。SQLite 与 PostgreSQL
  API/runtime 契约均已复跑通过，覆盖并发 capture、幂等 replay、审计、重启与源删除；
  两种存储的浏览器运行也是本次新增证据。
- 独立 preview 联调通过后，从当前 `d4a4be649` 加本地修复重建 canonical CLI，
  `vcs.modified=true`；两种存储的完整浏览器流程又直接通过网关嵌入 UI 复跑，
  未使用 Vite/proxy，入口 HTML 与当前面板构建哈希一致。
  这仍是本地二进制，不是已发布镜像。哈希、报告路径、版本 API、内存和存储边界见
  [路由策略草稿与版本](routing-drafts.md#immutable-version-snapshots)。
  已完成的不可变快照不等于发布版本；发布、Shadow、回滚及原生产交付门保持未闭合。

## 本地 Relay 运行验收

执行入口和环境边界见 [panel/README.md](../../panel/README.md)。
`bun run --cwd panel test:relay-runtime` 必须指定本次源码构建的
`ELYGATE_TEST_BINARY`，缺少二进制直接失败，不跳过。

本次已用真实 Bootstrap、生产路由、生产插件和隔离 SQLite 完成通过运行，
后续候选仍须重跑。该测试通过面板的实际序列化与导出函数验收，
而不是 mock 网关响应。
本地上游复用现有 Relay fixture；不继承宿主供应商凭据，
不连接现有数据库，不运行付费调用，不发布或部署。

## 本地 PostgreSQL Relay 恢复验收

后续项 `relay-postgres-recovery` 承接已推送 `9635d01a3` 的 Relay 运行验收，
来源为本清单交付门 3、7 的 PostgreSQL/恢复证据缺口。范围仅为本地测试与文档，
Native、root 单 writer、低风险、external=0；不改生产 Go、鉴权或推理请求路径。
本增量不涉及部署，原产品目标仍为 active / PARTIAL。

- 复核标准 CLI 的 SHA-256 与上列相同，Go 源码/依赖自构建基线
  `e6b14def5` 到 `9635d01a3` 无变化。没有将旧包装程序视作标准 CLI，
  也没有将此次本地复用制品视作最终候选发布构建。
- PostgreSQL 18.4 私有集群只监听权限 0700 的 Unix socket，拒绝 host 认证；
  `fsync`、`synchronous_commit`、`full_page_writes` 为 on。
  config/log 各用一个新库，实际连接与无 SQLite fallback 均经过断言。
- 完整 Relay API 生命周期、SSE、统计、费用、CSV、Key 轮换/过期/撤销通过。
  正常停止并重启 PostgreSQL 与网关后，不重新登录仍能读取原会话、配置、
  Key 元数据、审计和日志；已过期绑定在启动时补记撤销是明确的预期变化，
  其余字段仍严格对账，不通过删去整行比较来忽略数据丢失。
- 网关停机、两库连接池关闭后，用真实 `pg_dump`/`pg_restore` 将两个完整库
  恢复到不同的新库。启动前逐一对账所有 public 表的行数/内容指纹及序列状态。
  应用目录从备份复制，配置仅切换恢复目标；本地 uploads 探针字节一致，
  不外推为 Skills/上传 API 全生命周期验收。
- 恢复后的标准网关保留管理员会话与审计、读取/导出日志，并以原可用 Key
  成功转发；旧轮换值、过期及撤销 Key 均 401，拒绝请求的上游命中数为零。
  新项目/应用/Key 创建、grant、真实转发和后续绑定撤销通过。
  恢复实例读写之后，两个原库的全部行与序列指纹仍保持不变。
- 最终源码专项 `1 pass / 0 fail`（86.36 秒），前一完整运行亦通过。
  成功要求四个私有数据库删除、PostgreSQL/网关/上游子进程正常退出，
  以及含 dump、应用备份与探针的整个临时目录删除。
  结果日志为 `.codex-tmp/relay-postgres-recovery-20261030-verified.log`。
- 初次静态快照断言误将启动过期清理视作数据丢失，已改为明确验证该变更。
  一次初始化因外置卷 I/O 争用超时，没有进入业务验收，不计为通过；
  失败初始化不再错误地要求不存在的服务执行 DROP DATABASE。

这关闭的是本地 Relay 双库正常重启与停机逻辑恢复缺口；没有验证加密密钥恢复、
密码/TLS、真实供应商费用、其他产品工作流、崩溃/掉电、版本升级回滚、完整整机
恢复或生产部署。生产交付门 7、8 仍未整体完成，不能据此批准切换。

## 生产交付门

### 单机模板镜像固定检查（2026-10-31）

后续项 `single-node-postgres-image-pin`：parent 为 `edc1a1c08`，source 为交付门 2，
reason 为模板仍使用可漂移的数据库标签。Native、root 单 writer、低风险、
external=0；仅修改模板和记录，不涉及生产写入、部署或推理路径。

`examples/single-node-postgres/docker-compose.yml` 现将 PostgreSQL 固定为
`postgres:16-alpine@sha256:16bc17c64a573ef34162af9298258d1aec548232985b33ed7b1eac33ba35c229`。
Docker registry manifest 查询确认该 digest 对应多架构镜像，Compose 配置解析、
健康依赖、持久化卷、只读配置挂载及六项必填环境变量缺失拒绝均通过。
本机 OrbStack/Docker daemon 当前不可用，因此没有把实际镜像构建、启动、健康检查
或非 root 运行误报为已完成；`ELYGATE_IMAGE` 仍必须由部署环境提供最终固定 digest。

1. 固定最终代码 SHA、Bun/Go 工具链、平台架构、镜像 digest 和校验和。
   对最终镜像进行实际构建、启动、非 root 权限和健康检查。
2. 使用 [单机 PostgreSQL 模板](../../examples/single-node-postgres/docker-compose.yml)
   审阅脱敏配置。替换所有占位符；数据库与网关都固定镜像版本。
   密钥由部署环境注入，禁止将 `.env`、dump、连接串或 Cookie 纳入提交和日志。
3. 在隔离目标完成全新安装和数据库迁移。记录配置库与日志库的实际后端，
   `/health` 必须通过已配置存储检查，不以进程仍在运行为成功。
4. 验证首次管理员设置、匿名管理请求拒绝、真实登录与退出、
   Origin、Application Key 和选定策略模式。
   `ELYGATE_APPLICATION_BINDING_MODE=required` 不等于强制所有请求携带 Key，
   还需独立核实上游 inference authentication 配置。
5. 核实反向代理 TLS、SSE 不缓冲和 WebSocket 升级；
   只有经过审阅的入口可对外开放。配置日志保留、磁盘监控与告警。
6. 使用测试账户验证真实模型、MCP、Relay、预算告警、审计和账本；
   记录测试数据归属和清理，不向生产业务数据注入合成记录。
7. 对配置库、原始日志库、配置文件、上传文件和必要密钥材料建立一致备份。
   在独立数据库/目录恢复并对账 Key 绑定、用量与审计，再证明恢复后可写。
   局部控制面数据库恢复不等于整机恢复。
8. 演练升级和回滚。记录旧镜像 digest、迁移版本、备份时间点及回滚条件；
   有不兼容迁移时，不能只回退镜像。不可在唯一生产库上试验恢复。
9. 生产切换前重新确认目标、窗口、回滚负责人和显式授权。
   准备工作、测试通过或旧部署记录均不构成新的生产写入授权。

只有最终候选的全部必需证据已归档、所有阻断项已解决，
才能将此清单改为可发布；本地通过、CI 通过、镜像通过和生产验收是不同边界。
