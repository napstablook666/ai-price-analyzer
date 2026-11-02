# TokenFlux 站点适配设计

## 目标

让扩展能够从 TokenFlux 的公开定价接口读取模型价格，并把 TokenFlux 作为可选站点展示在站点选择器中。

## 接口契约

- 请求：`GET https://tokenflux.cloud/api/pricing`
- 无认证、无请求参数。
- 响应为对象，成功时 `success: true`，模型列表在 `data` 中。
- 每个模型至少使用 `model_name`、`model_ratio`、`completion_ratio`、`cache_ratio`。
- `model_ratio` 是输入价格，`completion_ratio` 是输出相对输入的倍数，`cache_ratio` 是缓存输入相对输入的倍数。
- 价格单位：CNY / 1M tokens；采集时由现有 `modelListCurrency: "CREDITS"` 统一保留为比较基准。

## 数据流

`station-presets.js` 提供站点元数据和请求配置 → `provider-registry.js` 注册并识别站点 → `response-formats.js` 将站点路由到 `TokenFluxPricingStrategy` → `normalizers.js` 请求 `/api/pricing`，校验响应并按模型字段归一化 → 现有缓存、筛选、排序和展示流程继续复用。

## 归一化规则

- `input`: `model_ratio`
- `output`: `model_ratio * completion_ratio`
- `cache_read`: `model_ratio * cache_ratio`
- `cache_write`: 使用 `create_cache_ratio`；TokenFlux 未提供独立写入比例时保持 `null`。
- 缺失或非有限数值的模型项跳过，不让单条脏数据阻断整站加载。
- `model_name` 为空的模型项跳过。
- 统一保留模型名和分组字段，让现有模型排序和去重逻辑工作。

## 兼容性与边界

- TokenFlux 使用独立 `TokenFluxPricingStrategy`；其扁平 `data` 结构与 Pqh 不共用计费语义，避免误把 CNY、图片按次和 tiered 表达式当成 Pqh/USD。
- 价格为零的合法模型保留；仅过滤结构错误或非有限价格。
- 请求失败继续由现有归一化错误处理负责。
- 不新增依赖，不改动其他站点的字段映射。

## 验证

覆盖成功响应、缓存字段、缺失倍率字段和 malformed response；确认旧站点测试继续通过，且站点显示名、请求 URL、图标和默认关闭状态正确。
