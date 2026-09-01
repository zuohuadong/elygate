# Elygate 员工门户

独立的企业员工自助模块。员工通过企业 SSO 或 `zuohuadong/supauth` 登录，只能查看自己的虚拟密钥与用量，并可轮换属于自己的密钥。

## 为什么是独立模块

- 不修改 Bifrost 核心、请求钩子、路由注册或现有 `panel/`，降低合并上游更新时的冲突。
- 浏览器永远拿不到 Bifrost 管理令牌；所有权校验与用量过滤都在模块服务端执行。
- 企业 SSO 与 SupAuth 共用 OIDC + Authorization Code + PKCE 适配层。SupAuth 默认按 public client 运行，不要求 client secret。
- 旧密钥明文不可读取。轮换使用企业后端按员工身份原子执行的专用接口，避免“先校验、后轮换”的竞态；新值只返回一次。

## 身份与数据边界

SupAuth 使用 GoTrue OIDC runtime。默认以 `iss + sub` 标识员工，以标准 `email` 声明关联 Elygate 企业用户；配置 `SUPAUTH_PROJECT_REF` 后，门户会读取 `app_metadata.supaoauth.projects[projectRef].roles` 并执行员工角色授权。

模块依赖以下 Elygate 企业管理接口：

- `GET /api/users/email/{email}/virtual-keys`
- `GET /api/logs/dashboard?user_ids=...&virtual_key_ids=...`
- `POST /api/users/email/{email}/virtual-keys/{id}/rotate`

第一个接口必须返回顶层 `user_id`；门户查询用量时会同时提交 `user_ids` 和 `virtual_key_ids`，缺少用户映射将失败关闭。如果当前部署只有 OSS 后端，门户会返回明确错误，不会退化为管理员全量数据或允许浏览器自行过滤。

## 本地验证

```bash
cd enterprise/employee-portal
bun install
bun run test
bun run check
bun run build
```

复制 `config.example.env` 的变量到受控运行环境。不要提交 `.env`、管理令牌、OIDC client secret 或会话密钥。

## SupAuth 应用注册

在 SupAuth/SupaCloud 中为员工门户注册独立的 Web/OAuth client：

- Grant：`authorization_code`、`refresh_token`（按需）
- Token authentication：`none`（public client）
- PKCE：`S256`
- Redirect URI：`https://<elygate-domain>/employee/api/auth/callback/supauth`
- Scope：`openid profile email`

生产环境必须精确登记回调地址，不能使用通配回调。

## 反向代理

模块内部监听根路径，建议由 Caddy 去掉 `/employee` 前缀后转发：

```caddyfile
handle_path /employee/* {
  reverse_proxy employee-portal:8090
}
```

同时设置：

```dotenv
EMPLOYEE_PORTAL_PUBLIC_URL=https://<elygate-domain>/employee
```

Cookie 的 Path 会限制为 `/employee/`，员工会话不会发送给 Bifrost 管理面或推理接口。

## 运维要求

- `EMPLOYEE_PORTAL_SESSION_SECRET` 至少 32 字节，来自 Secret Manager。
- `EMPLOYEE_PORTAL_ALLOWED_ROLES` 默认仅允许 `employee`；SupAuth 项目成员或企业 IdP 用户必须获发允许角色。
- `BIFROST_MANAGEMENT_TOKEN` 使用最小权限服务身份，仅允许读取用户 Key/用量与轮换本人 Key 所需的服务端操作。
- 模块和 Bifrost 之间走内网；外网只暴露 `/employee/`。
- 员工不能创建无限 Key、修改模型白名单、预算或限流；这些仍由管理员的 Access Profile 控制。
