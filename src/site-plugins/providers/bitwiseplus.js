// 由 scripts/plugin-build.mjs 从 plugins/ 生成，不要手改。重新生成：node scripts/plugin-build.mjs

import { DEFAULT_PRICING_ENDPOINT, requestPolicy } from "../../core/provider-registry.js";

// BitwisePlus 取证（2026-11-25，匿名直连 /api/pricing + /api/status，不需要登录）：
//   16 个模型 3 个分组（default 0.2、image 0.2、sale 0.1），全部是折扣组，等于是官方价的 1~2 折。
//   11 个模型带 billing_expr，5 个按张，0 条算不出价。
//   倍率基准对不齐：gpt-5.6-sol 的 ratio 2.5 配 expr p * 4 反推基准 1.6、gpt-5.6-terra 的 1.25 配 p * 2 反推 1.6，
//     而 gpt-5.6-luna 的 0.5 配 p * 1 反推 2.0。同一站内基准不一致，说明 ratio 是旧的占位值，以表达式为准，不写 ratioBase 覆盖。
//   FAQ 另一条：「编程模型选 sale，生图选 image。选错了可以重新建一个令牌」——分组按用途分，价差 2 倍。

const PRICE_MAP = { base: "allrouter" };

const HOSTS = ["bitwiseplus.cc"];
const PATHS = ["/","/pricing","/console/topup"];

const preset = {
  id: "bitwiseplus",
  name: "BitwisePlus",
  baseUrl: "https://bitwiseplus.cc/pricing",
  rechargeAuto: false,
  rechargeRmb: 1,
  rechargeCredits: 1,
  rechargeRateVerified: true,
  rechargeRateNote: "两边对不上，取站点自述：FAQ 明写「额度用完了怎么办？进交流群或私信获取兑换码，¥1 = $1」，而 /api/status 的 price = 7.3 是在线充值渠道的价格，两者差 7.3 倍。表里按 ¥1 = 1 美元额度算，因为用户实际拿额度走的是兑换码这条；rechargeAuto 关掉，避免采集值把 7.3 又盖回来。",
  rechargePlansVerified: false,
  priceCurrency: "USD",
  priceCurrencyVerified: true,
  priceCurrencyNote: "报文里的倍率与 billing_expr 系数都是美元额度价，报价 = 官方价 × 分组倍率；price = 7.3、quota_per_unit = 500000、quota_display_type = CNY、usd_exchange_rate = 1、stripe_unit_price = 8。控制台按站点设置的币种显示额度，不影响这里的价格。",
  enabled: true,
  mode: "direct",
  auth: { type: "none" },
  adapter: { kind: "declarative", endpoint: DEFAULT_PRICING_ENDPOINT, method: "GET", responseFormat: "price-map", priceMap: PRICE_MAP }
};

const pluginSource = {
  id: "bitwiseplus",
  host: "bitwiseplus.cc",
  preset,
  matches: ({ hostname, path }) => HOSTS.includes(hostname) && PATHS.includes(path),
  prepareMatches: ({ hostname }) => HOSTS.includes(hostname),
  prepare: (stationInput, { url }) => ({
    ...stationInput,
    baseUrl: `${url.origin}/pricing`,
    mode: "direct",
    auth: { type: "none" },
    adapter: { ...(stationInput.adapter || {}), kind: "declarative", endpoint: DEFAULT_PRICING_ENDPOINT, method: "GET", responseFormat: "price-map", priceMap: PRICE_MAP }
  }),
  mode: "direct",
  responseFormat: "price-map",
  authType: "none",
  rationale: "BitwisePlus 的 /api/pricing 匿名可读，16 个模型 3 个用途分组，充值口径按站点 FAQ 的自述取",
  request: requestPolicy(() => DEFAULT_PRICING_ENDPOINT, { credentials: "omit" })
};

const MODEL_ALIASES = [];

export const sitePlugin = { ...pluginSource, modelAliases: MODEL_ALIASES };
