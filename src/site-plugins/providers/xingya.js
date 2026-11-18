// 由 scripts/plugin-build.mjs 从 plugins/ 生成，不要手改。重新生成：node scripts/plugin-build.mjs

import { DEFAULT_PRICING_ENDPOINT, requestPolicy } from "../../core/provider-registry.js";

// 站点画像（2026-11-18 匿名 curl 实测，UA 用 Chrome 131）：
//   /api/pricing 200、33076 字节、83 个模型、13 个分组倍率、81 条 billing_expr
//   /api/status 200、price = 1、quota_per_unit = 500000、custom_currency_symbol = 🌱、
//   custom_currency_exchange_rate = 100，公告写「1 元 = 100 芽点」，即 1 元 = 1 美元额度，无阶梯赠送
//   /api/notice 有完整的分组折扣表：月卡1 打 0.88、月卡2 打 0.85（default 组）
//   /api/ratio_config 403、/api/user/self 401、/api/subscription/plans 401
//   → 价格、倍率、充值比例全都不用登录，月卡本身的售价要登录才看得到，这里不采
//
// 计价口径（和 newcodex 同源，但倍率基准不同，别混）：
//   billing_expr 的系数就是美元/百万 token，乘分组倍率后生效，例：
//     gemini-3.5-flash-lite → tier("base", p*0.3 + c*2.5 + cr*0.03) → $0.3 / $2.5 / 缓存读 $0.03
//     claude-sonnet-5       → p*2 + c*10 + cr*0.2 + cc*2.5 + cc1h*4
//   quota_type = 1 的按次模型把 model_price 直接当美元/次，例：[芽]claude-opus-4-6 = $0.06/次
//   这些条目的 model_ratio 一律填 37.5 当占位，真实价只能从表达式或 model_price 取；
//   抽样核对 deepseek-v4-pro 的 model_ratio = 4.5 对上 p*4.5，所以是 tokenflux 的 1 = $1/M 基准，不乘 2
//
// 分组：default 1 / gemini-ultra 0.5 / aws-kiro 0.8 / vertex-gemini 1.8 / GPT-plus 0.2 /
//      签到-福利分组 1 / GPT-pro 0.4 / 反重力-claude 0.5 / 国模 0.3
//      ccmax 1.3、Gemini按量 0.4、Gemini-按次-福利 1、auto 1 这四组在倍率表里但没挂模型，如实留空
//
// 这份插件不写任何采集代码：/pricing 的形状归到 price-map 的 tokenflux 基座，
// 站点差异只有 source / currency 两个字段。
const PRICE_MAP = { base: "tokenflux", source: "xingya", currency: "USD" };

const preset = {
  id: "xingya",
  name: "星芽API",
  baseUrl: "https://xingya.site/pricing",
  rechargeRmb: 1,
  rechargeCredits: 1,
  rechargeRateVerified: true,
  rechargeRateNote:
    "站点 /api/status：price = 1、quota_per_unit = 500000、custom_currency_exchange_rate = 100、货币符号 🌱，" +
    "公告写「1 元 = 100 芽点」，即 1 元 = 1 美元额度，无阶梯赠送。充值走微信站内直充，或支付宝发卡站 16688.com.cn/shop/XINGYA 买兑换码。" +
    "月卡订阅（default 组月卡1 ×0.88、月卡2 ×0.85）的具体售价在 /api/subscription/plans，需要登录才能看到，这里不采信。",
  // 无阶梯，1:1 到底，只记一条
  rechargeTiers: [{ amount: 1, discount: 1 }],
  rechargePlansVerified: true,
  rechargePlans: [
    {
      kind: "topup",
      amount: 100,
      credits: 100,
      currency: "CNY",
      availability: "self_service",
      verified: true,
      note: "1 元 = 100 芽点 = 1 美元额度，无阶梯赠送"
    }
  ],
  priceCurrency: "USD",
  priceCurrencyVerified: true,
  priceCurrencyNote: "报价是官方价 × 分组倍率（0.2–1.8），按次模型直接是美元/次。",
  enabled: true,
  mode: "direct",
  auth: { type: "none" },
  adapter: {
    kind: "declarative",
    endpoint: DEFAULT_PRICING_ENDPOINT,
    method: "GET",
    responseFormat: "price-map",
    priceMap: PRICE_MAP
  }
};

const prepareAdapter = stationInput => ({
  ...(stationInput.adapter || {}),
  kind: "declarative",
  endpoint: DEFAULT_PRICING_ENDPOINT,
  method: "GET",
  responseFormat: "price-map",
  priceMap: PRICE_MAP
});

const pluginSource = {
  id: "xingya",
  host: "xingya.site",
  preserveRechargeRateVerification: true,
  matches: ({ hostname, path }) =>
    (hostname === "xingya.site" || hostname === "xingya.space") && ["/", "/pricing"].includes(path),
  prepareMatches: ({ hostname }) => hostname === "xingya.site" || hostname === "xingya.space",
  prepare: (stationInput, { url }) => ({
    ...stationInput,
    baseUrl: `${url.origin}/pricing`,
    rechargeRateVerified: stationInput.rechargeRateVerified === true,
    mode: "direct",
    auth: { type: "none" },
    adapter: prepareAdapter(stationInput)
  }),
  mode: "direct",
  responseFormat: "price-map",
  priceMap: PRICE_MAP,
  authType: "none",
  rationale: "星芽API 通过公开 /api/pricing 直连采集，按次模型取 model_price，其余从 billing_expr 解析",
  preset,
  request: requestPolicy(() => DEFAULT_PRICING_ENDPOINT, { credentials: "omit" })
};

const MODEL_ALIASES = [];

export const sitePlugin = { ...pluginSource, modelAliases: MODEL_ALIASES };
