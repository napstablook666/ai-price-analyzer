# Technical Design

## Architecture Boundary

改动集中在扩展的价格计算、比较行展示和选项页展示三层：

1. `extension/src/core/pricing.js` 负责决定报价是否可用以及成本换算因子。
2. `extension/src/core/pricing.js:buildComparisonRows()` 负责把站点和快照元数据传入 quote 计算。
3. `extension/src/dashboard.js` 负责把价格不可用原因转成行状态和汇总信息。
4. `extension/src/options.js` 负责站点配置页的充值比例告警。

`rechargeRateVerified` 和 `rechargeRateNote` 保留在旧站点数据和 provider preset 中，作为兼容字段读取，但不再作为比较阻断条件。这样无需迁移用户的 IndexedDB 数据。

## Data Flow

站点配置和快照进入比较时，先解析充值比例确认状态。未确认或缺失状态使用有效比例 `1`，已确认状态使用现有 `station.rechargeRate`。随后仍通过 `currencyToRmb()` 处理模型行的 `CREDITS`、`USD` 或 `POINTS`，并保留币种核验和价格缺失原因。

核心规则为：

```js
const effectiveRechargeRate = rechargeRateVerified === true ? rechargeRate : 1;
const factor = currencyToRmb(item.price_currency, effectiveRechargeRate);
```

比较链路需要把站点和快照都没有提供确认值的情况视为未确认，避免旧数据中的非 1:1 比例被误用。底层 quote helper 的现有默认参数保持兼容，直接调用且明确未传验证参数的旧用法不因本次 UI 需求扩大影响面。

## Behavior Changes

- 删除 `recharge_unverified` 的生成和 dashboard 标签。
- `costPrices` 只会因为币种不可用、价格缺失等现有独立原因变为不可用。
- 删除选项页的充值比例未核实告警，但保留金额、到账币和只读比例显示。
- 不改变 `priceCurrencyVerified === false` 的阻断。

## Compatibility and Rollback

旧站点和旧快照仍可按原结构读取。回滚只需要恢复价格 helper 的有效比例选择、dashboard 标签和 options 告警；不需要数据迁移或清理用户存储。

## Risks

最大的行为变化是：未确认充值比例的站点会参与推荐，成本按 1:1 估算。该风险已由用户明确接受，且页面不再把此状态伪装成已核验；代码只移除阻断，不改变已确认比例的计算。
