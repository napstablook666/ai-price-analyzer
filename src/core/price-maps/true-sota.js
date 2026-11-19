// TrueSOTA 的价格映射文档。
//
// 独有形状：分组不是挂在模型上，也不是把模型挂在分组下，而是两边分开摆，
// 模型只带一个 group_id 外键，分组名和倍率要去 data.groups 里查。
// 价格本身是按 token 的美元原价（0.00001），换算成每百万要乘 1e6。
//
// 出图模型走另一条路：billing_mode 是 image，价格在 pricing.intervals 里按
// 1K / 2K / 4K 分档给出，有些模型只给分档价、顶层 per_request_price 是 null。

export const trueSotaPriceMap = {
  schemaVersion: "price-map/1",
  source: "true-sota",
  // 站点的 model_ratio 按 1 = $2/M 记，写回倍率字段时按这个折算。
  ratioBase: 2,
  rootPath: "/data/models",
  nameField: "name",
  currency: "USD",
  groups: {
    lookupPath: "/data/groups",
    keyPath: "id",
    refPath: "group_id",
    namePath: "name",
    ratioPath: "rate_multiplier"
  },
  rules: [
    {
      when: { path: "pricing.billing_mode", equals: "image" },
      kind: "request",
      price: "pricing.per_request_price",
      unit: "image",
      mediaType: "image",
      // 三档各自一笔绝对价。只有一档的模型会并回一行。
      sizeTiers: {
        path: "pricing.intervals",
        nameField: "tier_label",
        priceField: "per_request_price"
      }
    },
    {
      kind: "token",
      // 站点给的是每 token 的美元价，乘 1e6 换成每百万 token，和榜单口径一致。
      input: "input_price * 1000000",
      output: "output_price * 1000000",
      cacheRead: "cache_price * 1000000",
    }
  ]
};
