# TokenFlux 定价站点适配

## Goal

将 `https://tokenflux.cloud/pricing` 添加为可选定价站点，探测并对接其公开 API `GET https://tokenflux.cloud/api/pricing`，
新增 `tokenflux` 响应格式与 normalizer，注册 station preset 与 provider，补充回归测试。

## Verified Site Behavior

- 页面 `https://tokenflux.cloud/pricing` 是 JS 渲染页面（React），内容通过 `GET https://tokenflux.cloud/api/pricing` 直连获取。
- API 返回 HTTP 200，结构为：
  `{ "success": true, "pricing_version": "...", "auto_groups": [...], "group_ratio": {...}, "vendors": [...], "supported_endpoint": {...}, "usable_group": {...}, "data": [...] }`
- `data` 是一个**扁平数组**（无 `groups` 嵌套），每项代表一个模型，共 ~70 个模型。
- **普通 token 模型** 字段：`model_name`, `vendor_id`, `quota_type`, `model_ratio`, `completion_ratio`, `cache_ratio`, `create_cache_ratio`（可选）, `model_price`（通常为 0）, `enable_groups`, `supported_endpoint_types`.
- **特殊计费模型**：
  - `billing_mode: "tiered_expr"` + `billing_expr`: 复杂分层表达式定价（例如 gpt-6-astra 等），8 个模型。表达式内含 `tier(...)`, 变量 `p`(input), `c`(output), `cr`(cache_read), `cc`(cache_write)，`len` 长度判断。
  - 图片模型（`supported_endpoint_types` 包含 `image-generation`）：`model_price` > 0 时为按次/按图片计费，例如 `gpt-image-2` `model_price: 0.06`, `gpt-image-2.5` `model_price: 0.1`.
  - `wan2.7-i2v`: `quota_type: 1`, `model_price: 1`, 非图片类型但按次计费（视频生成）。
- **group_ratio** 位于顶层，映射 group 名称到倍率，例如 `{ "default": 1, "Gork": 0.5, "MIMO": 0.5, "Claude Code 特惠": 0.2, ... }`。
- **价格含义**：`model_ratio` 是 1M token 的价格（单位 CNY），`completion_ratio` 是输出/输入的比例。最终价格 = `model_ratio * group_ratio[group]`。
- `auto_groups`: `["Codex号池"]` — 自动分配的组。
- API 无需认证、无需登录，`credentials: "omit"` 即可访问。
- 站点提及"API Key 管理、统一计费"，但**公开定价接口无需认证**。

## Confirmed Facts

- TokenFlux API 格式**不兼容**现有的 `model-plaza` normalizer（`data.groups` 嵌套结构），需要**全新的 normalizer**。
- 现有 `model-plaza` 策略假设 `pricing.input_price` / `pricing.output_price` 字段，TokenFlux 使用 `model_ratio` + `completion_ratio` 的比例模式。
- `tiered_expr` 计费模式使用表达式字符串，无法直接映射到现有的 token/image/per_request 模式，需要新增 `unsupportedBillingModes` 记录或特殊处理。
- 图片模型的 `model_price` 字段对应 `image_price`（按图片计费）。
- `wan2.7-i2v` 等 `quota_type: 1` 模型但非图片，`model_price` 按次计费，属 `per_request` 模式。

## Requirements

- R1：新增 `tokenflux` 响应格式定义（`response-formats.js`），标签为 "TokenFlux 定价"。
- R2：新增 `TokenFluxStrategy` normalizer，处理 `data` 扁平数组，输出 `model_name`、`input_price`、`output_price`、`group_ratio`、`enable_groups` 等字段。
- R3：TokenFlux profile 配置 `groupMultiplier` 从顶层 `group_ratio` 映射，`currency` 推断为 CNY。
- R4：处理 `tiered_expr` 计费模式——记录到 `unsupportedBillingModes`，不影响其他模型。
- R5：处理图片/按次计费模型（`model_price > 0` 且 `quota_type === 1` 或 `supported_endpoint_types` 含 `image-generation`）——输出 `image_price` 或 `request_price`。
- R6：注册 `tokenflux.cloud` provider，endpoint `/api/pricing`，`credentials: "omit"`，`responseFormat: "tokenflux"`。
- R7：注册 `tokenflux` preset，`priceCurrency: "CREDITS"`，`priceCurrencyVerified: true`。
- R8：添加回归测试，覆盖 API 响应解析、价格计算、group倍率应用、特殊计费模式记录。
- R9：运行 `npm --prefix extension test` 确认不影响其他站点。

## Acceptance Criteria

- [ ] TokenFlux 出现在站点列表中，通过 `/api/pricing` 直接采集。
- [ ] 普通 token 模型（例如 `deepseek-v4-flash`) 解析为 `input_price` + `output_price`，价格 = `model_ratio * group_ratio[group]`。
- [ ] 图片模型（例如 `gpt-image-2`) 解析为 `image_price = model_price * group_ratio[group]`，`input_price`/`output_price` 为空。
- [ ] `tiered_expr` 计费模型记录在 `unsupportedBillingModes` 中，不破坏整体解析。
- [ ] `group_ratio` 正确应用于所有模型，`incomplete` 仅当存在 `unsupportedBillingModes` 时为 `true`。
- [ ] `npm --prefix extension test` 通过，其他站点行为不变。

## Out of Scope

- 解析 `tiered_expr` 计费表达式字符串为区间价格。
- TokenFlux 账户体系、API Key 管理、登录-only 接口。
- 处理 `billing_usage_schema`（视频分辨率等）等复杂计费规则。
- 调整其他供应商 normalizer 或 provider 注册。

## Known Limitations

- TokenFlux 使用 CNY 定价（`model_ratio` 是 1M token 价格），但未公开充值折算，`rechargeRateVerified` 设为 `false`，不参与已验证比价推荐。
- `tiered_expr` 模型（约 8 个）暂不支持，将记录为 `unsupportedBillingModes`。
- 部分模型 `model_ratio` 值为 37.5（显示为 100% 返券/0 折），属异常值，正常记录。
