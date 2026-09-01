# Agent State Management

> 此目录用于持久化 Agent 工作状态，支持会话中断恢复和跨会话记忆。

## 目录结构

```
.agents/state/
├── session.json          # 当前会话状态
├── project-memory.json   # 跨会话项目记忆
├── plans/                # 规划文件
│   └── *.md
└── logs/                 # 执行日志
    └── *.md
```

## 文件说明

### session.json

追踪当前工作会话的状态。Agent 开始任务时更新，完成或中断时保存进度。

字段说明：
- `mode` — 当前工作模式（idle / dev / research / deploy / review）
- `phase` — 当前阶段（planning / implementing / verifying / completed）
- `task` — 当前任务描述
- `started_at` — 任务开始时间 (ISO 8601)
- `last_activity` — 最后活动时间
- `iteration` — 迭代次数（用于循环类任务）
- `verification` — 验证状态快照

### project-memory.json

跨会话持久化的项目知识，帮助后续 Agent 避免重复工作。

字段说明：
- `decisions` — 重要的架构/技术决策 `[{date, decision, reason, alternatives}]`
- `known_issues` — 已知问题 `[{description, severity, workaround}]`
- `architecture_notes` — 架构笔记 `[{area, note}]`
- `rejected_approaches` — 被放弃的方案 `[{approach, reason, date}]`

## 使用约定

1. **Agent 开始任务时**: 更新 `session.json` 的 `mode`、`phase`、`task`、`started_at`
2. **Agent 完成任务时**: 将 `mode` 设为 `idle`，`phase` 设为 `completed`
3. **Agent 发现重要知识时**: 追加到 `project-memory.json`
4. **Agent 放弃某个方案时**: 记录到 `rejected_approaches`
5. **Agent 被中断时**: `session.json` 保留当前状态以便恢复

## 注意事项

- 这些文件应该被 `.gitignore` 忽略（除了 `project-memory.json` 可选择提交）
- JSON 文件保持紧凑但可读（2 空格缩进）
- timestamps 使用 ISO 8601 格式
