# 技术设计

## 边界

本任务只处理价格数据形状与换算。站点存储、`normalizeStation()`、导入、保存和设置页行为保持现状；dashboard 继续把站点的 `priceCurrencyVerified` 传给报价逻辑，显式 `false` 的站点仍然阻断比较。

价格数据形状由 `extension/src/core/normalizers.js` 负责。`cleanPricingRows()` 在 generic payload 的三种入口中保留显式 `price_currency`，有值时规范为可比较的币种字符串；缺失或空字符串时标准化为 `UNKNOWN`。`extension/src/core/pricing.js` 的 `currencyToRmb()` 同时拒绝缺失/空值，避免任何未经过 normalizer 的调用默认按 USD 换算。专用 provider strategy 的既有币种输出不改动。


采集时将已准备好的 `priceCurrencyVerified` 与 `rechargeRateVerified` 以快照元数据保存。比较时显式存在的站点字段优先；旧版站点记录缺字段时回退使用快照中的状态，避免把 provider 已确认的未核验结果误判为默认已核验，也不改写站点存储。
## 数据流

```text
/api/pricing response
  -> normalizePricingPayload()
  -> parseGenericPricing()
  -> cleanPricingRows() [保留并规范 price_currency]
  -> snapshot.normalized.data + verification flags
  -> buildComparisonRows()
  -> getProxyPriceQuote()

`getProxyPriceQuote()` 保留现有两条独立的 `currency_unverified` 触发条件：

- 站点 `priceCurrencyVerified === false`。
- 报价项 `price_currency` 缺失、为空、为 UNKNOWN 或无法换算。

任何一条成立都继续返回不可用于成本/推荐的报价。`rechargeRateVerified === false` 仍单独产生 `recharge_unverified`。

## 兼容与版本

- 站点存储字段与显式核验状态不迁移、不补写；`priceCurrencyVerified: false` 和 `UNKNOWN` 仍由现有站点逻辑阻断。
- `cleanPricingRows()` 输出契约变化后 `NORMALIZATION_VERSION` 升至 21。旧快照由 `snapshotNeedsRefresh()` 排除；刷新得到的新快照同时带有价格币种与核验状态，比较链路不对旧快照猜测币种。


## 测试设计

在现有 `extension/test/core.test.js` 增加最小回归覆盖：

1. generic `data`/`models`/array payload 保留 CNY 与 USD，缺失/空 `price_currency` 标准化为 UNKNOWN。
2. 直接调用 `getProxyPriceQuote()` 覆盖缺失、空字符串、UNKNOWN、CNY、USD，确认只有可换算币种进入成本，且显式 `priceCurrencyVerified: false` 仍阻断。
3. 用 T蜜的 `/api/pricing` 采集形状构造快照，分别使用已核验和显式未核验站点配置，调用 `buildComparisonRows()` 验证来源币种、`pricingUnavailable` 和人民币成本；不修改或迁移站点存储字段。
4. 验证 `NORMALIZATION_VERSION` 递增后旧快照需要刷新。
## 风险与回滚

风险集中在 generic 价格字段契约和快照版本递增：旧快照会被排除并要求重新采集。若验证发现影响超出币种兼容，可回滚本任务改动；不要回滚工作区中其他已有改动。