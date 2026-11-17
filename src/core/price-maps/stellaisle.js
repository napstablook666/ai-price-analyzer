// Star API（token.stellaisle.com）的价格映射。
//
// 报文和 TokenFlux 同构：/api/pricing 一次给齐 data / group_ratio / usable_group /
// vendors，所以规则一条不改地复用 tokenflux 那份，只换 source 名字。
//
// 唯一的差别在分组：90 条模型的 enable_groups 全是空数组。按 New API 语义，
// 空数组 = 该模型在所有分组可用，倍率由 group_ratio 决定。默认的 groupSelection
// 见到空列表就整条丢掉，这里打开 emptyMeansAll，让分组清单从倍率表的键反推。

import { tokenfluxPriceMap } from "./tokenflux.js";

export const stellaislePriceMap = {
  ...tokenfluxPriceMap,
  source: "stellaisle",
  groups: { ...tokenfluxPriceMap.groups, emptyMeansAll: true }
};
