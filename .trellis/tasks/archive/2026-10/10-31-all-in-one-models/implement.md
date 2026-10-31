# all-in-one.icu 实施计划

## Checklist

1. [x] 读取并遵循 frontend pricing-data-contract，确认现有 pageAuth、model-list currency 和 tier row 字段。
2. [x] 在 response-format/profile 注册 all-in-one 专用格式，复用现有 model-plaza/tier 解析能力；仅补充 API 的 `data.list` 包装和字段别名。
3. [x] 在 provider registry 增加 all-in-one.icu hostname/path 匹配、page-mode 准备逻辑、`/api/tenant/models` GET 请求和 `tenant_access_token` 页面认证。
4. [x] 在 station-presets 增加幂等预设补齐，并确认空列表默认不变。
5. [x] 在 `extension/test/core.test.js` 增加脱敏 token/tiered fixture，覆盖请求配置、认证缺失、价格换算、tier 边界、unsupported billing mode 和 CREDITS 结果。
6. [x] 运行核心测试、语法检查和 diff 检查；发现 parser 影响其他站点时回滚到 response-format/profile 的最小改动。
7. [x] 重新检查 PRD acceptance criteria，完成 trellis-check，再提交变更。

## Validation commands

- `node --test extension/test/core.test.js`
- `node --check extension/src/core/provider-registry.js`
- `node --check extension/src/core/normalizers.js`
- `node --check extension/src/core/response-formats.js`
- `node --check extension/src/core/station-presets.js`
- `git diff --check`

## Risk and rollback points

- **认证风险**：只允许页面 localStorage token，禁止扩展静态凭据；若请求配置无法证明这一点，先修复测试再继续。
- **解析风险**：不要把 all-in-one 字段加入会误伤其他站点的通用识别分支；保留显式 response format。
- **分层风险**：tiered 必须保留区间，不能只输出默认价格；若现有 normalized row 不支持边界，先复用现有 interval contract，不另造字段体系。
- **单位风险**：不要从页面美元标签推导 recharge rate；收集边界统一输出 `CREDITS`。
- **回滚**：按 provider registry、response format、preset、tests 的组合回退，不触碰已有站点适配。
