# Elygate Enterprise 部署验证 Runbook

本文用于把三层 Elygate 发布到企业环境前做部署验证。它适用于：

- Basic Gateway：`/v1/*` 数据面、provider adapter、路由、限流、计量、日志、缓存、Memory。
- Elygate Panel：通用管理面板，生产构建由 gateway 静态服务。
- Elygate Enterprise：`/api/enterprise/*` 控制面与 `/enterprise/` 企业控制台，基于 SupaCloud + SupAuth + svadmin。

本文不替代生产发布授权。未确认目标服务、域名、数据库、密钥来源和回滚 artifact 前，不要执行 SSH、推送、重启或生产迁移。

## 部署画像

```yaml
deployment_profile:
  target: supacloud-or-existing-private-infra
  runtime_kind: backend + static admin UI + enterprise control plane
  stateful_services:
    - postgres
    - pg-boss
    - supauth
    - supacloud app lifecycle
  admin_profile:
    framework: svadmin
    surfaces:
      - apps/admin
      - apps/enterprise-console
```

## 发布前本地 Gate

在仓库根目录执行：

```bash
bun run check
bun run build
bun run smoke:enterprise:db
bun run smoke:enterprise:runtime
git diff --check
```

验收标准：

- `check:layers` 输出 `[layer-boundary] ok`。
- `smoke:enterprise:db` 使用临时 PostgreSQL 完成 migration、install projection、policy、budget、uninstall、audit export。
- `smoke:enterprise:runtime` 启动真实 gateway、临时 PostgreSQL 和 mock OpenAI upstream，输出：
  - `basic gateway data-plane ok`
  - `panel admin API functions ok`
  - 19 个 Panel 页面 `panel page ok`
  - 6 个 Enterprise 页面 `page ok`

## 环境变量

Basic Gateway + Panel 模式不需要企业变量。Enterprise 模式至少需要：

```bash
NODE_ENV=production
PORT=3000
DATABASE_URL=postgresql://...
JWT_SECRET=...
ENCRYPTION_SECRET=...
ENCRYPTION_SALT=...
GATEWAY_URL=https://gateway.example.com

ELYGATE_LAYER=enterprise
ELYGATE_APP_ID=elygate-ai-gateway
ELYGATE_APP_INSTANCE_ID=agi_xxx
ELYGATE_TENANT_ID=tenant_xxx
ELYGATE_ORG_ID=org_xxx
ELYGATE_PROJECT_ID=project_xxx
ELYGATE_PUBLIC_BASE_URL=https://gateway.example.com
ELYGATE_ADMIN_BASE_URL=https://gateway.example.com/enterprise/

SUPAUTH_ISSUER_URL=https://auth.example.com
SUPAUTH_JWKS_URL=https://auth.example.com/.well-known/jwks.json
SUPAUTH_AUDIENCE=https://gateway.example.com
ENTERPRISE_AUTH_MODE=strict
```

安全要求：

- 生产必须设置 `SUPAUTH_JWKS_URL`，并使用 `ENTERPRISE_AUTH_MODE=strict`。
- `sk-*` 只用于 `/v1/*` 数据面；企业控制面必须使用 SupAuth JWT 或 service token。
- 不在日志、CI 输出、部署脚本 stdout 中打印数据库 URL、JWT secret、SupAuth token、provider key 或 admin password。

## 部署步骤

### 1. 备份和回滚点

发布前记录：

```bash
git rev-parse HEAD
bun --version
```

同时准备：

- 当前运行 commit 或镜像 tag。
- 当前 `.env` 的安全备份，备份内容不得提交。
- PostgreSQL 备份或快照。
- 上一个可运行的 `apps/admin/dist`、`apps/enterprise-console/dist` 和 gateway artifact。

备份恢复演练：

```bash
pg_dump --format=custom --file=/secure-backups/elygate-predeploy.dump "$DATABASE_URL"
pg_restore --list /secure-backups/elygate-predeploy.dump | head
createdb elygate_restore_drill
pg_restore --dbname=elygate_restore_drill --clean --if-exists /secure-backups/elygate-predeploy.dump
DATABASE_URL=postgresql://... bun --cwd apps/gateway src/enterprise/dbSmoke.ts
```

验收点：

- 备份文件由生产密钥系统或安全备份目录管理，不提交到仓库。
- `pg_restore --list` 能读取备份目录。
- staging/临时库 restore 后，`smoke:enterprise:db` 能完成企业投影、审计导出和卸载回调。
- `/api/admin/data/backup/status` 能返回核心表行数统计，用于发布前后快速对照。

