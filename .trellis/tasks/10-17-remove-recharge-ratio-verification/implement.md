# Implementation Plan

## Ordered Steps

1. 调整 `extension/src/core/pricing.js` 的有效充值比例选择。比较链路在未确认或缺失状态下使用 `1`，移除 `recharge_unverified` 原因和由此导致的 `costPrices=null`。
2. 调整 `buildComparisonRows()` 的状态合并，明确把站点和快照都缺少确认值的旧数据视为未确认后按 1:1 计算。
3. 删除 `extension/src/dashboard.js` 中充值比例待核验标签和相关展示路径，确认其他不可用原因仍正常汇总。
4. 删除 `extension/src/options.js` 中充值比例未核实告警渲染；保留充值金额、到账中转币和计算出的只读比例及旧字段保存兼容。
5. 更新 `extension/test/core.test.js` 与 `extension/test/refresh-preflight.test.js` 中原有充值阻断断言，补充 false/missing + 非 1:1 旧值按 1:1、true + 非 1:1 保持原比例、币种核验仍阻断、dashboard 不产生充值比例原因的回归覆盖。
6. 更新 `.trellis/spec/frontend/pricing-data-contract.md`，记录充值比例未确认按 1:1 计算且不再阻断的最终契约。

## Validation Commands

- `node --test extension/test/core.test.js extension/test/refresh-preflight.test.js`
- `npm --prefix extension test`
- `git diff --check`
- `git status --short`

## Review Gates

- 检查 dashboard 不再显示 `recharge_unverified`，但 `currency_unverified`、`price_missing` 和其他状态仍可见。
- 检查使用旧 IndexedDB 字段的 KillAI/fuck-everyone 配置无需迁移即可生成成本。
- 检查未确认站点的旧 `rechargeRate` 不会泄漏到比较计算中。
- 实现后安排独立只读复核，重点检查推荐资格变化和旧测试断言是否残留。
- 最后更新 spec、运行完整测试，再提交并归档任务。

## Rollback Point

若完整测试发现已有业务依赖仍要求 `recharge_unverified`，先只回滚核心计算和 dashboard/options 改动，保留规划和新增回归测试，重新确认范围后再继续；不删除或重置用户数据。
