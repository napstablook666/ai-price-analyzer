// CheapRouter 的价格映射文档。
//
// 和 TokenFlux 完全不同的形状：没有顶层 group_ratio 表，没有 model_ratio 比率，
// 每个 item 直接给出已经算好分组折扣的绝对美元价，单位写在字段名后缀里
// （_per_mtok / _per_request / _per_image / _per_second）。
// 上下文长度分档单独放在 pricing_details.intervals，档位里是另一套绝对价。

export const cheapRouterPriceMap = {
  schemaVersion: "price-map/1",
  source: "cheaprouter",
  rootPath: "/data/items",
  nameField: "model",
  labelField: "display_name",
  currency: "USD",
  groups: {
    // 分组名在 item 上，倍率已经被算进 effective_pricing_usd，所以不再乘一次。
    listPath: "group.name"
  },
  rules: [
    {
      when: { path: "billing_mode", equals: "image" },
      kind: "request",
      price: "effective_pricing_usd.per_image_usd",
      unit: "image",
      mediaType: "image",
      // 出图档位 1K / 2K / 4K 各是一笔绝对价。现在三档同一个价，引擎会并成一行；
      // 哪天站点把档位价拉开，这里自动变成三行。
      sizeTiers: {
        path: "pricing_details.media_tiers",
        nameField: "tier",
        priceField: "effective_usd"
      }
    },
    {
      kind: "token",
      input: "effective_pricing_usd.input_per_mtok_usd",
      output: "effective_pricing_usd.output_per_mtok_usd",
      cacheRead: "effective_pricing_usd.cache_read_per_mtok_usd",
      cacheWrite: "effective_pricing_usd.cache_write_per_mtok_usd",
      // 站点的 model_ratio 一律按 basePrice 2 元/1M token 折算，这里跟着算，
      // 否则上游换算出的小数位会和旧实现差一截。
      ratioBase: 2,
      // 长上下文加价的模型会带 intervals，一档一行。没有 intervals 就只出一行。
      tiers: {
        path: "pricing_details.intervals",
        nameField: "tier_label",
        minField: "min_tokens",
        maxField: "max_tokens",
        input: "input_per_mtok_usd",
        output: "output_per_mtok_usd",
        cacheRead: "cache_read_per_mtok_usd",
        cacheWrite: "cache_write_per_mtok_usd"
      }
    }
  ]
};
