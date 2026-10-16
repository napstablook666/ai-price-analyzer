# 修复模型列表统一中转币计价

## Goal

修复模型列表中的价格虽然通常以 `$`、`¥` 或 `USD` 形式展示，却实际表示消耗的中转币，导致扩展错误显示“币种待核验”或按错误现金币种换算的问题。

项目用 OpenRouter 做官方基准。OpenRouter 的模型价格按美元余额计价，但在本项目中把同数值的官方 USD credit 映射为 1:1 的虚构“中转币”，再统一用人民币充值成本比较各家中转站。

充值支付币种、到账中转币数量和模型列表报价单位必须分开理解：充值支付币种只用于计算每个中转币的人民币成本，模型列表报价统一按中转币计价。

## Confirmed Repository Facts

- `extension/src/shared/schema.js:271-275` 保存 `rechargeCurrency`、`rechargeRmb`、`rechargeCredits`、`rechargeRate`，并另外保存 `priceCurrency`、`priceCurrencyVerified`。
- `extension/src/options.js:189-195` 当前把模型列表单位显示为 CREDITS，但仍保留模型价格核验开关；充值 USD/CNY 与到账中转币字段独立保存。
- `extension/src/core/pricing.js:4-12` 已将 `CREDITS` 按 `rechargeRate` 换算为人民币；`currency_unverified` 与 `recharge_unverified` 是两个独立原因。
- `extension/src/core/normalizers.js` 当前已在站点采集归一化边界把普通模型列表行统一为 CREDITS；`NORMALIZATION_VERSION` 当前为 23。
- `extension/src/core/collectors.js` 已把 `modelListCurrency: "CREDITS"` 传给手动、页面和直接请求三条采集路径。
- `extension/src/core/openrouter.js` 解析官方模型价格的数值仍以每百万 token 的 USD 数值表示；官方基准比较需要额外保留原始 CREDITS 单价和按人民币汇率换算后的成本单价。
- OpenRouter 官方 FAQ/定价说明把 credits 作为美元余额使用，平台充值手续费按支付方式和订单金额变化，不能从模型单价本身推导成固定模型币种。

## User Intent

- 模型列表中的模型报价全部按中转币计价，包括 OpenRouter 官方基准。
- 各家接口中的 `$`、`¥`、`USD` 等符号不改变比较用的业务单位，展示统一为中转币。
- 充值时选择 USD 或 CNY，只表示实际支付币种；到账中转币数量和充值比例决定每个中转币的人民币成本。
- OpenRouter 的官方 USD credit 按 1:1 映射为本项目的中转币，官方基准成本使用项目配置的美元兑人民币汇率换算。
- 用户不应为每个普通模型列表重复确认模型报价币种。
- KillAI、fuck-everyone 等当前明确未核验的 provider 继续保留拦截。

## Requirements

- 普通中转站模型列表的报价统一归一化为 `CREDITS`，缺少 `price_currency` 或原始值为 `$`/`USD` 时不进入普通站点的 `currency_unverified`；显式未核验站点仍由核验状态拦截。
- OpenRouter 官方模型单价在基准比较中使用 `CREDITS` 来源单位；同数值的官方 USD credit 映射为 1:1 中转币，不把官方 USD 直接当作某个中转站的现金美元报价。
- 统一使用各站点保存的 `rechargeRate` 将中转币报价换算成人民币。OpenRouter 官方基准使用 `references.openRouterRechargeRate`，默认跟随项目设置的美元兑人民币汇率；充值支付手续费是实际充值成本，不改变模型单价单位。
- 模型列表的比较行应显示来源单位 `CREDITS`、生成人民币月成本，并将 `pricingUnavailable` 设为 `false`，前提是充值折算本身已核验。
- `rechargeRateVerified === false` 继续单独产生 `recharge_unverified`，不得用模型列表已知为 CREDITS 来隐藏充值比例风险。
- KillAI、fuck-everyone 等显式 `priceCurrencyVerified: false` 的 provider 仍产生 `currency_unverified`，即使其归一化行的单位可写成 `CREDITS`。
- 旧 normalization version 的快照必须被刷新策略排除，避免继续使用按 USD/CNY 或 UNKNOWN 解释的旧结果。
- 增加 generic 数组、`data`、`models`，常见 provider strategy，OpenRouter 基准、T蜜端到端比较以及充值币种独立性回归测试。
- 不修改 Chrome 凭据、站点导入导出和无关推荐算法。

## Acceptance Criteria

- [x] 普通模型列表即使原始行缺少 `price_currency` 或写成 `$`/`USD`，归一化来源单位也为 `CREDITS`，不显示“币种待核验”。
- [x] OpenRouter 官方模型单价在比较行来源单位为 `CREDITS`，数值与官方 USD credit 1:1，官方人民币月成本按 `openRouterRechargeRate` 计算。
- [x] 充值支付币种分别为 USD/CNY 时，普通模型列表和 OpenRouter 基准都按 CREDITS 乘以对应人民币充值比例换算；支付币种不会直接覆盖模型报价单位。
- [x] T蜜/`token123.cfd` fixture 的比较行来源币种为 `CREDITS`，`pricingUnavailable` 为 false，人民币月成本等于中转币价格乘以充值比例。
- [x] OpenRouter 充值手续费不被硬编码成模型单价；官方说明记录为随支付方式和充值金额变化，实际到账比例仍可按用户真实充值金额/到账中转币数填写。
- [x] `rechargeRateVerified: false` 仍产生 `recharge_unverified`；KillAI/fuck-everyone 的明确未核验状态仍产生 `currency_unverified`。
- [x] 旧 normalization version 快照会刷新；新增回归测试和扩展完整测试全部通过。

## Out of Scope

- 不改变 OpenRouter API 返回的官方美元原始数值、模型匹配规则或官方目录抓取；只改变项目比较层的 CREDITS 映射和人民币成本计算。
- 不把 OpenRouter 的充值手续费猜成固定比例，也不为不同充值金额伪造统一的到账数量；具体真实充值比例以用户实际订单为准。
- 不修改 Chrome 凭据、站点导入导出、IndexedDB 迁移和推荐算法。
- 不凭 `$` 符号推断现金币种，也不引入新的充值比例来源。

## Technical Notes

- `priceCurrency`/`priceCurrencyVerified` 保留为站点兼容字段和 provider 保护开关，但普通模型列表和 OpenRouter 基准的比较业务单位固定为 `CREDITS`。
- 站点行的统一单位转换放在 collector/normalizer 边界；OpenRouter 官方行在 reference comparison 边界保留原始 CREDITS 单价，同时用 `openRouterRechargeRate` 生成人民币成本。
- `NORMALIZATION_VERSION` 已为 23；官方比较字段的新增不改变快照 normalized row 契约。旧的 CNY/USD/UNKNOWN 模型列表快照仍由版本刷新策略排除。

## Open Questions

无。
