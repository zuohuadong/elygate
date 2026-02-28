# AI API 批发平台 - 产品需求文档 (PRD)

## 1. 项目概述 (Project Overview)

### 1.1 背景
本项目旨在构建一个高性能、高可用的 AI API 聚合与批发平台。通过整合多个上游 API 资源（Grsai, Gemini, Cloudflare Worker AI, AnyRouter, 字节系 AI 等），对外提供统一的 OpenAI 兼容接口。平台需具备多渠道轮询、故障转移、密钥管理及计费功能。

### 1.2 核心价值
- **统一接入**：下游用户仅需通过一个接口即可访问多种模型。
- **成本优化**：利用免费/低价资源（如 Gemini Free, CF Worker AI）进行混合调度，降低成本。
- **高可用性**：通过轮询和自动重试机制，确保服务稳定性。

---

## 2. 技术架构与选型评估 (Architecture & Evaluation)

### 2.1 最终架构决策：混合模式 (Hybrid)
采用 **"国内服务器 (Bun + Postgres) + 海外边缘 (CF Worker)"** 的模式。
*   **Gateway (国内)**: 处理用户请求、鉴权、计费、流式响应转发。
*   **Proxy (海外)**: 利用 Cloudflare Workers 作为透明代理，解决网络连通性问题。
*   **Database**: 单体 PostgreSQL (v18+)，利用 `UNLOGGED Tables` 替代 Redis 缓存，利用 `SKIP LOCKED` 实现消息队列。

### 2.2 前端技术栈 (Svelte Admin Kit)
为了兼顾开发效率（媲美 Refine.dev）和极致性能，前端采用全栈 Svelte 方案：
*   **框架**: **SvelteKit** (SSR + API Routes)
*   **UI 组件库**: **shadcn-svelte** (高度可定制)
*   **表单管理**: **Superforms** (服务端验证 + 自动回显 + 自动保存)
*   **状态管理**: **Svelte 5 Runes** (封装 `TableState` 和 `FormState` 类)

---

## 3. 功能需求 (Functional Requirements)

### 3.1 核心网关功能 (Core Gateway)
1.  **统一接口**：兼容 OpenAI `v1/chat/completions` 格式。
2.  **多路路由 (Multi-Route Dispatch)**：
    *   根据模型名称 (Model ID) 路由到不同上游。
    *   支持 `gpt-4`, `claude-3`, `gemini-pro`, `llama-3` 等映射。
3.  **上游集成 (Upstream Integrations)**：
    *   **Grsai** & **AnyRouter**：直接 HTTP 代理转发。
    *   **Gemini API**：
        *   **Key 轮换池**：维护多个免费版 Key，请求时随机/轮询选择。
        *   **错误重试**：遇到 429 (Rate Limit) 自动切换下一个 Key 重试。
    *   **Cloudflare Worker AI**：
        *   内部调用 CF AI 模型 (如 Llama-3)。
        *   需封装为 OpenAI 格式。
    *   **字节 Coze/Doubao**：
        *   签名适配与格式转换。
4.  **流式响应处理 (SSE Handling)**：
    *   确保所有上游的流式响应能正确透传并转换为标准 OpenAI SSE 格式 (参考提供的代码示例)。

### 3.2 平台管理功能 (Management Platform)
1.  **用户系统**：
    *   注册/登录 (邮箱 + 密码/验证码)。
    *   GitHub/Google OAuth (可选，通过 Supabase Auth)。
2.  **令牌管理 (Key Management)**：
    *   用户创建 API Key (`sk-xxxx`).
    *   设置 Key 的额度、过期时间。
3.  **计费与配额 (Billing & Quota)**：
    *   **模型倍率**：不同模型设置不同倍率 (如 Gemini Free = 0, GPT-4 = 1.0)。
    *   **日志记录**：记录每次请求的 Token 消耗 (Prompt + Completion)。
    *   **充值系统**：兑换码机制 (卡密) 或 在线支付 (集成 Stripe/易支付)。

### 3.3 管理员后台 (Admin Dashboard)
1.  **渠道管理**：添加/编辑上游渠道配置 (API Host, Key 池, 权重)。
2.  **用户管理**：封禁用户，查看余额。
3.  **系统监控**：查看各渠道成功率、延迟、QPS。

---

## 4. 详细设计规范 (Detailed Specs)

### 4.1 目录结构 (Monorepo)
```text
apps/
  ├── web/             # SvelteKit + Shadcn + Superforms (前端)
  ├── gateway/         # Bun + Elysia (网关 + 业务逻辑)
  └── proxy-worker/    # Cloudflare Worker (海外代理)
packages/
  ├── shared/          # 共享类型定义, 工具函数
  └── db/              # 数据库 Schema (Drizzle ORM)
```

### 4.2 关键数据结构 (TS Interface)

```typescript
// 上游渠道配置
interface ChannelConfig {
  id: string;
  type: 'openai' | 'gemini' | 'cf-ai' | 'azure';
  endpoint: string;
  keys: string[]; // 轮询密钥池
  models: string[]; // 支持的模型列表
  weight: number; // 负载权重
}

// 路由映射
interface RouteMap {
  [modelName: string]: string[]; // model -> channel_ids
}
```

## 5. 开发计划 (Roadmap)

1.  **Phase 1: 原型验证**
    *   搭建 Monorepo。
    *   实现 Gateway 基础转发 (Gemini + AnyRouter)。
    *   实现 Gemini Key 轮换。
2.  **Phase 2: 核心业务**
    *   设计数据库 Schema (User, Key, Log, Channel)。
    *   实现 API Key 验证与简单的鉴权中间件。
    *   完成 CF Worker AI 的适配。
3.  **Phase 3: Admin Toolkit & 面板**
    *   封装前端基建: `TableState` (Runes) 和 `FormState` (Superforms)。
    *   开发 Svelte 用户面板与管理员后台。
    *   实现 Token 计费逻辑。
4.  **Phase 4: 优化与发布**
    *   配置 Postgres 性能调优 (`UNLOGGED` 表)。
    *   压力测试与生产环境部署。

---

## 6. 商业策略与高级特性实现 (Business & Advanced Features)

### 6.1 低价策略实现 (Grsai 模式复刻)
*   **混合调度 (Mixed Scheduling)**: 利用 `Router` 智能分发请求。优先使用免费/低价渠道（如 Gemini Free, Coze 逆向, CF Worker AI），在失败或高负载时回退到付费渠道。
*   **资源池化 (Pooling)**: 采购企业级/Team 账号构建 Key 池，通过高并发复用分摊单 Key 成本。
*   **逆向工程集成**: 预留接口适配 GitHub Copilot、Coze 等非标准协议的低价渠道。

### 6.2 PostgreSQL 高级特性应用
*   **缓存层 (Replacing Redis)**:
    *   使用 `UNLOGGED Tables` 存储高频变动的 Rate Limit 计数器和临时 Token 状态，牺牲持久化换取极致写入性能。
*   **消息队列 (Task Queue)**:
    *   利用 `SELECT ... FOR UPDATE SKIP LOCKED` 实现高并发下的异步任务处理（如日志入库、充值回调），确保无锁竞争且不丢失任务。
*   **实时通知 (Realtime)**:
    *   使用 `LISTEN / NOTIFY` 机制，当管理员在后台更新渠道配置时，毫秒级通知 Gateway 刷新内存缓存，无需轮询数据库。
*   **JSONB 灵活性**:
    *   使用 `JSONB` 字段存储复杂的渠道配置（如不同渠道的特殊 Header、各种自定义参数），利用 GIN 索引保持查询性能。