### 2. 构建

```bash
bun install --frozen-lockfile
bun run build
```

构建产物：

- `apps/admin/dist`
- `apps/enterprise-console/dist`
- `apps/portal/build`

gateway 会从 `/enterprise/` 服务 `apps/enterprise-console/dist`，从根路径服务通用 Panel fallback。

### 3. 数据库迁移

推荐先在 staging 库执行：

```bash
DATABASE_URL=postgresql://... bun --cwd apps/gateway src/enterprise/dbSmoke.ts
```

生产迁移前确认：

- `packages/db/drizzle/20260620235000_add_enterprise_control_plane/migration.sql` 为新增表和索引。
- `packages/db/drizzle/20260621033000_add_channel_test_errors/migration.sql` 为幂等 `ADD COLUMN IF NOT EXISTS`。
- 没有 `DROP TABLE`、`TRUNCATE` 或破坏性数据改写。
- 企业模式是 fail-closed：`ELYGATE_LAYER=enterprise` 且 `ELYGATE_TENANT_ID` / `ELYGATE_ORG_ID` / `ELYGATE_APP_INSTANCE_ID` 齐全后，如果企业投影表缺失或不可读，数据面运行时守卫会返回 HTTP 503，而不是绕过策略和预算检查。

生产迁移按既有数据库流程执行：

```bash
bun run db:migrate
```

### 4. 启动或重启

Docker Compose 示例：

```bash
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
docker compose -f docker-compose.prod.yml ps
```

宿主机 systemd 示例：

```bash
systemctl restart elygate
systemctl status elygate --no-pager
journalctl -u elygate -n 200 --no-pager
```

实际服务名以当前生产环境为准，不要直接套用旧脚本里的服务器别名或 IP。
启动前必须先完成数据库迁移和控制面投影 smoke；启动后若 `/api/enterprise/health` 正常但数据面请求持续 503，优先检查企业投影表、`ELYGATE_*` 实例变量和数据库连通性。

## 发布后 Smoke

健康检查：

```bash
curl -fsS https://gateway.example.com/api/status
curl -fsS https://gateway.example.com/api/enterprise/health
curl -fsS https://gateway.example.com/api/enterprise/manifest
```

静态页面：

```bash
curl -fsS https://gateway.example.com/ | head
curl -fsS https://gateway.example.com/enterprise/ | head
```

数据面：

```bash
curl -fsS https://gateway.example.com/v1/models \
  -H "Authorization: Bearer sk_xxx"
```

控制面边界：

```bash
curl -i https://gateway.example.com/api/enterprise/me \
  -H "Authorization: Bearer sk_xxx"
```

预期：`sk-*` 被拒绝访问企业控制面。

SupAuth 控制面：

```bash
curl -fsS https://gateway.example.com/api/enterprise/me \
  -H "Authorization: Bearer $SUPAUTH_TOKEN"
```

预期：返回 `tenant_id`、`org_id`、`app_id`、`app_instance_id`、`scopes`。

## SupaCloud 生命周期验证

使用 SupaCloud App 安装回调或等价 staging payload 验证：

- `POST /api/enterprise/install`
- `POST /api/enterprise/events`
- `POST /api/enterprise/uninstall`

验收点：

- install 创建或更新 `enterprise_gateway_instances` 投影。
- events 只接受同 tenant/org/app 的事件。
- uninstall 幂等标记实例为 `deleted`。
- 所有操作写入 `enterprise_audit_events`。

## 回滚

如果发布后任一 smoke 失败：

1. 停止继续流量切换。
2. 恢复上一个 artifact、镜像 tag 或 commit。
3. 重启 gateway。
4. 重新执行健康检查和 `/v1/models` 数据面 smoke。
5. 如果失败与新增企业表有关，优先禁用企业模式：

```bash
ELYGATE_LAYER=
SUPAUTH_ISSUER_URL=
SUPAUTH_JWKS_URL=
```

这会让 Basic Gateway + Panel 继续运行。企业新增表是非破坏性对象，默认不需要立刻 drop。

## 发布记录模板

```md
部署时间：
目标环境：
commit/tag：
数据库备份：
回滚 artifact：
验证命令：
- bun run check
- bun run build
- bun run smoke:enterprise:db
- bun run smoke:enterprise:runtime
生产 smoke：
- /api/status
- /api/enterprise/health
- /api/enterprise/manifest
- /v1/models
- /enterprise/
结论：
回滚是否执行：
```
