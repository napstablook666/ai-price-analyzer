# 实施计划

## 实施顺序
- [x] 1. 在 `extension/src/core/normalizers.js` 保留 generic pricing 的 `price_currency`，覆盖数组、`data`、`models` 三种 payload 入口；缺失/空值统一为 `UNKNOWN`。在 `extension/src/core/pricing.js` 让 `currencyToRmb()` 拒绝缺失/空值，确保不再默认按 USD 放行；显式 CNY/USD 保持现有汇率规则。
- [x] 2. 递增 `extension/src/core/normalizers.js` 的 `NORMALIZATION_VERSION`，确认 `snapshotNeedsRefresh()` 会排除旧快照，避免继续使用已经丢失币种的结果。
- [x] 3. 在 `extension/test/core.test.js` 增加 generic 数组/data/models 币种保留、缺失/空币种与两条 `currency_unverified` 分支、T蜜端到端比较、显式站点未核验分支和快照版本回归测试；不修改站点存储字段或设置页行为。
- [x] 4. 运行定向测试，再运行扩展完整测试、lint/type-check（若 package scripts 提供）；检查 diff 只包含本任务产品代码和测试，保留工作区已有无关改动。
- [x] 5. 按 trellis-check 清单完成跨层复核，确认未绕过核验状态，更新任务验收记录。

## 验收命令

```text
node --test extension/test/core.test.js
npm test
npm run lint
npm run typecheck
```

不存在的脚本跳过并记录；至少必须通过现有扩展测试和新增回归测试。

验证结果：`node --test extension/test/core.test.js` 通过 150/150；`cd extension && npm test` 通过 158/158；`npm run lint` 和 `npm run typecheck` 因 `extension/package.json` 未定义脚本而跳过；`git diff --check` 通过。

本地跨层复核确认采集器保存核验状态、比较层按站点字段优先并回退快照字段，旧站点记录不会放行 provider 的未核验报价。按用户指定的 `s2api-shadow-subagents` 发起独立复核时，环境拒绝了未注册的 `review-agent` 名称，因此未获得独立代理报告；未改用其他代理。

## 回滚点

- 解析器、换算逻辑、版本号和测试分别保持可识别的最小 diff。
- 若旧快照版本递增带来预期的全量刷新压力，只能调整迁移策略，不能把丢失币种的旧快照重新标记为可信。
- 不回滚工作区中其他已有改动。

## 完成条件

- `prd.md`、`design.md`、`implement.md` 已完成并获用户确认。
- `task.py start` 后才修改产品代码。
- 定向测试和可用的完整检查通过。
- 任务验收项全部勾选，完成 spec 更新、提交和会话收尾。