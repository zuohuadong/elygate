# 最终架构方案：极简主义 (Bun + Postgres + CF Worker)

您的两个判断非常精准：
1.  **Gemini 代理**：用 Cloudflare Workers 做一层透明代理确实是最简单、低成本且稳健的方案，解决了国内服务器访问 Google/OpenAI 的网络问题。
2.  **Postgres 替代 Redis**：完全可行。PostgreSQL (尤其是配合新特性和正确配置) 在现代硬件上完全可以覆盖 Redis 95% 的使用场景，这符合 **"Just Use Postgres"** 的极简架构趋势。
3.  **前端全栈 Svelte**：摒弃 Refine/React，使用 **SvelteKit + Superforms + Shadcn-svelte** 构建统一、高性能的前端系统，并通过 Svelte 5 Runes 封装通用的管理后台逻辑。

---

## 1. 架构核心变更

基于您的反馈，我们移除了 Redis 和 复杂的跨境隧道，采用了 **"单体全能数据库 + 边缘代理"** 的架构。

### 架构拓扑图

```mermaid
graph TD
    User[用户 (Client)] -->|HTTP/SSE| Gateway[国内服务器 (Bun + Elysia)]
    Admin[管理员] -->|SvelteKit SSR| Gateway
    
    subgraph "国内服务器 (Single VPS)"
        Gateway -->|读写/缓存/队列| PG[(PostgreSQL)]
        Gateway -->|本地计算| Logic[鉴权/计费/路由]
    end
    
    subgraph "海外边缘 (Cloudflare)"
        Gateway -->|HTTPS (通过优选IP)| CF_Proxy[CF Worker (代理节点)]
        CF_Proxy -->|原始请求| Upstream_A[Gemini API]
        CF_Proxy -->|原始请求| Upstream_B[AnyRouter]
        CF_Proxy -->|内部调用| Upstream_C[CF Worker AI]
    end
```

---

## 2. 为什么 Postgres 可以替代 Redis？

目前 **PostgreSQL 18.2** 已经发布，结合其强大的性能和以下特性，完全能轻装上阵胜任您的需求：

| Redis 场景 | Postgres 替代方案 | 优势分析 |
| :--- | :--- | :--- |
| **缓存 (Cache)** | **UNLOGGED Tables** | **不写 WAL 日志**，写入速度极快，重启后数据清空（符合缓存特性），减少磁盘 I/O。 |
| **消息队列 (Queue)** | **SKIP LOCKED** | `SELECT ... FOR UPDATE SKIP LOCKED` 允许并发消费不冲突，实现**高性能任务队列** (如异步日志入库)。 |
| **发布订阅 (Pub/Sub)** | **LISTEN / NOTIFY** | 原生支持。当后台更新了 Key 配置，Gateway 能通过此机制毫秒级收到通知，刷新内存。 |
| **键值存储 (KV)** | **HSTORE / JSONB** | 简单的 `Key-Value` 表，配合主键索引，在现代 NVMe SSD 上，单机数十万 QPS 毫无压力。 |
| **分布式锁** | **Advisory Locks** | `pg_advisory_lock` 提供应用层级的锁机制，性能极高且轻量。 |

**结论**：对于 API 批发平台，**Token 计费的准确性 (ACID 事务)** 比极致的并发更重要。Postgres 既能保证钱算不错，又能通过 `UNLOGGED` 表处理高频的限流计数，**省去维护 Redis 的成本，系统复杂度减半**。

---

## 3. 前端架构 (Svelte Admin Kit)

为了在 Svelte 中达到 Refine.dev 的开发效率，我们将封装一套基于 **Runes** 的 "Admin Toolkit"。

### 技术栈组合
*   **框架**: SvelteKit (Svelte 5)
*   **UI 库**: shadcn-svelte (高度可定制)
*   **表单**: Superforms (服务端验证 + 自动回显 + 自动保存)
*   **状态**: Svelte 5 Runes (`$state`, `$derived`, `$effect`)

### 核心封装设计
1.  **TableState (替代 useTable)**:
    *   一个纯 TS 类，利用 `$state` 管理 `page`, `pageSize`, `filters`。
    *   利用 `goto` 自动同步 URL 参数。
    *   提供 `refresh()` 方法重新加载数据。
2.  **FormState (替代 useForm)**:
    *   基于 Superforms 封装。
    *   集成 Zod Schema 校验。
    *   自动处理 Loading 和 Error Toast 提示。
3.  **通用组件**:
    *   `<DataTable />`: 接收 `TableState` 和 `columns` 定义，自动渲染带分页、筛选的表格。
    *   `<CrudLayout />`: 标准的后台页面布局（标题、面包屑、操作栏）。

---

## 4. 项目落地规划 (Monorepo)

我们将使用 **Bun workspaces** 管理所有代码，统一开发体验。

### 目录结构

```text
/ai-api-platform
├── package.json          # Bun Workspaces 配置
├── docker-compose.yml    # 一键启动 Postgres + Gateway
├── .env                  # 环境变量
│
├── apps
│   ├── gateway           # [核心] Bun + Elysia (国内服务器)
│   │   ├── src
│   │   │   ├── services  # 业务逻辑 (上游轮询, 计费)
│   │   │   └── db        # Drizzle ORM (连接 PG)
│   │
│   ├── web               # [前端] SvelteKit + Shadcn + Superforms
│   │   ├── src
│   │   │   ├── lib
│   │   │   │   ├── admin     # [核心] Admin Toolkit (TableState.svelte.ts)
│   │   │   │   └── components # UI 组件
│   │   └── adapter-node  # 编译为 Node/Bun 服务运行
│   │
│   └── proxy             # [代理] Cloudflare Worker (海外节点)
│       └── src           # 简单的 fetch 转发逻辑
│
└── packages
    ├── db                # 共享数据库 Schema (Drizzle)
    └── shared            # 共享类型定义 (TS Interface)
```

---

## 5. 下一步行动

如果您对这个 **"去 Redis 化" + "全栈 Svelte"** 的极简架构满意，我将开始执行以下操作：

1.  **初始化项目**：创建 Monorepo 结构。
2.  **配置数据库**：编写 `packages/db`，定义 User, Key, Log 表，以及用于缓存的 `Unlogged Table`。
3.  **编写 Gateway**：使用 Elysia 实现基础框架。
4.  **编写 Web**：初始化 SvelteKit，安装 shadcn-svelte 和 superforms，并实现 `TableState` 基类。

**请确认是否开始生成代码？**
