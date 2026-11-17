// 飓星API（token.stellaisle.com）的价格映射。
//
// 报文和 TokenFlux 同构：/api/pricing 一次给齐 data / group_ratio / usable_group /
// vendors，所以规则一条不改地复用 tokenflux 那份，只换 source 名字。
//
// 差别在分组：90 条模型的 enable_groups 全是空数组，站点自己也不说哪个模型在哪个
// 分组卖。定价页 /pricing 连分组选择器都没有，价格一律按倍率 1 显示；group_ratio 里
// 那 17 个渠道分组（0.12 ~ 1）只在拿 key 调接口时按分组结算，公开接口查不到
// 「模型 ↔ 分组」的对应关系。group-plaza 那份租赁清单是另一套命名，对不上。
//
// 所以一条模型只出一条基准价：分组标成「站内基准价」，倍率 1。
// 早先按 emptyMeansAll 从倍率表的键反推，等于给每个模型编出 17 个分组，
// gpt 模型被挂到「grok分组（特惠）」下面，站上根本没有这回事。

import { tokenfluxPriceMap } from "./tokenflux.js";

export const stellaislePriceMap = {
  ...tokenfluxPriceMap,
  source: "stellaisle",
  groups: { ...tokenfluxPriceMap.groups, unlisted: "站内基准价" }
};
