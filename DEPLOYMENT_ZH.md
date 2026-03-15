# Elygate 企业版部署指南

本指南提供了在企业私有环境中使用 Docker 部署 Elygate 的详细步骤。

## 环境要求

- Docker 和 Docker Compose
- Bun (可选，用于本地运行管理脚本)
- 建议至少 4GB 内存以运行完整堆栈

## 1. 环境配置

在根目录下创建 `.env` 文件，可参考以下配置：

```bash
DATABASE_URL=postgresql://dbuser_dba:DBUser.DBA@db:5432/postgres
AUTH_SECRET=your-random-secret
ORG_NAME="你的企业名称"
ADMIN_USER="admin"
ADMIN_PASS="password123"
```

## 2. 启动服务

启动所有基础设施服务（PostgreSQL, Gateway, Web 以及 Portal）：

```bash
docker-compose up -d --build
```

## 3. 系统初始化 (Onboarding)

数据库就绪后，运行初始化脚本以创建首个组织和超级管理员账号：

```bash
# 使用本地 Bun 环境运行
bun run packages/db/src/onboard.ts

# 或者通过 Docker 容器运行
docker exec -it elygate-gateway bun run packages/db/src/onboard.ts
```

## 4. 访问门户

- **用户工作台**: `http://localhost:3001` (终端用户使用)
- **企业管理后台**: `http://localhost:3000` (组织管理与策略管控)
- **API 网关**: `http://localhost:3003`

使用环境配置文件中定义的 `ADMIN_USER` 和 `ADMIN_PASS` 登录企业管理后台。

## 5. 成员管理

在企业管理后台中，你可以：
- **添加成员**: 直接为你的团队成员创建账号。
- **配额设置**: 为不同用户分配具体的信用额度（Quota）。
- **策略配置**: 通过 CIDR 限制访问 IP，或设置模型访问的黑白名单。

## 6. 审计日志

所有请求和响应的 Payload 都会被完整捕获。你可以在管理后台的 **Logs** 页面查看详细的审计记录，以满足企业合规性需求。
