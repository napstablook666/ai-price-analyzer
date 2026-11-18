// 飓星API（token.stellaisle.com）的价格映射。站点把价格拆成两层，映射也拆两份。
//
// 1. stellaislePriceMap —— /api/pricing 的站内基准价。
//    报文和 TokenFlux 同构：data / group_ratio / usable_group / vendors 一次给齐，
//    规则一条不改地复用 tokenflux 那份，只换 source 名字。
//    这条路径只出基准价：94 条模型的 enable_groups 全是空数组，站点自己也不说哪个
//    模型在哪个渠道分组卖。早先按 emptyMeansAll 从倍率表的键反推，等于给每个模型
//    编出 17 个分组，gpt 模型被挂到「grok分组（特惠）」下面，站上根本没有这回事。
//
// 2. stellaislePlazaPriceMap —— /api/group-plaza 的分组广场，这才是真正能买的分组。
//    列表给 ratio / 状态 / 模型清单 / 供应商，逐组详情 /api/group-plaza/groups/{id}
//    给每个模型的真实价：tiered 给 billing_expr，token 给 input_per_m，
//    按次给 price_per_call。35 个分组里 status=ok 的 21 个展开成 178 行。
//
// 分组广场的价格口径（2026-11 实测验证，改之前先重验）：
// - token 模式：input_per_m 已经乘过分组倍率。同模型跨分组 input_per_m / ratio 恒定
//   （codex-auto-review 在 7 个分组全是 0.75，claude-opus-5-5 在 6 个分组全是 4）。
// - 按次模式：price_per_call 同样已经乘过（gpt-image-2.5 在 ratio 0.143 的分组是
//   0.02145，等于基准 0.15 × 0.143）。
// - tiered 模式：billing_expr 没乘。分组 11 的 gemini-3.8-flash 是 p*0.75，乘 0.473
//   得 0.35475，正好等于同组 gemini-3.8-flash-high 的 input_per_m。
// 所以前两种的倍率恒为 1，只有表达式那一档按分组 ratio 现乘。这条差异落在
// normalizers 的展开逻辑里（每条数据的 __group_ratio），映射只负责读它。

import { tokenfluxPriceMap } from "./tokenflux.js";

export const stellaislePriceMap = {
  ...tokenfluxPriceMap,
  source: "stellaisle",
  groups: { ...tokenfluxPriceMap.groups, unlisted: "站内基准价" }
};

export const stellaislePlazaPriceMap = {
  schemaVersion: "price-map/1",
  source: "stellaisle",
  rootPath: "/data",
  nameField: "model_name",
  labelField: "model_name",
  currency: "CNY",
  groups: {
    // 展开时每条数据都带着分组名与倍率，不用再查站点级表。
    listPath: "__group_name",
    ratioField: "__group_ratio"
  },
  rules: [
    {
      when: { path: "billing_expr", present: true },
      kind: "expression",
      exprPath: "billing_expr"
    },
    {
      when: { path: "pricing_mode", equals: "per_call" },
      kind: "request",
      price: "price_per_call",
      unit: "image",
      mediaType: "image"
    },
    {
      when: { path: "pricing_mode", equals: "token" },
      kind: "token",
      input: "input_per_m",
      output: "output_per_m",
      cacheRead: "cached_input_per_m",
      cacheWrite: "cache_write_per_m",
      tierName: "标准"
    }
  ]
};
