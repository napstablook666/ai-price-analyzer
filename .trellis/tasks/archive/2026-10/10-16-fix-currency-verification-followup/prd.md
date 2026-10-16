# 修复已设置充值币种仍显示待核验

## Goal

修复用户已经设置充值金额币种和充值折算后，价格详情仍显示“币种待核验”的问题。明确区分充值金额币种、到账中转币和模型报价币种，让已核验的 CNY/USD/CREDITS 报价进入比较，同时保留未知或明确未核验报价的保护状态。

## Confirmed Repository Facts

- `extension/src/options.js:189-195` 有两组独立字段：`rechargeCurrency` / `rechargeRateVerified` 用于充值金额和充值折算；`priceCurrency` / `priceCurrencyVerified` 用于模型报价的来源币种。
- `extension/src/options.js:319-345` 的 `readStations()` 会同时提交两组字段。
- `extension/src/shared/schema.js:271-275` 的 `normalizeStation()` 会保留两组字段；`extension/src/service-worker.js:355-380` 的 `saveStations()` 也会标准化后保存。
- `extension/src/core/pricing.js:38-53` 在报价币种无法换算或 `priceCurrencyVerified === false` 时产生 `currency_unverified`；`rechargeRateVerified === false` 单独产生 `recharge_unverified`。
- `extension/src/service-worker.js:213-248` 通过站点记录和快照构建比较；`extension/src/core/pricing.js:211-213` 当前优先使用站点核验状态，缺失时才使用快照状态。
- 设置“充值金额币种”不会自动证明模型接口返回的价格字段也是该币种。两者混用会造成错误换算，尤其是站点展示美元价格但充值账户用人民币的情况。
- 上一个修复已保留 generic payload 的 `price_currency`、拒绝空币种并把核验状态写入新快照；用户反馈实际扩展中仍显示待核验，因此本任务必须验证真实保存值和 dashboard 数据，而不能只补 parser fixture。
- `extension/src/core/pricing.js:6-12` 已支持显式 `CREDITS` 作为按充值比例换算的来源单位；本任务实施前，`extension/src/shared/schema.js` 与 `extension/src/options.js` 尚未把 `CREDITS` 暴露为可选择的模型报价币种。

## User Clarification

- 用户明确设置了充值金额币种（USD 或 CNY），到账中转站的余额单位是“中转币”；这两个单位不是同一个字段。
- 充值金额币种只用于充值金额和充值折算。模型报价如果以中转币表示，应通过独立的模型价格币种选项选择 `CREDITS` 并完成核验。
- OpenRouter 官方模型价格按 USD 计价，credits 余额按美元额度处理；OpenRouter 的充值参考只能用于充值折算，不能把模型报价自动改成 CNY、CREDITS 或放行未知币种。

## Requirements

- 复现并定位用户设置已保存后仍出现 `currency_unverified` 的实际来源，覆盖设置页保存、站点读取、快照刷新、比较行和标签展示。
- 在模型价格币种明确为 CNY、USD 或用户确认的 CREDITS，且 `priceCurrencyVerified` 已保存为 `true` 时，比较行使用正确来源币种并完成人民币换算，不显示“币种待核验”。
- 在 `extension/src/shared/schema.js` 与 `extension/src/options.js` 支持 `CREDITS`/“中转币”作为独立的模型价格币种；`rechargeCurrency` 仍只负责充值金额和充值折算，不得自动视为 `priceCurrency`。
- generic `/api/pricing` 的数组、`data`、`models` payload 保留显式 `price_currency`。当报价行币种缺失或为空时，仅在站点明确选择并核验 `priceCurrency: "CREDITS"` 的情况下使用中转币作为该站点的显式单位；其他缺失/UNKNOWN 情况继续阻断，不默认按 USD、CNY 或充值币种放行。
- `currencyToRmb()` 继续拒绝缺失/UNKNOWN/不可确认值；显式 CNY/USD 和 CREDITS 按现有人民币及充值比例规则换算。KillAI、fuck-everyone 等明确未核验站点不被放行。
- 修复必须覆盖真实数据流并增加回归测试；不修改 Chrome 凭据、站点导入导出和无关 provider 的业务判断。

## Acceptance Criteria

- [x] 设置页提交的 `priceCurrency: "CREDITS"` 与 `priceCurrencyVerified: true` 经 `SAVE_STATIONS`、IndexedDB 读取后保持不变；充值金额币种 USD/CNY 与到账中转币数量仍独立保存。
- [x] generic 数组、`data`、`models` payload 中显式 `price_currency: "CNY"`、`"USD"`、`"CREDITS"` 正确保留并规范化；缺失/空值在未提供已核验 CREDITS 配置时仍为 `UNKNOWN`。
- [x] token123.cfd/T蜜 fixture 在站点配置 `priceCurrency: "CREDITS"`、`priceCurrencyVerified: true` 且充值比例已核验时，缺失 `price_currency` 的报价使用中转币来源并按 `rechargeRate` 完成人民币换算；显式 CNY/USD 报价仍使用自身来源币种。
- [x] 仅设置充值金额币种和到账中转币、未核验模型价格币种时，仍显示“币种待核验”，不会静默按错误币种计价；站点显式 `priceCurrencyVerified: false`、UNKNOWN 或 KillAI/fuck-everyone 未核验状态仍阻断。
- [x] 旧 normalization version 的快照会被刷新策略排除；扩展定向测试和完整可用检查通过。

## Out of Scope

- 不猜测任何站点真实的模型报价币种或充值折算比例；CREDITS 只有在用户显式选择并勾选核验后才可作为 generic 缺省单位。
- 不通过全局默认值、dashboard 标签兜底或删除核验状态隐藏问题。
- 不重新设计推荐算法、价格字段、IndexedDB 迁移或站点适配器注册表。

## Decision

- 充值账户币种、到账中转币数量和模型报价币种独立保存、独立核验、独立换算。
- 增加明确的模型报价币种 `CREDITS` 选项。只有用户选择并核验该选项时，generic 价格接口缺少 `price_currency` 才能使用 CREDITS；充值 USD/CNY 设置本身不会触发该 fallback。
- 对 OpenRouter 场景，充值折算使用用户设置的 USD/CNY 与充值比例；模型价格仍以 OpenRouter 返回或用户确认的 USD/CREDITS 字段为准。缺少报价币种或没有明确核验时继续显示“币种待核验”。
## Notes

- 本任务必须保留工作区中已有的其他未提交改动，不回滚无关文件。
- 复杂任务的 `design.md`、`implement.md` 和最终规划摘要须在实现前完成并获用户批准。
