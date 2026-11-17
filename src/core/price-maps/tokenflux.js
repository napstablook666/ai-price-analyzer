// TokenFlux 的价格映射文档。
//
// 这份文件替代 normalizers.js 里的 TokenFluxPricingStrategy：
// 站点改了字段名，只改这里，不动代码。规则按顺序匹配，第一条命中的生效。
//
// 1. billing_expr  —— tiered_expr 模式，表达式里带上下文长度分段
// 2. 出图 + 有张价 —— 按张计，站内自带 1K / 2K / 4K 倍率表
// 3. quota_type=1 —— 按次 / 按秒
// 4. 其余        —— 按 token

export const tokenfluxPriceMap = {
  schemaVersion: "price-map/1",
  source: "tokenflux",
  rootPath: "/data",
  nameField: "model_name",
  labelField: "model_name",
  currency: "CNY",
  groups: {
    listPath: "enable_groups",
    ratioPath: "/group_ratio",
    usablePath: "/usable_group"
  },
  rules: [
    {
      when: { path: "billing_expr", present: true },
      kind: "expression",
      exprPath: "billing_expr"
    },
    {
      when: [
        { path: "supported_endpoint_types", contains: "image-generation" },
        { path: "model_price", gt: 0 }
      ],
      kind: "request",
      price: "model_price",
      unit: "image",
      mediaType: "image",
      // 站内自己给了分辨率档和倍率，直接当尺寸档用，不再从图像尺寸反推。
      sizeTiers: {
        path: "image_billing_rule.resolution_tiers",
        nameField: "name",
        factorField: "ratio"
      },
      mediaSpecsPath: "billing_usage_schema"
    },
    {
      when: { path: "quota_type", equals: 1 },
      kind: "request",
      price: "model_price",
      unit: [
        { path: "supported_endpoint_types", map: { "video-generation": "second" } },
        { path: "billing_usage_schema.seconds", present: "second" },
        { fallback: "request" }
      ],
      mediaType: [
        { path: "supported_endpoint_types", map: { "image-generation": "image" } },
        { path: "billing_usage_schema.seconds", present: "video" }
      ],
      mediaSpecsPath: "billing_usage_schema"
    },
    {
      kind: "token",
      input: "model_ratio",
      output: "model_ratio * completion_ratio",
      cacheRead: "model_ratio * cache_ratio",
      cacheWrite: "model_ratio * create_cache_ratio",
      // 只报 token 价的出图模型（gpt-image-2.5-sunburst 这类）按图输出 token 计价，
      // 媒体类型标成 image，进生图榜而不是文本榜。
      mediaType: { path: "supported_endpoint_types", map: { "image-generation": "image" } },
      mediaSpecsPath: "billing_usage_schema",
      tierName: "标准"
    }
  ]
};
