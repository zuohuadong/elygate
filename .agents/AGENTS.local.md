# Elygate 项目规则

## Elygate 面板与 Bifrost 上游边界

- 总则：保持 `panel/` 作为 Elygate 独立管理面板，不与 Bifrost 上游 `ui/` 混合维护；冻结面板依赖的后端 API 合约，将企业私有功能按需拆为面板扩展包，并持续减少对 Bifrost `core/`、`framework/` 和 HTTP handlers 的直接修改。
- `panel/` 由 Elygate 自主设计、开发和发布，不把上游 `ui/` 的目录或实现同步到 `panel/`。Bifrost 上游 UI 变化只作为产品和 API 参考，不是 `panel/` 的代码合并目标。
- 冻结 `panel/` 依赖的后端 API 合约，包括同源 `/api/*` 路径、认证授权、请求与响应结构、分页、错误语义和公共回调流程。涉及这些合约的变更必须保持向后兼容；确需破坏性变更时，必须同时提供迁移方案、更新 `panel/PARITY.md`，并补充前后端契约回归测试。
- Elygate 共享管理能力直接维护在 `panel/`；只有私有授权、客户定制或部署特定的企业功能才按需拆为面板扩展包。不得为了形式上的模块化把稳定的共享面板功能改造成插件。
- 持续减少对 Bifrost `core/`、`framework/` 和 `transports/bifrost-http/handlers/` 的直接修改。通用能力和修复优先整理为上游 PR；Elygate 专属能力优先通过现有 hook、插件、适配层或 sidecar 实现。
- 必须修改 Bifrost 上游目录时，保持补丁小、单一且可独立回放，避免无关重构和批量格式化，并补充聚焦回归测试及上游同步风险说明。扩展点不足时，优先上游化通用扩展 ABI，再实现 Elygate 专属模块。
- `Makefile`、`transports/Dockerfile`、发布工作流及静态 UI 嵌入目录是 `panel/` 与 Bifrost 的集成边界；允许维护必要的窄适配，但不得把面板业务逻辑下沉到这些边界文件。
- 合并 Bifrost 上游更新时，以上游 `core/`、`framework/`、`transports/` 等目录的行为和结构为基线，同时保留 Elygate 独立 `panel/` 及其窄集成适配；不得用上游 `ui/` 替换 `panel/`。
