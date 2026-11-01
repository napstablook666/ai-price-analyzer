# ai.centos.hk 付费站适配技术设计

## Architecture and boundaries

- `extension/src/core/provider-registry.js` 增加 Centos 专用 provider、endpoint 常量和 station preset。
- Centos provider 以 `ai.centos.hk` + `/pricing` 为匹配边界，采用 `direct` 模式，禁止凭据转发，固定读取 `/api/pricing`。
- `extension/src/core/response-formats.js` 与 `extension/src/core/normalizers.js` 复用已有 `tokenflux` 显式格式和 `TokenFluxPricingStrategy`。只有在 fixture 证明 New-API 合同不兼容时，才在现有策略中做最小兼容调整；不新增泛化 auto-detection。
- `extension/src/core/station-presets.js` 暴露 `addCentosStationPreset`，并由 `PROVIDER_REGISTRY` 的 preset 自动参与已有持久站点回填流程。
- `extension/test/core.test.js` 增加 Centos fixture 与适配、采集、归一化、回填测试。
- `.trellis/spec/frontend/pricing-data-contract.md` 增加 Centos 合同，确保后续改动不会丢失公开接口与付费站信任边界。

## Data flow and contracts

1. 用户保存或回填 `https://ai.centos.hk/pricing`。
2. `prepareStationInput()` 通过 provider 将其规范化为 `https://ai.centos.hk/pricing`、`mode: "direct"`、`auth.type: "none"`、`adapter.endpoint: "/api/pricing"`、`responseFormat: "tokenflux"`。
3. `resolveStationCollection()` 使用 provider request policy 生成唯一 endpoint `https://ai.centos.hk/api/pricing`，GET，`credentials: "omit"`，默认 JSON Accept，无 Authorization。
4. `collectStation()` 调用 `normalizePricingPayload(payload, "tokenflux", { modelListCurrency: "CREDITS" })`。
5. 解析器按 `enable_groups` 和 `group_ratio` 展开有效分组，token 价格应用倍率一次；按请求/图片行沿用现有 `quota_type` / `supported_endpoint_types` 语义；`tiered_expr` / `billing_expr` 继续进入 `unsupportedBillingModes` 并生成 partial snapshot。
6. 站点 preset 保持 `priceCurrency: "CREDITS"`、`priceCurrencyVerified: true`、`rechargeRateVerified: false`。页面的 CNY 展示不改变充值折算验证状态。

## Compatibility and migration

- 复用 `tokenflux` 的显式 response format，避免扩大通用解析器对任意 New-API 响应的误识别。
- provider 只匹配 `ai.centos.hk`，不把其他同构 New-API 站点自动标成 Centos。
- 复用 `addRegisteredStationPresets()` 的 host 幂等与 ID 冲突规则；不改变空列表默认行为。
- 已存在的自定义站点不改写；已有 `ai.centos.hk` host 的站点不重复回填。
- 付费站的充值折算保持未核验，现有比较逻辑继续使用未核验 fallback，不引入新的推荐阻断规则。

## Important trade-offs

- 选择复用 TokenFlux parser，而不是复制 Centos parser，因为已观察到字段和计费模式完全属于同一 New-API pricing contract；复制会产生双份倍率与特殊计费逻辑。
- 选择显式 `tokenflux` 而不是 `auto`，因为通用 auto parser 不能仅凭结构安全区分所有 New-API 来源，显式格式能把站点边界和测试契约固定下来。
- 选择 direct + omit credentials，而不是 page 模式，因为公开页面已在匿名会话请求 `/api/pricing`，且用户明确将其作为付费站价格源，不需要登录态。

## Operational and rollback

- 如果真实 fixture 的 envelope 或字段语义与 TokenFlux 不兼容，先在策略层增加最小兼容字段映射并补测试；不扩大 host 匹配范围。
- 如果采集失败，可回滚 provider registry、preset 导出、测试和 spec 变更；不会影响已有 provider，因为匹配是 hostname-specific、响应格式仍是显式 gated。
- 发布前必须验证 endpoint、凭据、归一化金额、partial diagnostics、站点回填和现有全量测试。
