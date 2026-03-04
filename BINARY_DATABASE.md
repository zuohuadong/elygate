# Elygate Binary Deployment Guide | Elygate 二进制部署指南

[English](#english) | [中文](#中文)

---

<a name="english"></a>

## English

### 📦 Binary File Database Connection

The Elygate binary file connects to the database through environment variables, just like running from source code.

---

### 🔧 Database Configuration

#### Method 1: Environment Variables (Recommended)

```bash
# Set environment variables directly
export DATABASE_URL="postgresql://user:password@localhost:5432/elygate"
export GATEWAY_URL="http://localhost:3000"
export WEB_URL="http://localhost:3000"

# Run binary
./elygate-bun-linux-x64
```

#### Method 2: .env File

```bash
# Create .env file in the same directory as the binary
cat > .env << EOF
DATABASE_URL=postgresql://user:password@localhost:5432/elygate
GATEWAY_URL=http://localhost:3000
WEB_URL=http://localhost:3000
EOF

# Run binary (will automatically read .env)
./elygate-bun-linux-x64
```

#### Method 3: Command Line Arguments

```bash
# Pass environment variables via command line
DATABASE_URL="postgresql://user:password@localhost:5432/elygate" ./elygate-bun-linux-x64
```

---

### 🗄️ Database Requirements

**PostgreSQL 15+** with the following extensions:

```sql
-- Required extensions
CREATE EXTENSION IF NOT EXISTS vector;      -- For semantic caching
CREATE EXTENSION IF NOT EXISTS pg_cron;     -- For scheduled tasks
CREATE EXTENSION IF NOT EXISTS pg_bigm;     -- For fuzzy search

-- Initialize database schema
\i packages/db/src/init.sql
```

---

### 📋 Complete Deployment Example

#### 1. Prepare Database

```bash
# Connect to PostgreSQL
psql -U postgres

# Create database
CREATE DATABASE elygate;

# Connect to database
\c elygate

# Create extensions
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_bigm;

# Initialize schema
\i /path/to/init.sql
```

#### 2. Download Binary

```bash
# Download latest release
wget https://github.com/zuohuadong/elygate/releases/latest/download/elygate-bun-linux-x64

# Make executable
chmod +x elygate-bun-linux-x64
```

#### 3. Configure Environment

```bash
# Create .env file
cat > .env << EOF
# Database Configuration
DATABASE_URL=postgresql://elygate:password@localhost:5432/elygate

# Server Configuration
GATEWAY_URL=http://localhost:3000
WEB_URL=http://localhost:3000

# Session Secret (generate a random string)
SESSION_SECRET=$(openssl rand -hex 32)

# Optional: Payment Configuration
STRIPE_SECRET_KEY=sk_xxx
STRIPE_PUBLIC_KEY=pk_xxx
EPAY_APP_ID=xxx
EPAY_APP_SECRET=xxx

# Optional: OAuth Configuration
GITHUB_CLIENT_ID=xxx
GITHUB_CLIENT_SECRET=xxx
DISCORD_CLIENT_ID=xxx
DISCORD_CLIENT_SECRET=xxx
TELEGRAM_BOT_TOKEN=xxx
EOF
```

#### 4. Run Binary

```bash
# Run directly
./elygate-bun-linux-x64

# Or run as systemd service
sudo systemctl start elygate
```

---

### 🔒 Security Recommendations

1. **Database Security**
   - Use strong passwords
   - Limit database user permissions
   - Enable SSL connections
   - Restrict network access

2. **Environment Variables**
   - Never commit `.env` to version control
   - Use secure secret management in production
   - Rotate secrets regularly

3. **Network Security**
   - Use HTTPS in production
   - Configure firewall rules
   - Enable rate limiting

---

<a name="中文"></a>

## 中文

### 📦 二进制文件数据库连接

Elygate 二进制文件通过环境变量连接数据库，与从源代码运行完全相同。

---

### 🔧 数据库配置

#### 方式 1：环境变量（推荐）

```bash
# 直接设置环境变量
export DATABASE_URL="postgresql://user:password@localhost:5432/elygate"
export GATEWAY_URL="http://localhost:3000"
export WEB_URL="http://localhost:3000"

# 运行二进制文件
./elygate-bun-linux-x64
```

#### 方式 2：.env 文件

```bash
# 在二进制文件同目录创建 .env 文件
cat > .env << EOF
DATABASE_URL=postgresql://user:password@localhost:5432/elygate
GATEWAY_URL=http://localhost:3000
WEB_URL=http://localhost:3000
EOF

# 运行二进制文件（会自动读取 .env）
./elygate-bun-linux-x64
```

#### 方式 3：命令行参数

```bash
# 通过命令行传递环境变量
DATABASE_URL="postgresql://user:password@localhost:5432/elygate" ./elygate-bun-linux-x64
```

---

### 🗄️ 数据库要求

**PostgreSQL 15+** 需要以下扩展：

```sql
-- 必需的扩展
CREATE EXTENSION IF NOT EXISTS vector;      -- 用于语义缓存
CREATE EXTENSION IF NOT EXISTS pg_cron;     -- 用于定时任务
CREATE EXTENSION IF NOT EXISTS pg_bigm;     -- 用于模糊搜索

-- 初始化数据库架构
\i packages/db/src/init.sql
```

---

### 📋 完整部署示例

#### 1. 准备数据库

```bash
# 连接 PostgreSQL
psql -U postgres

# 创建数据库
CREATE DATABASE elygate;

# 连接数据库
\c elygate

# 创建扩展
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_bigm;

# 初始化架构
\i /path/to/init.sql
```

#### 2. 下载二进制文件

```bash
# 下载最新版本
wget https://github.com/zuohuadong/elygate/releases/latest/download/elygate-bun-linux-x64

# 添加执行权限
chmod +x elygate-bun-linux-x64
```

#### 3. 配置环境变量

```bash
# 创建 .env 文件
cat > .env << EOF
# 数据库配置
DATABASE_URL=postgresql://elygate:password@localhost:5432/elygate

# 服务器配置
GATEWAY_URL=http://localhost:3000
WEB_URL=http://localhost:3000

# 会话密钥（生成随机字符串）
SESSION_SECRET=$(openssl rand -hex 32)

# 可选：支付配置
STRIPE_SECRET_KEY=sk_xxx
STRIPE_PUBLIC_KEY=pk_xxx
EPAY_APP_ID=xxx
EPAY_APP_SECRET=xxx

# 可选：OAuth 配置
GITHUB_CLIENT_ID=xxx
GITHUB_CLIENT_SECRET=xxx
DISCORD_CLIENT_ID=xxx
DISCORD_CLIENT_SECRET=xxx
TELEGRAM_BOT_TOKEN=xxx
EOF
```

#### 4. 运行二进制文件

```bash
# 直接运行
./elygate-bun-linux-x64

# 或作为 systemd 服务运行
sudo systemctl start elygate
```

---

### 🔒 安全建议

1. **数据库安全**
   - 使用强密码
   - 限制数据库用户权限
   - 启用 SSL 连接
   - 限制网络访问

2. **环境变量**
   - 永远不要将 `.env` 提交到版本控制
   - 在生产环境中使用安全的密钥管理
   - 定期轮换密钥

3. **网络安全**
   - 在生产环境中使用 HTTPS
   - 配置防火墙规则
   - 启用速率限制

---

### 🎉 Summary | 总结

**English**:
The binary file connects to the database through environment variables, just like running from source. Simply configure the `DATABASE_URL` environment variable or create a `.env` file, and the binary will connect to your PostgreSQL database automatically.

**中文**:
二进制文件通过环境变量连接数据库，与从源代码运行完全相同。只需配置 `DATABASE_URL` 环境变量或创建 `.env` 文件，二进制文件就会自动连接到您的 PostgreSQL 数据库。
