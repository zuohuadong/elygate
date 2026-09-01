# Enterprise Backlog

## 当前优先级
- [x] 给 organization budget 加硬约束，避免超额请求继续放行
- [x] 给 organization 状态加入 auth 级拦截，禁用组织直接拒绝请求
- [ ] 补齐 team/project/member 模型，细化企业内部权限边界
- [ ] 补齐删除历史与恢复链路，避免组织 / Token 误删不可追溯
- [ ] 给企业控制台补搜索、分页、筛选和趋势视图
- [ ] 为 enterprise routes 增加测试覆盖

## 已完成
- [x] 两层后台入口拆分
- [x] 企业 Token / 组织 / 审计 / 告警基础 API
- [x] IP/CIDR 和外部 URL 安全收口
- [x] 支付回调边界调整
