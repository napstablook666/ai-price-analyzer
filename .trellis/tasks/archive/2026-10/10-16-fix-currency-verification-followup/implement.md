# 实施计划

## 顺序

- [x] 1. 在 `extension/src/shared/schema.js` 允许 `priceCurrency: "CREDITS"`，不改变充值金额币种和核验字段的独立语义。
- [x] 2. 在 `extension/src/options.js` 的模型价格币种下拉框和 `readStations()` 增加 `CREDITS`，显示“中转币 CREDITS”；确认保存后不会改写 `rechargeCurrency`、`rechargeCredits` 或 `rechargeRate`。
- [x] 3. 在 `extension/src/core/normalizers.js` 让 `cleanPricingRows()`、`parseGenericPricing()` 和 `normalizePricingPayload()` 接收解析选项：显式行币种优先；只有已核验 CREDITS 配置才为 generic 缺失/空币种提供 CREDITS fallback，其余仍为 UNKNOWN。将 `NORMALIZATION_VERSION` 从 21 增至 22。
- [x] 4. 在 `extension/src/core/collectors.js` 的手动、页面和直接请求三条采集路径传递 `priceCurrency` 与 `priceCurrencyVerified`，确保快照拿到和比较链路一致的结果。
- [x] 5. 在 `extension/test/core.test.js` 增加回归覆盖：CREDITS 站点标准化；数组/data/models 显式币种和缺失币种；已核验 CREDITS fallback；仅设置充值 USD/CNY 仍阻断；token123/T蜜 fixture 的来源币种、人民币成本、`pricingUnavailable`；显式 false、UNKNOWN、KillAI/fuck-everyone 阻断；旧版本快照刷新。
- [x] 6. 更新 `.trellis/spec/frontend/pricing-data-contract.md`，记录 CREDITS 配置、generic fallback 条件和 normalization version 22。
- [x] 7. 运行 `node --test extension/test/core.test.js`、扩展完整测试及仓库实际提供的 lint/typecheck；脚本不存在则记录并跳过。
- [x] 8. 使用 `trellis-check` 做跨层复核，确认没有把 `rechargeCurrency` 作为 `priceCurrency`，没有放行明确未核验 provider，并检查工作区 diff 只包含本任务新增内容和已有改动的必要交集。
- [x] 9. 已完成用户批准最终规划摘要、`task.py start`、产品代码实现和检查；由于工作区存在本任务开始前的混合未提交改动，未执行整体提交，产品代码保留在当前工作区并归档任务。



## 当前执行记录

- 扩展定向测试 `node --test extension/test/core.test.js`：151/151 通过。
- 扩展完整测试 `npm test --prefix extension`：159/159 通过；`node --check` 对改动的 JavaScript 文件全部通过。
- `npm run lint --prefix extension` 与 `npm run typecheck --prefix extension`：仓库未提供对应脚本；默认 LSP 也未配置可用 JavaScript 服务器。
- 已完成本地跨层检查。独立子 agent 复核因环境缺少 Amazon Bedrock API key 未启动，未伪称复核通过；第 8 项保留待人工复核记录。
- 第 9 项的提交与归档仍待处理，工作区包含本任务开始前已有的多文件未提交改动，不能整体提交或回滚。
## 验收命令

```text
node --test extension/test/core.test.js
npm test
npm run lint
npm run typecheck
```

至少必须通过扩展定向测试和仓库已有的可用完整检查；不存在的脚本不作为失败原因，但要在交付中说明。

## 风险文件与回滚点

- `extension/src/shared/schema.js`、`extension/src/options.js`：若配置兼容回归，回滚 CREDITS 枚举和 UI 选项；不回滚充值字段。
- `extension/src/core/normalizers.js`、`extension/src/core/collectors.js`：若 generic fallback 误放行，回滚 fallback 参数传递并保留显式 `price_currency` 修复；版本号随输出契约同步回滚或重新设计迁移。
- `extension/test/core.test.js` 与 spec：跟随实现更新，不用删除原有 UNKNOWN/未核验回归测试来让测试通过。
