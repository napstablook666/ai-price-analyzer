# 实施计划

## 顺序

- [x] 1. 在 `extension/src/core/provider-registry.js` 为 KillAI/fuck-everyone 增加显式保留未核验状态的 provider 标记；让 `prepareStationInput()` 将其他所有普通/未知站点统一成 `CREDITS`/true。
- [x] 2. 在 `extension/src/service-worker.js` 增加统一 prepared station 读取 helper，供 `dashboard()` 和 `refreshAllInternal()` 使用，确认刷新与比较拿到同一对象形状。
- [x] 3. 在 `extension/src/core/normalizers.js` 将 `NORMALIZATION_VERSION` 从 23 增至 24；不在 `pricing.js` 添加全局放行。
- [x] 4. 在 `extension/test/core.test.js` 增加回归：T蜜旧 false、另一普通 registered station、未注册普通 station、刷新 normalized row、比较成本、保护 provider false 和 rechargeRate false。
- [x] 5. 更新 `.trellis/spec/frontend/pricing-data-contract.md`，记录所有普通站点的 CREDITS canonicalization、保护 provider 标记、prepared runtime boundary 和 version 24。
- [x] 6. 运行 `node --test extension/test/core.test.js`、`npm test --prefix extension`、相关 JavaScript `node --check`；检查 lint/typecheck 是否存在。
- [x] 7. 使用 trellis-check 做全范围复核，确认没有将保护 provider 或充值比例未核验状态放行。
- [x] 8. 更新 PRD/实施验收项，完成提交和归档；保留工作区中的无关未提交改动。

## 验收命令

```text
node --test extension/test/core.test.js
npm test --prefix extension
node --check extension/src/core/provider-registry.js
node --check extension/src/service-worker.js
node --check extension/src/core/normalizers.js
node --check extension/src/core/pricing.js
node --check extension/test/core.test.js
npm run lint --prefix extension
npm run typecheck --prefix extension
```

不存在的 lint/typecheck 脚本不作为失败原因，但必须记录。

## 风险文件与回滚点

- `extension/src/core/provider-registry.js`：普通站点默认 CREDITS，保护 provider 使用显式标记；不使用散落 host 判断。
- `extension/src/service-worker.js`：runtime helper 必须同时覆盖 refresh 和 dashboard；若有副作用，保留 provider canonicalization，仅回滚调用边界。
- `extension/src/core/normalizers.js`：版本必须递增到 24，不能继续消费旧错误快照。
- `extension/test/core.test.js`：不删除任何未核验保护测试来让测试通过。
