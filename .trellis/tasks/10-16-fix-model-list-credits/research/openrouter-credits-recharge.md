# OpenRouter Credits 充值比例研究

## 官方结论

- OpenRouter FAQ（https://openrouter.ai/docs/faq）说明：Credits 是用于 API 推理的账户余额，基础货币是 USD，网站和 API 的模型价格都以美元表示；请求成本直接从 Credits 余额扣除。
- 同一 FAQ 说明：模型推理没有额外 markup，费用发生在购买 Credits 时。
- FAQ 当前写明：Stripe/非加密支付手续费为订单金额的 5.5%，最低 $0.80；Coinbase/加密支付手续费为 5%。
- OpenRouter 定价页（https://openrouter.ai/pricing）当前写明 Standard pay-as-you-go 平台费 5.5%，Business 为 8%；模型价格仍按 provider list price。
- 官方费用公告（https://openrouter.ai/blog/announcements/simplifying-our-platform-fee/）给出非加密支付的新费用示例：$5 → $0.80，$10 → $0.80，$25 → $1.38，$100 → $5.50，$1,000 → $55.00。

## 本项目换算规则

项目里的虚构单位 `CREDITS` 代表可消耗的中转站额度，不改变 OpenRouter 的官方原始 USD 语义：

- OpenRouter 官方模型价格：`1 USD credit = 1 CREDITS`，因此 API 返回的 `$5 / M token` 在比较表显示为 `5 CREDITS / M token`。
- 人民币月成本使用项目配置的人民币/美元汇率或用户实际充值比例；不能把 `$` 直接当成人民币。
- 如果按实际充值计算，准确比例是：

  `每 1 中转币成本（人民币） = 实际支付人民币 ÷ 实际到账 Credits`

- 如果用标准非加密支付、且手续费在充值金额之外收取，购买 `C` 美元 Credits 时：

  `手续费 = max(C × 5.5%, 0.80)`
  `实际支付美元 = C + 手续费`
  `每 1 中转币成本 = (C + 手续费) × 美元兑人民币汇率 ÷ C`

  小额充值会被最低 $0.80 拉高有效比例，大额充值趋近于 `1.055 × 美元兑人民币汇率`。最终仍应以支付回单和到账余额为准。

## 对代码的约束

- `extension/src/core/openrouter.js` 保留官方源字段 `price_currency: "USD"`。
- `extension/src/core/pricing.js` 在官方比较结果中把官方 USD 数值按 1:1 暴露为 `officialQuotedPrices` 的 `CREDITS`，人民币 `officialPrices` 使用 `openRouterRechargeRate`。
- `extension/src/service-worker.js` 当前将用户设置的汇率作为 OpenRouter 的基准换算率；如果未来增加 OpenRouter 实际充值金额/到账 Credits 配置，应只替换 `openRouterRechargeRate` 的来源，不改变 1:1 USD-credit 映射。
- 不在代码中写死某一笔充值金额的费率，也不使用充值支付币种去推断站点模型报价币种。
