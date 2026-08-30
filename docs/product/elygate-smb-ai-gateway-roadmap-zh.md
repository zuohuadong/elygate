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
| Application 与 Virtual Key 绑定 | Implemented | 支持绑定、过期、撤销；未绑定 Key 仍兼容放行 |
| Application Key 生命周期 | Implemented | 支持创建、一次性返回值、显式轮换、显式撤销；Key 变更同步到内存治理状态 |
| 非普通 HTTP 路径绑定校验 | Implemented | WebSocket、WebRTC、MCP、OAuth VK 模式和 Async 已接入 |
| Usage Ledger | Partial | 支持投影、查询、CSV/API 导出；预测、账单周期和重算治理未完整 |
| Control Plane Audit | Partial | 已覆盖当前 Project/Application/Binding mutation；尚未覆盖所有管理员资源 |
| 企业身份 | Partial | 本地管理员和员工体系可用；OIDC 后续实现，LDAP/SCIM 暂不做 |
| 统一策略中心 | Partial | 已有 CEL 路由、预算、限流和安全插件；缺统一版本、发布、回滚和仿真 |
| 模型能力目录 | Partial | 已有模型、价格和扩展属性；区域、数据等级和健康策略未形成闭环 |
| Guardrail / DLP | Partial | 插件基础存在；未证明覆盖所有流式、多模态、文件和工具结果 |
| Capability / Gatekeeper | Not implemented | 保留为后续工具写操作治理，不进入首版阻塞项 |
| Kubernetes / 多节点 HA | Out of scope | 当前产品主线明确不验收 |

结论：**尚未全部实现。** 当前已完成可用的控制面第一条垂直闭环，但不能宣称完整企业治理平台已经交付。

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
