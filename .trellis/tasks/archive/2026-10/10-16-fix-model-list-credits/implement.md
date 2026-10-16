# 实施计划

## 顺序

- [x] 1. 在 `extension/src/shared/schema.js` 和 `extension/src/options.js` 保持普通模型列表单位为 `CREDITS`，充值 USD/CNY、到账中转币数量和比例独立保存；保留显式未核验 provider 的保护状态。
- [x] 2. 在 `extension/src/core/normalizers.js` 保持 generic array/data/models 和站点专用 strategy 输出统一为 `CREDITS`；显式未核验 provider 保留诊断并继续拦截；确认 normalization version 23。
- [x] 3. 在 `extension/src/core/collectors.js` 的手动、页面和直接请求路径传入统一模型列表单位选项。
- [x] 4. 在 `extension/src/core/openrouter.js` 保留官方模型解析结果的 `price_currency: "USD"`，在比较层按 1:1 映射为 CREDITS，不把充值手续费硬编码进模型价格。
- [x] 5. 在 `extension/src/core/pricing.js` 和 `extension/src/service-worker.js` 为 OpenRouter 基准保留 `officialQuotedPrices`/`officialCurrency`，并用 `openRouterRechargeRate` 生成官方人民币成本；默认跟随设置的美元兑人民币汇率。
- [x] 6. 在 `extension/src/dashboard.js`、`extension/dashboard.html` 让官方单价列显示 CREDITS，同时月成本和相对官方仍以人民币成本比较；更新官方参考说明。
- [x] 7. 在 `extension/test/core.test.js` 增加/更新回归：普通 generic 三种 payload 的 CREDITS 结果、OpenRouter 1:1 单价与汇率成本、充值 USD/CNY 独立性、T蜜端到端、未核验充值比例、KillAI/fuck-everyone 未核验拦截、旧快照刷新。
- [x] 8. 更新 `.trellis/spec/frontend/pricing-data-contract.md` 和任务研究记录，记录站点和 OpenRouter CREDITS、官方双价格字段、汇率/手续费边界。
- [x] 9. 运行定向测试、扩展完整测试和所有实际提供的 lint/typecheck；检查 JavaScript 语法；使用 trellis-check 做全范围复核。
- [ ] 10. 更新任务验收项并归档；工作区已有混合未提交改动，不整体提交无关文件。

## 验收命令

```text
node --test extension/test/core.test.js
npm test --prefix extension
node --check extension/src/shared/schema.js
node --check extension/src/options.js
node --check extension/src/core/normalizers.js
node --check extension/src/core/collectors.js
node --check extension/src/core/openrouter.js
node --check extension/src/core/pricing.js
node --check extension/src/service-worker.js
node --check extension/src/dashboard.js
node --check extension/test/core.test.js
npm run lint --prefix extension
npm run typecheck --prefix extension
```

不存在的 lint/typecheck 脚本不作为失败原因，但必须记录；定向测试和扩展完整测试必须通过。

## 风险文件与回滚点

- `extension/src/core/openrouter.js`、`extension/src/core/pricing.js`：若官方数值和 CREDITS 展示混淆，回滚 comparison-only 映射，不改 API 原始解析数值。
- `extension/src/service-worker.js`：确保当前设置汇率进入官方基准，不把 station rechargeRate 错用为全局官方比例。
- `extension/src/dashboard.js`、`extension/dashboard.html`：确保 CREDITS 源单价与 RMB 月成本分别显示。
- `extension/src/core/normalizers.js`：统一站点单位的核心边界；不在 dashboard 增加补丁。
- `extension/test/core.test.js`：同时证明普通列表和 OpenRouter 通过，明确未核验 provider 仍阻断。
- normalization version：站点输出契约保持 version 23；不能为了继续使用旧快照而降低版本。
