// 飓星API「租用-拼车中心」（token.stellaisle.com/carpool-market）的价格映射。
//
// 拼车报文的形状和定价接口完全不同：/api/carpool-market 给的是一辆辆车的座位，
// 每个座位有座位价、剩余天数和每周额度，模型清单只是一串名字，没有单价。
// 所以这里的分组不是站点渠道，而是「一辆车一个座位」：
//
//   座位折扣 = 座位价（元） / (每周额度美元 × 剩余天数 / 7)
//
// 站点额度按 1 元 = 1 美元额度计价（见 stellaisle 插件 preset），所以这个折扣
// 直接乘在站内模型价上就是拼车价。分组倍率由采集策略合成，不来自报文本身。
//
// 规则集沿用 tokenflux：拼车的 8 个模型全是 billing_expr（按上下文长度分两档）。

import { tokenfluxPriceMap } from "./tokenflux.js";

export const stellaisleCarpoolPriceMap = {
  ...tokenfluxPriceMap,
  source: "stellaisle-carpool",
  // 这里的分组清单由策略逐条写进 enable_groups，不需要从倍率表反推。
  groups: { ...tokenfluxPriceMap.groups, emptyMeansAll: false }
};
