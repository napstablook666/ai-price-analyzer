# all-in-one.icu 站点适配设计

## Boundaries

改动限定在扩展现有站点采集链路：

- `extension/src/core/provider-registry.js`：识别 all-in-one.icu、准备 page-mode 站点、配置页面认证和 `/api/tenant/models` 请求。
- `extension/src/core/normalizers.js` / `extension/src/core/response-formats.js`：新增明确 response format 和最小解析策略，输出现有 normalized pricing rows。
- `extension/src/core/station-presets.js`：把站点加入可选站点及升级补齐流程。
- `extension/test/core.test.js`：用脱敏 fixture 覆盖注册、认证、token、tiered、异常诊断和比较单位。

不改登录流程、用户凭据存储、全局比较算法和其他站点的默认 parser。

## Data flow

1. 用户在 all-in-one.icu 登录并打开或保留 `/tenant/models` 页面。
2. provider registry 按 hostname `all-in-one.icu` 和模型页路径匹配，准备 page-mode station，adapter endpoint 为 `/api/tenant/models`，response format 为 `all-in-one-models`。
3. 现有 page bridge 在目标站点页面上下文读取 `localStorage.tenant_access_token`，构造 `Authorization: Bearer <token>`，以 `credentials: "include"` 发起 GET。扩展侧不接触账号密码，也不注入静态 token。
4. normalizer 只在显式 response format 或带有 all-in-one 响应身份的 envelope 下解析 `data.list`，输出项目统一字段。
5. token 价格按每 token 数值乘 `1_000_000` 转成每百万；tiered 每个 `pricing_tiers` 逐项生成 interval row，保留边界和 tier label，不能把区间价格合并成模型默认价。
6. `collectStation` 继续以 `modelListCurrency: "CREDITS"` 建立快照；充值比例未确认时沿用既有 1:1 比较逻辑。

## Contracts

### Request contract

- Host: `all-in-one.icu`
- Page: `/tenant/models`
- Method: `GET`
- Endpoint: `/api/tenant/models`
- Credentials: `include`
- Page auth: `{ source: "localStorage", storageKey: "tenant_access_token", header: "Authorization", scheme: "Bearer" }`
- Anonymous fallback: forbidden

### Response contract

- Expected envelope: `{ code: 0, message: "ok", data: { list: Model[] } }`.
- Model identity: `model_id` first, then `model_name` or `id` fallback.
- Token fields: `input_price`, `output_price`, `cache_read_price`, `cache_creation_price`.
- Normalized cache creation field must follow the existing project mapping for cache write prices.
- Tier fields: `pricing_tiers[]` with `min_tokens`, `max_tokens`, `input_price`, `output_price`; preserve interval metadata.
- Unsupported billing modes produce the existing `unsupportedBillingModes`/`incomplete` diagnostics and no fabricated token row.

## Compatibility and trade-offs

- Use a site-specific strategy/profile instead of broadening generic JSON detection. This prevents unrelated `{ data: { list } }` payloads from being misclassified.
- Reuse existing page-auth and collection code instead of adding a new auth mechanism. This keeps secrets in the page session and gives consistent missing-login behavior.
- MVP supports token and tiered billing. Per-request/per-second/special remain diagnosed as unsupported, which is safer than inventing a comparable token price.
- All model-list rows are `CREDITS`; the page's display currency and recharge currency are not used as source-price evidence.

## Rollback

If the adapter breaks collection, remove the provider/preset registration and response-format registration together. Existing stations remain unaffected because matching is hostname-specific and the parser is explicit-format gated. Tests must retain the fixture and failure case so a later reintroduction does not silently broaden generic parsing.
