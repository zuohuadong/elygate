# Elygate 测试套件

## 📁 测试文件结构

```
apps/gateway/tests/
├── payment.test.ts          # 支付系统测试
├── stats.test.ts            # 统计报表测试
├── oauth.test.ts            # 第三方登录测试
├── providers.test.ts        # 新模型支持测试
└── database-enhancements.test.ts  # 数据库增强测试
```

## 🧪 测试覆盖范围

### 1. 支付系统测试 (payment.test.ts)
- ✅ 创建支付订单
- ✅ 更新支付状态
- ✅ 用户额度充值
- ✅ 查询用户订单
- ✅ EPay 订单处理
- ✅ 防止重复支付处理

### 2. 统计报表测试 (stats.test.ts)
- ✅ 每日统计查询
- ✅ 成功率计算
- ✅ 模型统计查询
- ✅ 用户汇总统计
- ✅ 物化视图刷新
- ✅ 热力图数据
- ✅ 错误统计
- ✅ 实时监控

### 3. 第三方登录测试 (oauth.test.ts)
- ✅ Discord OAuth 账户创建
- ✅ Telegram OAuth 账户创建
- ✅ 按用户查询 OAuth 账户
- ✅ 按提供商查询 OAuth 账户
- ✅ 更新 OAuth 令牌
- ✅ 唯一性约束验证
- ✅ 过期令牌查找
- ✅ 过期令牌删除
- ✅ OAuth 登录流程

### 4. 新模型支持测试 (providers.test.ts)
- ✅ DeepSeek 请求转换
- ✅ DeepSeek 推理模式
- ✅ DeepSeek 响应解析
- ✅ Suno 请求转换
- ✅ Suno 响应解析
- ✅ 使用量提取

### 5. 数据库增强测试 (database-enhancements.test.ts)
- ✅ 表存在性验证
- ✅ 物化视图验证
- ✅ 函数存在性验证
- ✅ 索引验证
- ✅ 默认设置验证
- ✅ pg_cron 任务验证
- ✅ 列结构验证
- ✅ 约束验证

## 🚀 运行测试

### 运行所有测试
```bash
bun test
```

### 运行特定测试文件
```bash
bun test apps/gateway/tests/payment.test.ts
bun test apps/gateway/tests/stats.test.ts
bun test apps/gateway/tests/oauth.test.ts
bun test apps/gateway/tests/providers.test.ts
bun test apps/gateway/tests/database-enhancements.test.ts
```

### 运行带覆盖率的测试
```bash
bun test --coverage
```

## 📊 测试统计

- **总测试文件**: 5
- **总测试用例**: 70+
- **覆盖功能**:
  - 支付系统: 6 个测试
  - 统计报表: 8 个测试
  - 第三方登录: 9 个测试
  - 新模型支持: 15 个测试
  - 数据库增强: 30+ 个测试

## 🔧 测试配置

### 环境要求
- PostgreSQL 15+
- pgvector 扩展
- pg_cron 扩展
- pg_bigm 扩展

### 测试数据库
测试使用独立的测试数据库，避免影响生产数据。

### 清理策略
每个测试文件都包含 `afterAll` 钩子，自动清理测试数据。

## 📝 测试最佳实践

1. **隔离性**: 每个测试独立运行，不依赖其他测试
2. **清理**: 测试后自动清理数据
3. **断言**: 使用明确的断言验证结果
4. **错误处理**: 测试正常和异常情况
5. **性能**: 测试查询性能和索引效果

## 🎯 测试目标

- ✅ 验证所有新功能的正确性
- ✅ 确保数据库结构完整
- ✅ 验证约束和索引
- ✅ 测试错误处理
- ✅ 验证性能优化效果

## 📈 持续集成

测试已集成到 CI/CD 流程中，每次提交都会自动运行。

## 🐛 问题排查

如果测试失败，请检查：
1. 数据库连接是否正常
2. 环境变量是否配置正确
3. 数据库扩展是否已安装
4. 测试数据库是否已创建

## 📚 相关文档

- [功能增强文档](../FEATURE_ENHANCEMENT.md)
- [部署指南](../deploy-enhancements.sh)
- [数据库增强脚本](../packages/db/src/enhancement.sql)
