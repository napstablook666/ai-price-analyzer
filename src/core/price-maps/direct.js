// 「直价」形状的映射：报文不写倍率，直接给每百万 token 的价。
//
// New API 系的中转站大多数仍走 model_ratio（1 倍率 = $2/百万），但把计费改成 direct
// 之后，同一条目里给的是 input_price / output_price / cache_read_price / cache_write_price
// 四个绝对价，外加 billing_type 区分按 token 还是按次。这时倍率没有含义，插值的
// 只有分组倍率，而那部分由 groups.ratio 负责，所以规则里不需要 ratioBase。
//
// 价的单位跟着站点显示币种走：quota_display_type = CNY 的就是人民币。基座默认按 CNY，
// 用美元标价的站点在自己的插件里覆盖 `currency: "USD"`。
export const directPriceMap = {
  schemaVersion: "price-map/1",
  source: "direct",
  rootPath: "/data",
  nameField: "model_name",
  currency: "CNY",
  groups: {
    listPath: "enable_groups",
    ratioPath: "/group_ratio",
    usablePath: "/usable_group"
  },
  rules: [
    {
      // 输入价和按次价同时为 0 的条目，站点自己就标着按 0 计费（免费上游）。
      // 这类模型没有可比的价格，与其算出一行 0 元，不如明确报「不参与比价」。
      when: [
        { path: "input_price", equals: 0 },
        { path: "request_price", equals: 0 }
      ],
      kind: "unsupported",
      reason: "站点按 0 计费（免费模型），不参与比价"
    },
    {
      when: { path: "billing_type", equals: "request" },
      kind: "request",
      price: "request_price",
      // 出图模型按张、语音合成按次，差别只在倍率表里；单位按端点类型判。
      unit: [{ path: "supported_endpoint_types", map: { "image-generation": "image", image: "image" }, fallback: "request" }],
      mediaType: [{ path: "supported_endpoint_types", map: { "image-generation": "image", image: "image" }, fallback: "request" }]
    },
    {
      kind: "token",
      input: "input_price",
      output: "output_price",
      cacheRead: "cache_read_price",
      cacheWrite: "cache_write_price"
    }
  ]
};