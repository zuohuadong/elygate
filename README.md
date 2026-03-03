# Elygate 🚀

[English](#english) | [简体中文](#chinese)

---

<a name="english"></a>
## English

**High-performance, Redis-less AI Gateway. Build on Bun + PostgreSQL 18.**

### 📦 Quick Start (Docker Compose) - Recommended

Launch the entire stack (Database, Gateway, and Web UI) with one command.

#### 1. Configuration
```bash
git clone https://github.com/zuohuadong/elygate.git && cd elygate
cp .env.example .env
```

#### 2. Run (Pre-built Images)
By default, this pulls images from `ghcr.io`. 
*Note: If you are in Mainland China, see the Chinese README for mirror acceleration.*

```bash
# Download the lightweight production compose file
curl -O https://raw.githubusercontent.com/zuohuadong/elygate/main/docker-compose.prod.yml

# Check and restore "ghcr.io" if it was changed to a mirror
sed -i 's/ghcr.nju.edu.cn/ghcr.io/g' docker-compose.prod.yml

# Run the stack
docker compose -f docker-compose.prod.yml up -d
```

#### 3. Access
| Service | URL | Default Credentials |
| :--- | :--- | :--- |
| **Admin Panel** | [http://localhost:3001](http://localhost:3001) | `admin` / `admin123` |
| **API Endpoint** | [http://localhost:3000](http://localhost:3000) | Generate keys in Admin |
| **Postgres** | `localhost:5432` | `root` / `password` |

---

### ⚡ Zero-Dependency Binary (Easiest)

Inspired by New-API, Elygate provides pre-compiled single-file binaries. No Node.js, Bun, or Docker required.

1. **Download**: Go to [Releases](../../releases) and download the binary for your OS.
2. **Configure**: Create a `.env` file with your `DATABASE_URL`.
3. **Run**:
   - **Linux / macOS**:
     ```bash
     chmod +x elygate-linux-amd64
     ./elygate-linux-amd64
     ```
   - **Windows**:
     ```cmd
     elygate-bun-windows-x64.exe
     ```
   *The binary embeds both the Gateway API engine and the Svelte Admin Panel.*

---

### 🚀 Manual Production Deployment (Bare Metal)

For high-performance production use without Docker:

1. **Build & Start All**:
   ```bash
   bun run build
   bun run start
   ```
   *This command leverages the root `package.json` to concurrently launch both the Gateway and Web UI in production mode.*

---

### 💻 Manual Installation (Development)

If you prefer to run services manually on your host machine:

1. **Install Dependencies**:
   ```bash
   bun install
   ```

2. **Setup Database**:
   - Ensure PostgreSQL 15+ is running.
   - Run `packages/db/src/init.sql` to initialize schema.
   - Configure `DATABASE_URL` in `.env`.

3. **One-Command Dev**:
   ```bash
   bun run dev
   ```
   *Simultaneously runs Gateway (port 3000) and Admin Panel (port 5173).*

---

### ⚡ Performance Comparison

We chose **Bun + Elysia.js** for its exceptional throughput. While Gin is highly efficient, Elysia leverages Bun's native asynchronous I/O to push boundaries.

#### 🚀 Framework Throughput (reqs/s)

```text
Elysia  (Bun)  ███████████████████████████████████ 2,454,631  (🥇 3.6x vs Gin)
Gin     (Go)   █████████                           676,019
Spring  (Java) ███████                             506,087
Fastify (JS)   ██████                              415,600
Express (JS)   █                                   113,117    (21x slower)
```
*Numbers based on standard TechEmpower-style plaintext benchmarks.*

---

### 📂 Project Structure (Monorepo)

```text
elygate
├── apps
│   ├── gateway    # Gateway engine (Elysia.js, billing, auth)
│   └── web        # Admin Panel (Svelte 5 + Tailwind 4)
├── packages
│   └── db         # Database schema, init SQL and types
├── Dockerfile.gateway
├── Dockerfile.web
├── Dockerfile.postgres
└── docker-compose.yml
```

---

### ✨ Core Innovations

- **🚀 Bun-Native Engine**: Massive throughput improvement over traditional JS/Go stacks.
- **🧠 Semantic Cache**: Integrated vector similarity search to deduplicate requests.
- **💾 O(1) Billing**: Atomic batch processing eliminating SQL lock contention.
- **📊 Auto-Maintenance**: Built-in cron jobs for partition rotation and cleanup.
- **🛡️ Apache 2.0**: Open-source and enterprise-ready.

---

<a name="chinese"></a>
## 简体中文

**高性能、无 Redis 依赖的 AI 分发网关与计费系统。基于 Bun + PostgreSQL 18。**

### 📦 快速部署 (Docker Compose) - 推荐

只需简单几步，即可一键启动全栈环境。

#### 1. 环境准备
```bash
git clone https://github.com/zuohuadong/elygate.git && cd elygate
cp .env.example .env
```

#### 2. 一键启动 (预编译镜像部署)

得益于 GitHub Actions，您**无需在服务器编译**即可极速拉取并启动应用。

**对于国内服务器（默认已开启南京大学 GHCR 镜像加速）：**
```bash
# 下载专为线上优化的轻量级编排文件
curl -O https://raw.githubusercontent.com/zuohuadong/elygate/main/docker-compose.prod.yml

# 一键启动（享受国内镜像高速拉取）
docker compose -f docker-compose.prod.yml up -d
```

**对于海外服务器（需要换回官方源）：**
```bash
curl -O https://raw.githubusercontent.com/zuohuadong/elygate/main/docker-compose.prod.yml
sed -i 's/ghcr.nju.edu.cn/ghcr.io/g' docker-compose.prod.yml
docker compose -f docker-compose.prod.yml up -d
```

#### 3. 服务看板
| 服务 | 访问地址 | 默认凭据 |
| :--- | :--- | :--- |
| **管理后台 (Web)** | [http://localhost:3001](http://localhost:3001) | `admin` / `admin123` |
| **分发网关 (API)** | [http://localhost:3000](http://localhost:3000) | 使用后台生成的 sk- 密钥 |
| **数据库 (DB)** | `localhost:5432` | `root` / `password` |

---

### ⚡ 单文件预编译包部署 (极简无依赖)

致敬 New-API，Elygate 在 Release 页面提供了包含了网关接口与 Svelte 后台的**跨平台单体二进制文件**。您不需要安装 Docker、Bun 或 Node.js 也能直接运行。

1. **下载**: 访问 [Releases](../../releases) 页面，下载对应您的操作系统的文件。
2. **配置**: 准备好 PostgreSQL 并同级目录下创建 `.env` 配置 `DATABASE_URL`。
3. **运行**:
   - **Linux / Mac**:
     ```bash
     chmod +x elygate-linux-amd64
     ./elygate-linux-amd64
     ```
   - **Windows**:
     直接双击运行下载好的 `.exe` 软件，或通过 CMD 执行：
     ```cmd
     elygate-bun-windows-x64.exe
     ```

---

### 🚀 手动生产部署 (宿主机源代码运行)

如果您希望在宿主机以最佳性能运行（非 Docker 环境）：

1. **一键构建与启动**:
   ```bash
   bun run build
   bun run start
   ```
   *该命令将通过根目录脚本并行启动网关与管理后台，并自动开启生产模式 (NODE_ENV=production)。*

---

### 💻 手动安装 (开发模式)

如果您希望在宿主机手动运行各项服务：

1. **安装依赖**:
   ```bash
   bun install
   ```

2. **数据库准备**:
   - 确保已安装 PostgreSQL 15+。
   - 执行 `packages/db/src/init.sql` 初始化表结构。
   - 在 `.env` 中正确配置 `DATABASE_URL`。

3. **一键开发启动**:
   ```bash
   bun run dev
   ```
   *同时启动网关 (3000端口) 与管理后台 (5173端口)，支持多端热重载。*

---

### ⚡ 性能对比

选择 **Bun + Elysia.js** 是为了追求极致的吞吐量。虽然 Go (Gin) 已经非常高效，但 Elysia 利用 Bun 的原生异步 I/O 将 Web 性能提升到了新的高度。

#### 🚀 框架绝对吞吐量对比 (reqs/s)

```text
Elysia  (Bun)  ███████████████████████████████████ 2,454,631  (🥇 3.6倍于 Gin)
Gin     (Go)   █████████                           676,019
Spring  (Java) ███████                             506,087
Fastify (JS)   ██████                              415,600
Express (JS)   █                                   113,117    (慢 21 倍)
```

---

### 📂 项目目录结构 (Monorepo)

```text
elygate
├── apps
│   ├── gateway    # 网关核心引擎 (Elysia.js, 计费, 鉴权)
│   └── web        # 管理后台 (Svelte 5 + Tailwind 4)
├── packages
│   └── db         # 数据库 Schema, 初始化 SQL 及类型定义
├── Dockerfile.gateway
├── Dockerfile.web
├── Dockerfile.postgres
└── docker-compose.yml
```

---

### 🛠️ 核心优势

- **🚀 Bun 原生性能**: 相比传统 Node.js/Go 架构有显著吞吐量提升。
- **🧠 语义缓存**: 内置 `pgvector` 相似度检索，大幅降低上游 Token 消耗。
- **💾 O(1) 合并计费**: 通过批量原子 SQL 彻底解决高并发下的数据库竞争。
- **📊 全自动运维**: 通过 `pg_cron` 原生支持日志自动分区与缓存定期清理。
- **🛡️ Apache 2.0**: 协议友好，支持商业化二次开发。

### 🧩 语义缓存动态配置
语义缓存默认开启，支持在数据库 `options` 表中实时调整：
```sql
-- 调整相似度阈值 (默认 0.95，越高越严格)
INSERT INTO options (key, value) VALUES ('SemanticCacheThreshold', '0.96')
ON CONFLICT (key) DO UPDATE SET value = '0.96';
```

## 🛡️ License & Acknowledgements
Deep gratitude to the [New-API] community for their pioneering exploration.
项目基于 Apache 2.0 协议开源，部分设计思路致敬 New-API 及其开源生态。
