// Sidrune 的价格映射文档。
//
// 两个形状混在一份接口里：163 个按 token 计价的模型，和 6 个按张计价的出图模型，
// 靠 `billing_mode` 分路。token 那批还会附带图片 token 价（图片输入、图片输出各一笔），
// 出图那批在 `intervals` 里按 1K / 2K / 4K 各给一笔整图价。
//
// 分组是多对多：一份价挂好几个分组，每个分组按自己的倍率各出一行。
// 而且分组的倍率有三层——促销价压常规价，图片又可能单独定倍率。

export const sidrunePriceMap = {
  schemaVersion: "price-map/1",
  source: "sidrune",
  rootPath: "/data/pricing",
  nameField: "name",
  currency: "USD",
  groups: {
    lookupPath: "/data/groups",
    keyPath: "id",
    refPath: "group_ids",
    namePath: "name",
    // 促销开关打开时，促销倍率说了算；否则先用站点算好的折扣价倍率。
    ratio: [
      { when: { path: "promo_active", equals: true }, path: "promo_rate_multiplier" },
      { path: "effective_rate_multiplier" },
      { path: "rate_multiplier" }
    ],
    // 图片走独立倍率这件事由站点开关决定，没开就跟着文本倍率。
    mediaRatio: [
      { when: { path: "image_rate_independent", equals: true }, path: "image_rate_multiplier" }
    ]
  },
  rules: [
    {
      when: { path: "billing_mode", equals: "video" },
      kind: "unsupported",
      sourcePath: "media",
      reason: "视频按输出 token、分辨率等条件计费，暂不能折算为文本输入价"
    },
    {
      when: { path: "billing_mode", equals: "image" },
      kind: "request",
      // 顶层这笔是默认档，真正区分大小的是下面的三档。
      price: "per_request_price",
      unit: "image",
      mediaType: "image",
      sizeTiers: {
        path: "intervals",
        nameField: "tier_label",
        priceField: "per_request_price"
      }
    },
    {
      kind: "token",
      // 站点给的是每 token 的美元价，乘 1e6 换成每百万 token。
      input: "input_price * 1000000",
      output: "output_price * 1000000",
      cacheRead: "cache_read_price * 1000000",
      cacheWrite: "cache_write_price * 1000000",
      cacheWrite1h: "cache_write_1h_price * 1000000",
      imageInput: "image_input_price * 1000000",
      imageOutput: "image_output_price * 1000000",
    }
  ]
};
