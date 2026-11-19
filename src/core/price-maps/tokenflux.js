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
  // model_ratio 的单位是「官方价 ÷ 2 美元/百万」，不是 1 美元。三处实测都对得上：
  //   tokenflux   gpt-6-astra      ratio 5    ↔ billing_expr 里 p*10
  //   allrouter   claude-opus-5-5  ratio 2    ↔ p*4；deepseek-v4.1-flash 0.15 ↔ p*0.3
  //   centos      claude-sonnet-4-5 ratio 1.5 ↔ 官方 $3；claude-opus-4-6 2.5 ↔ 官方 $5
  // 缺省即系统基准（ratio 1 = $2 美元/百万），这里不写 ratioBase；
  // 偏离基准的站点才在自己的声明里给值。
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
