# 实施计划

## 实施步骤

- [x] 修改 `extension/src/core/provider-registry.js`：所有站点准备结果的模型币种设为 `CREDITS`/已核验；受保护 provider 的专属核验策略仅保留充值比例状态，并更新其 preset 默认币种。
- [x] 在 `extension/test/core.test.js` 增加 KillAI/fuck-everyone false/missing 币种状态的准备、采集和比较原因回归测试，并覆盖 false/missing/true 充值比例状态。
- [x] 更新 dashboard 回归断言，确认旧受保护站点只保留 `recharge_unverified`；更新 pricing-data-contract 与本任务验收条件。
- [x] 运行核心和 dashboard 测试，检查 diff 与工作区状态。

## 验证命令

- `node --test extension/test/core.test.js` (passed: 155 tests)
- `node --test extension/test/refresh-preflight.test.js` (passed: 11 tests)
- `git diff --check` (passed)

## 风险文件与回滚点

- 风险文件：`extension/src/core/provider-registry.js`、`extension/test/core.test.js`、`extension/test/refresh-preflight.test.js`、`.trellis/spec/frontend/pricing-data-contract.md`。
- 回滚点：只撤销受保护 provider 模型币种核验、preset 币种默认值和对应回归断言；充值比例保护以及工作区已有的其他未提交改动保持不变。

## 执行前检查

- [x] 当前任务已激活，按最新用户证据继续实施。
- [x] 受保护 provider 的模型列表由采集器统一按 CREDITS 规范化。
- [x] 未知充值比例仍须保持阻断。
