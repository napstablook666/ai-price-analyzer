# 技术设计

## 变更边界

本任务修复中转站和 OpenRouter 官方基准的模型价格单位契约。普通站点模型列表报价统一视为 `CREDITS`；OpenRouter 官方 USD credit 以 1:1 数值映射为本项目的虚构中转币。充值支付币种仍只参与人民币充值比例计算，KillAI 和 fuck-everyone 的显式未核验保护继续生效。

保留 `priceCurrency` 与 `priceCurrencyVerified` 字段，以兼容已有 IndexedDB 数据和 provider 保护状态。普通站点 UI 以 CREDITS 为模型列表单位。官方 OpenRouter API 原始价格仍按官方 USD 数值读取，不修改原始目录数据。

预计修改：

- `extension/src/shared/schema.js`：普通站点默认/兼容归一化使用 `CREDITS`。
- `extension/src/options.js`：模型列表单位显示为固定的“中转币 CREDITS”，充值 USD/CNY、到账中转币和比例仍独立保存。
- `extension/src/core/normalizers.js`：普通站点所有 normalized rows 统一 `price_currency: "CREDITS"`；已核验/未核验保护状态不被覆盖。
- `extension/src/core/collectors.js`：三条采集路径传入统一模型列表单位选项。
- `extension/src/core/openrouter.js`：官方模型解析结果保留 `price_currency: "USD"`，在比较层按 1:1 映射为项目的虚构中转币。
- `extension/src/core/pricing.js`：官方比较同时保留 CREDITS 来源单价和按 `openRouterRechargeRate` 换算的人民币成本单价。
- `extension/src/service-worker.js`：将项目设置的美元兑人民币汇率作为 OpenRouter 基准的默认 CREDITS 人民币成本比例。
- `extension/src/dashboard.js`、`extension/dashboard.html`：官方单价列显示 CREDITS，月成本仍按用户界面货币显示人民币成本。
- `extension/test/core.test.js`：覆盖统一单位、OpenRouter 1:1 映射、汇率换算、保护分支、T蜜端到端和快照刷新。
- `.trellis/spec/frontend/pricing-data-contract.md`：记录站点与 OpenRouter 的 CREDITS 契约、充值比例边界和手续费说明。

`extension/src/core/pricing.js` 已能把 `CREDITS` 乘以站点 `rechargeRate` 换算成人民币；官方基准复用同一成本计算思想，不重复实现另一套货币算法。

## 数据流与契约

```text
station options.js
  -> rechargeCurrency=USD/CNY + rechargeCredits
  -> rechargeRate = rechargeRmb / rechargeCredits
  -> station model-list unit = CREDITS
  -> collectStation()
  -> normalizePricingPayload(..., { modelListCurrency: "CREDITS" })
  -> snapshot.normalized.data[*].price_currency = "CREDITS"
  -> getProxyPriceQuote() -> station RMB cost

OpenRouter API
  -> parseOpenRouterData() -> model price numbers + price_currency=CREDITS
  -> buildComparisonRows()
  -> officialQuotedPrices = raw official CREDITS prices
  -> officialPrices = officialQuotedPrices * references.openRouterRechargeRate
  -> officialMonthlyCost = workloadCost(officialPrices)
```

归一化和比较规则：

1. 站点模型列表归一化使用固定业务单位 `CREDITS`，原始 `$`、`¥`、`USD`、空值或缺失字段都不能把普通站点报价改成现金 USD/CNY。
2. OpenRouter 的官方 API 价格数值本来是每百万 token 的美元金额；项目只在比较层将它们按 1:1 映射为 CREDITS，保留 `officialQuotedPrices` 供官方单价列显示。
3. `officialPrices` 是官方 CREDITS 单价按 `references.openRouterRechargeRate` 换算后的人民币成本单价。默认 `openRouterRechargeRate` 跟随设置中的美元兑人民币汇率，因为 OpenRouter credit 的面值是 USD 1:1。
4. `currencyToRmb("CREDITS", rechargeRate)` 仍用于站点行；站点各自使用自己的 `rechargeRate`。
5. `priceCurrencyVerified === false` 仍由 `getProxyPriceQuote()` 产生 `currency_unverified`；单位统一不自动把 KillAI/fuck-everyone 放行。
6. `rechargeRateVerified === false` 仍独立产生 `recharge_unverified`。
7. OpenRouter 充值手续费不写入模型单价换算。官方手续费随支付方式与订单金额变化，默认比较比例只表示 1 USD credit 的面值换算；用户如需按实际现金支出比较，应把实际充值金额和到账中转币数量填入对应充值比例。

## 兼容与版本

- `NORMALIZATION_VERSION` 已从 22 增至 23。旧快照由 `snapshotNeedsRefresh()` 排除，必须重新采集。
- 已保存的 `rechargeCurrency`、`rechargeRmb`、`rechargeCredits`、`rechargeRate` 不迁移、不覆盖。
- 已保存的 `priceCurrency` 字段保留读取兼容；普通模型列表刷新后得到 CREDITS 行。显式 `priceCurrencyVerified: false` 不被自动改成 true。
- 新增 comparison-only 的 `officialQuotedPrices`、`officialCurrency` 字段不改变站点快照契约，不需要再次递增 normalization version。
- 官方 reference 缓存继续保存原始模型数值和汇率；service worker 在 dashboard 比较时注入当前设置的 `openRouterRechargeRate`，设置变化立即作用于比较结果。

## 重要取舍

- 站点单位统一放在 collector/normalizer 边界，OpenRouter 单位映射放在 reference comparison 边界；不在 dashboard 标签或 `currencyToRmb()` 中兜底。
- 官方单价和官方人民币成本分开保存，避免把已经换算成 RMB 的成本数值错误标成 CREDITS。
- 不删除兼容字段，避免 IndexedDB 旧记录和 provider preset 形状变化；`priceCurrencyVerified: false` 仍是安全开关。
- 不把充值手续费硬编码为固定模型币种比例；OpenRouter 的 $0.80 最低费、非加密支付 5.5% 和加密支付 5% 随订单变化，属于实际支付成本。

## 风险与回滚

主要风险是把官方已换算的 RMB 成本再次当作 CREDITS 显示，或把 OpenRouter 充值手续费错误混入模型单价。通过同时保存 `officialQuotedPrices` 与 `officialPrices`、只在 comparison 层使用 `openRouterRechargeRate`、保留官方原始模型数值和增加单位/成本回归测试来控制风险。

若验证发现官方单价展示兼容回归，可先回滚 dashboard 展示字段，保留 comparison 的双价格字段和测试；不得回滚站点 CREDITS 归一化或未核验保护。
