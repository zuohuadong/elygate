# Agent Mailbox

多 Agent 协作的消息目录。每个消息是一个独立的 `.md` 文件。

## 消息格式

文件名：`{序号}-{来源}-{类型}-{简述}.md`

示例：`001-frontend-request-api-pagination.md`

文件内容：

```yaml
---
from: workspace-frontend
to: all | workspace-backend
type: request | response | broadcast | alert
status: pending | done
created: 2026-03-22T16:30:00
---

消息正文（Markdown）
```

## 类型说明

| type | 用途 |
|------|------|
| `request` | 向其他 Agent 请求协助 |
| `response` | 回复某个 request |
| `broadcast` | 广播通知所有 Agent（如部署完成） |
| `alert` | 紧急问题，需要立即关注 |

## Agent 行为约定

1. **启动时检查** — Agent 每次启动时先读取 `.mailbox/` 中 `status: pending` 的消息
2. **处理相关消息** — 如果 `to` 是自己或 `all`，则处理并回复
3. **标记完成** — 处理后将消息的 `status` 改为 `done`
4. **定期清理** — 超过 24 小时的 `done` 消息可以删除

## 示例

### Request（请求 API 支持）
```
---
from: workspace-frontend
to: workspace-backend
type: request
status: pending
created: 2026-03-22T16:30:00
---

需要 `GET /api/users` 支持分页：
- 参数：`?page=1&limit=20`
- 返回：`{ data: User[], total: number, page: number }`
```

### Response（回复已完成）
```
---
from: workspace-backend
to: workspace-frontend
type: response
status: pending
created: 2026-03-22T16:45:00
---

已完成，PR #42。接口变更：
- `GET /api/users?page=1&limit=20`
- 响应增加 `total` 和 `hasMore` 字段
```

### Broadcast（广播通知）
```
---
from: workspace-devops
to: all
type: broadcast
status: pending
created: 2026-03-22T17:00:00
---

v2.1.0 已部署到 staging 环境，请各 workspace 验证功能。
```
