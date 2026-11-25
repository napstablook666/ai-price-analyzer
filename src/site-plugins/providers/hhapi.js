// 由 scripts/plugin-build.mjs 从 plugins/ 生成，不要手改。重新生成：node scripts/plugin-build.mjs

import { DEFAULT_PRICING_ENDPOINT, requestPolicy } from "../../core/provider-registry.js";

// HHapi 取证（2026-11-25，匿名直连 /api/pricing + /api/status，不需要登录）：
//   59 个模型、27 个分组、102 条「模型 × 分组」以外的组合按 enable_groups 展开后共 187 条报价行。
//   58 个模型把真实价写在 billing_expr 里（claude-sonnet-5 是 tier("standard", p * 2 + cr * 0.2 + cc * 2.5 + cc1h * 4 + c * 10)），
//   ratio 一律填 37.5 当占位，所以表达式优先、倍率只做兜底，正好是 allrouter 基座的处理顺序。
//   倍率基准核对过：claude-fable-5 ratio 5 ↔ expr p * 10，1 单位 = 2 美元/百万，不写 ratioBase 覆盖。
//   分组是这一批里最花的一家，从 0.06（GPT 特惠、GPT福利-不降智 0.065）到 10（胖虎），同一模型在不同组差价 100 倍以上。
//   6 个模型算不出价，全部是站点自己标 0 价的占位行 tier("base", p * 0 + c * 0)（gemini-6-astra、gpt-10-uni、
//   claude-fable-7、deepseek-v5-pro、王者灵宝 都在「特殊渠道」组），加 jev-latest 用的是 u("input_tokens") 计量，
//   解析器见到 u( 就跳过。这些行进 unresolved，不给假价。
//   gpt-image-2.6-flare 与带 -all 后缀的是同一档生图的不同售卖范围，别名归到同一个规范 id。

const PRICE_MAP = { base: "allrouter" };

const HOSTS = ["hhapi.xyz","www.hhapi.xyz"];
const PATHS = ["/","/pricing","/console/topup"];

const preset = {
  id: "hhapi",
  name: "HHapi",
  baseUrl: "https://hhapi.xyz/pricing",
  rechargeRmb: 1,
  rechargeCredits: 1,
  rechargeRateVerified: true,
  rechargeRateNote: "price = 1 即「1 元 = 1 美元额度」。FAQ 里的充值是发卡站 catfk.com/shop/YHWND9V7/i9kfnx 买兑换码，并注明「10 元起充」，没有写兑换码的赠送档位。",
  rechargePlansVerified: false,
  priceCurrency: "USD",
  priceCurrencyVerified: true,
  priceCurrencyNote: "报文里的倍率与 billing_expr 系数都是美元额度价，报价 = 官方价 × 分组倍率；price = 1、quota_per_unit = 500000、quota_display_type = USD、usd_exchange_rate = 1、stripe_unit_price = 8。控制台按站点设置的币种显示额度，不影响这里的价格。",
  enabled: true,
  mode: "direct",
  auth: { type: "none" },
  adapter: { kind: "declarative", endpoint: DEFAULT_PRICING_ENDPOINT, method: "GET", responseFormat: "price-map", priceMap: PRICE_MAP }
};

const pluginSource = {
  id: "hhapi",
  host: "hhapi.xyz",
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
  rationale: "HHapi 的 /api/pricing 匿名可读，59 个模型 27 个分组、表达式与充值口径都不需要登录",
  request: requestPolicy(() => DEFAULT_PRICING_ENDPOINT, { credentials: "omit" })
};

const MODEL_ALIASES = [
  {
    "alias": "gpt-image-2.5-flare-all",
    "canonicalId": "gpt-image-2-5"
  },
  {
    "alias": "gpt-image-2.5-sunburst-all",
    "canonicalId": "gpt-image-2-5"
  },
  {
    "alias": "gpt-image-2.6-flare-all",
    "canonicalId": "gpt-image-2-6"
  },
  {
    "alias": "gpt-image-2.6-sunburst-all",
    "canonicalId": "gpt-image-2-6"
  },
  {
    "alias": "gemini-4-hydrogen-request",
    "canonicalId": "gemini-4-hydrogen"
  },
  {
    "alias": "gemini-4-argon-request",
    "canonicalId": "gemini-4-argon"
  },
  {
    "alias": "gemini-4-carbon-request",
    "canonicalId": "gemini-4-carbon"
  },
  {
    "alias": "gemini-3.8-flash-request",
    "canonicalId": "gemini-3-8-flash"
  }
];

export const sitePlugin = { ...pluginSource, modelAliases: MODEL_ALIASES };
