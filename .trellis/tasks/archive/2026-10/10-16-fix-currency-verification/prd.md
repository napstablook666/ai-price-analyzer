# 修复扩展币种待核验显示

## Goal

修复扩展更新后价格详情中已确认站点被错误标记为“币种待核验”的问题，让 `token123.cfd` 等通用价格接口保留实际返回的币种并正确换算，同时继续拦截真实未核验报价。

## Background

已确认的代码事实：

- `getProxyPriceQuote()` 会在站点 `priceCurrencyVerified === false` 或报价项币种无法换算时加入 `currency_unverified`；该状态会让报价不参与月成本、推荐和可比价格。
- `token123.cfd` 对应用户截图中的 T蜜，适配器强制走无凭据的 `/api/pricing`。通用 `cleanPricingRows()` 只保留价格和模型字段，丢弃接口返回的 `price_currency`，因此 CNY/USD 可能在快照中消失。
- `shared/db.js` 的 `getStations()` 只做脱敏，旧版 IndexedDB 站点记录没有经过 `normalizeStation()`；dashboard 比较链路和采集链路因此可能拿到不同形状的站点对象。
- KillAI 与 fuck-everyone 的币种/折算明确标记为未核验，不能通过全局默认值将其放行。

对用户的解释：

“币种待核验”表示该报价的币种没有被确认或无法安全换算，所以该报价不会进入可比价格和推荐计算。它是数据保护状态，不是装饰性提示。

## Requirements

- 保留通用价格解析结果中的 `price_currency`，至少覆盖数组、`data` 和 `models` 三种 generic payload 入口；有值时按现有币种字符串规范传递，无值时标准化为 `UNKNOWN` 并进入不可换算分支，不默认按 USD 换算或伪造已确认币种。
- 在 `currencyToRmb()` 中拒绝缺失/空字符串/UNKNOWN 等不可确认币种，不能默认按 USD 放行；显式 CNY/USD 继续按现有充值比例和汇率规则换算。
- 保持站点 `priceCurrencyVerified`、`UNKNOWN` 与显式未核验语义不变，不通过存储读取标准化、dashboard 标签或全局设置改变核验状态。
- 让币种修复贯通采集快照到价格比较：T蜜返回 CNY/USD 时，比较行应使用正确来源币种、完成人民币换算；为币种字段契约变化递增 normalization version，旧快照由刷新策略排除。
- 增加覆盖解析器、换算、两条 `currency_unverified` 分支及 T蜜端到端比较结果的回归测试，不改站点存储、导入、保存和设置页行为。

## Out of Scope

- 不修改 KillAI、fuck-everyone 的业务判断，不替它们猜测币种或充值折算。
- 不通过 dashboard 标签兜底、全局设置 `priceCurrencyVerified: true` 或删除核验状态来隐藏问题。
- 不把 `normalizeStation()` 推到 `shared/db.js` 的通用读取/写入边界，不处理历史坏 URL、options 诊断、导入校验或 Chrome 凭据副作用。
- 不重新设计价格字段、推荐算法、站点适配器注册表或 IndexedDB 版本迁移。

## Acceptance Criteria

- [x] generic `/api/pricing` 的数组、`data`、`models` payload 中，`price_currency: "CNY"` 和 `price_currency: "USD"` 在 normalized row 中可见且值正确。
- [x] 报价项币种缺失、空字符串、UNKNOWN 或其他不可换算值时，即使站点未显式标记 false 也产生 `currency_unverified`，不按 USD 默默计入成本；显式 CNY/USD 仍按现有汇率规则换算。
- [x] T蜜/`token123.cfd` 的端到端 fixture 在站点配置已核验时，CNY/USD 报价经过 `buildComparisonRows()` 后来源币种正确、`pricingUnavailable` 为 false、月成本按正确汇率计算；站点显式 `priceCurrencyVerified: false` 时仍阻断且不自动改成 true。若无法取得用户 IndexedDB 中的 T蜜记录，交付不得宣称已证明截图对应记录恢复，只能说明需检查该设置。
- [x] 旧 normalization version 的快照会被刷新策略排除，新的快照可以正常参与比较；现有扩展测试和新增回归测试全部通过。

## Open Questions

无。技术未知项已通过仓库代码、现有测试和审计意见确定，剩余工作是按上述边界实现并验证。

## Notes

- 本任务只处理当前工作区已有大改中的币种回归；保留其他未提交改动，不回滚无关文件。
- 任务仍需在实现前完成 `design.md` 与 `implement.md`，并由用户单独批准最终规划摘要。
