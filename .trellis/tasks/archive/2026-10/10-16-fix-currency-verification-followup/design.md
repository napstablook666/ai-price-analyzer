# 技术设计

## 变更边界

本任务只修复“充值单位已配置，但模型报价币种无法确认”的数据契约，不修改充值金额的业务含义、站点凭据、导入导出、推荐算法或 KillAI/fuck-everyone 的未核验判断。

需要修改的文件：

- `extension/src/shared/schema.js`：允许站点模型报价币种为 `CREDITS`，保留独立的 `priceCurrencyVerified`。
- `extension/src/options.js`：在模型价格币种选择中增加“中转币 CREDITS”，读取和保存该值；充值 USD/CNY 字段保持原样。
- `extension/src/core/normalizers.js`：generic payload 保留显式币种；只有已核验的站点 `priceCurrency: "CREDITS"` 才能为缺少币种的 generic 行提供明确 fallback。
- `extension/src/core/collectors.js`：把站点的模型币种和核验状态传给 generic normalizer，并随快照保留既有核验元数据。
- `extension/test/core.test.js`：覆盖设置契约、generic 三种入口、T蜜端到端比较和保护分支。
- `.trellis/spec/frontend/pricing-data-contract.md`：完成后记录 CREDITS fallback 与版本契约。

`extension/src/core/pricing.js` 已经按 `rechargeRate` 处理显式 `CREDITS`；本任务只补齐输入配置和 generic 解析入口，不重复实现换算逻辑。

## 数据流与契约

```text
options.js
  -> priceCurrency=CREDITS + priceCurrencyVerified=true
  -> SAVE_STATIONS / normalizeStation()
  -> collectStation()
  -> normalizePricingPayload(payload, options)
  -> parseGenericPricing(payload, options)
  -> cleanPricingRows(rows, options)
  -> snapshot.normalized.data
  -> buildComparisonRows()
  -> currencyToRmb("CREDITS", rechargeRate)
```

`cleanPricingRows()` 的币种规则：

1. 行内有非空 `price_currency` 或 `currency` 时，保留并规范为大写字符串，行内值优先于站点配置。
2. 行内币种缺失或空字符串时，仅当 `options.priceCurrency === "CREDITS"` 且 `options.priceCurrencyVerified === true`，使用 `CREDITS`。
3. 其他情况使用 `UNKNOWN`，由 `getProxyPriceQuote()` 产生 `currency_unverified`。

这样不会把 `rechargeCurrency`（充值金额 USD/CNY）混入模型价格来源，也不会因为默认站点字段而把未知 generic 报价当成 CNY/USD。

## 兼容与版本

- `CREDITS` 是新增的站点配置枚举值，旧的 CNY/USD/UNKNOWN 数据保持原语义。
- `priceCurrencyVerified: false`、UNKNOWN、KillAI 和 fuck-everyone 的既有阻断逻辑不改变。
- generic normalized row 的缺省币种解析行为变化后，将 `NORMALIZATION_VERSION` 从 21 增至 22；`snapshotNeedsRefresh()` 继续排除旧版本快照，要求重新采集。
- 专用 provider strategy 的固定币种输出不改动；显式行内币种仍覆盖站点 CREDITS 配置。

## 风险与回滚

主要风险是把“模型价格币种”与“充值金额币种”再次混淆，或让旧站点无意间获得 CREDITS fallback。实现只允许显式、已核验的 CREDITS fallback，并增加仅配置充值字段仍阻断的测试。若验证出现兼容问题，可独立回滚 schema/options/generic fallback 和版本号，保留既有 CNY/USD 解析修复。
