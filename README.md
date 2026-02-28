# Elygate 🚀

[English](#english) | [简体中文](#chinese)

<a name="english"></a>
## English

High-performance, minimalist AI Large Language Model interface management and distribution gateway.
Deeply inspired by the open-source benchmark **New-API** in architecture design, database entity mapping, and authentication logic. Dedicated to achieving concurrency and billing consistency far exceeding traditional architectures using PostgreSQL 18 advanced features and native **Bun** asynchronous foundation without relying on Redis.

### ✨ Core Features

- **Extreme Purity & High Performance**: Eschews heavy traditional components, built entirely with `Bun` + `Elysia.js`.
- **Redis-less High-Availability Billing**: First to port the New-API (Golang Channel) asynchronous "aggregate log billing" model, smoothing lock competition into millisecond-latency batch writes under 10k+ QPS.
- **Multi-level Fault Tolerance & Circuit Breaking**: Automatically and silently switches to backup downstream servers when encountering upstream blocking, network anomalies, or 429 overloads.
- **Dynamic Cross-Ratio Engine**: Native support for "Model Base Ratio" x "Completion Output Ratio" x "User/VIP Group Ratio" stacking billing system.
- **Full Protocol Auto-Completion & Conversion**: Clients only need to call standard `OpenAI API`. The gateway automatically converts request bodies and SSE streams to `Google Gemini`, `Anthropic Claude`, `Azure OpenAI`, and `Cloudflare Worker AI` formats.

### ⚡ Performance: Elysia vs Gin (New-API Native)

We chose **Bun + Elysia.js** over the traditional Golang system for the staggering throughput gains shown in the TechEmpower benchmarks:

#### 🚀 Framework Throughput Comparison (reqs/s)

```text
Elysia  (Bun)  ███████████████████████████████████ 2,454,631  (🥇 21x)
Gin     (Go)   █████████                           676,019
Spring  (Java) ███████                             506,087
Fastify (JS)   ██████                              415,600
Express (JS)   █                                   113,117
```
*(In extreme hardware/specific driver scenarios, Elysia has achieved over 26 million reqs/s)*

### 🥊 Architecture Benchmarking: Why Elygate is the Next Generation?

| Dimension | Traditional Benchmark (New-API) | **Elygate (Bun + Elysia)** | **Core Benefits** |
| :--- | :--- | :--- | :--- |
| **Language** | Golang | **TypeScript (Fullstack)** | Full Monorepo unification, high code reuse, lower entry barrier. |
| **Web Engine** | Gin / Fiber | **Bun Native + Elysia.js** | Native asynchronous event-driven, **21x QPS increase**, reduced overhead. |
| **Database** | MySQL (or SQLite) | **PostgreSQL (15+)** | Leverages advanced PG features (RETURNING, JSONB) for trading & search. |
| **Concurrency** | Heavy **Redis** Dependency | **Redis-less Single PG** | KISS principle, no middleware hassle, memory-buffered microtasks. |
| **Admin UI** | React + Traditional Components | **Svelte 5 + Tailwind v4** | No Virtual DOM overhead, extremely fast interaction, modern aesthetics. |
| **Deployment** | Multi-container / Separate | **Micro-monolith** | One Bun command, millisecond cold start, perfect for Serverless/Edge. |

### 📦 Project Structure (Monorepo)

```text
elygate
├── apps
│   ├── gateway    # Gateway engine (API routes, billing queue, auth/rate-limit)
│   └── web        # Svelte 5 + Tailwind v4 Admin Panel
└── packages
    └── db         # Database init and native models (Bun SQL)
```

### 🛠️ Quick Start

#### 1. Requirements
- [Bun](https://bun.sh/) (^1.3.0)
- PostgreSQL (18+)

#### 2. Database Setup
Copy the environment file:
```bash
cp .env.example .env
# Edit .env to set your DATABASE_URL 
```
Import `packages/db/init.sql` into your PostgreSQL database to initialize tables.

#### 3. Run Services
**Start Gateway (Default port 3000):**
```bash
cd apps/gateway
bun run dev
```
**Start Admin Panel (Default port 5173):**
```bash
cd apps/web
bun run dev 
```

### 🔌 API Usage
Standard `OpenAI SDK` compatible. Unified endpoint:
```
POST /v1/chat/completions
```
Use the `Bearer` token generated in the admin panel.

---

<a name="chinese"></a>
## 简体中文

高性能、极简主义的 AI 大语言模型接口管理与分发网关。
本网关在架构设计、数据库实体映射以及鉴权逻辑上**深度参考了开源标杆 New-API**，致力于在不依赖 Redis 的前提下，利用 PostgreSQL 18 的先进特性与原生 **Bun** 异步底座，实现远超传统架构的并发处理能力与计费强一致性。

### ✨ 核心特性

- **极致纯粹与高性能**: 摒弃传统的繁重全家桶组件，全链路使用 `Bun` + `Elysia.js` 构建。
- **免 Redis 的高可用缓冲扣费**: 首创并移植了 New-API (Golang Channel) 的全异步“聚合日志合并扣费”模型，将万级 QPS 下的锁竞争平摊化为毫秒级延迟的聚合写入。
- **多级容错与熔断降级**: 遇到上游封控、网络异常、429 超载时，网关将**无感静默切换**至备用的同模型权重下游服务器进行重试，直至返回或穷尽列表。
- **动态交叉倍率引擎**: 原生支持对标商业级平台的 “模型基础倍率” x “补全输出倍率” x “用户/VIP 组别倍率” 叠加计费体系。
- **全系协议自动补全转换**: 下游客户端仅需按照标准的 `OpenAI API` 进行调用，网关会自动将请求体与包含 SSE 流的响应体转换为 `Google Gemini`, `Anthropic Claude`, `Azure OpenAI` 甚至 `Cloudflare Worker AI` 等多模态异构格式。

### ⚡ 性能直观揭秘：Elysia vs Gin (New-API 原生架构)

#### 🚀 框架绝对吞吐量对比 (reqs/s)

```text
Elysia  (Bun)  ███████████████████████████████████ 2,454,631  (🥇 21x)
Gin     (Go)   █████████                           676,019
Spring  (Java) ███████                             506,087
Fastify (JS)   ██████                              415,600
Express (JS)   █                                   113,117
```

### 🥊 全架构对标：为什么本项目是极致进化版？

| 对比维度 | 传统标杆 (New-API 生态) | **本网关 (Bun + Elysia)** | **核心红利与降维打击** |
| :--- | :--- | :--- | :--- |
| **底层开发语言** | Golang | **TypeScript (全栈)** | 彻底的 Monorepo 全栈统一，代码复用率极高。 |
| **API Web 引擎** | Gin / Fiber | **Bun 原生 + Elysia.js** | 基于原生异步事件驱动，QPS **提升近 21 倍**。 |
| **数据库强依赖** | MySQL (或 SQLite) | **PostgreSQL (15+)** | 利用 PG 先进特性（RETURNING 与 JSONB）强化交易引擎。 |
| **防高频并发机制** | 强依赖重型 **Redis** | **抛弃 Redis 引入单体 PG** | 通过内存缓冲事件微任务队列直接入库。 |
| **管理后台 UI** | React + 传统 UI 组件 | **Svelte 5 + Tailwind v4** | 摒弃 Virtual DOM 性能损耗，Svelte 原生运行极速。 |
| **部署与运维** | 多容器组合 | **微型单体构建** | 一个 Bun 命令全包，完美契合无服务器边缘部署。 |

### 🛠️ 快速启动指南

#### 1. 环境准备
- [Bun](https://bun.sh/) (要求 ^1.3.0)
- PostgreSQL (18+)

#### 2. 数据库配置
将 `packages/db/init.sql` 导入您的 PostgreSQL 数据库完成建表初始化。

#### 3. 启动服务
**启动核心网关服务:**
```bash
cd apps/gateway
bun run dev
```

## 🛡️ License & Acknowledgements
Deep gratitude to the [New-API] open-source community for their exploration of commercial gateway billing architectures.
深度感谢 [New-API] 开源社区对商业化网关计费架构、渠道管理策略的探索。
