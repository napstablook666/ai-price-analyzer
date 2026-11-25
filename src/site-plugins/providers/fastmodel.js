// 由 scripts/plugin-build.mjs 从 plugins/ 生成，不要手改。重新生成：node scripts/plugin-build.mjs

import { DEFAULT_PRICING_ENDPOINT, requestPolicy } from "../../core/provider-registry.js";

// Fast Model 取证（2026-11-25，匿名直连 /api/pricing + /api/status，不需要登录）：
//   46 个模型只有一个 default 分组（倍率 1），是这一批里唯一不分组的按量站。
//   32 个模型带 billing_expr，13 个按次/按张，剩下 1 个走纯倍率。
//   倍率基准：deepseek-v4-flash 的 ratio 1 配 expr p * 0.25、deepseek-v4-pro 的 2.25 配 p * 1.125，
//     ratio 明显是旧的占位值，以表达式为准，所以不写 ratioBase 覆盖。
//   15 个算不出价全是 minimax_h3 系列视频模型，表达式是分时的秒计价：
//     tier("base", u("seconds") * (hour("Asia/Shanghai") < 8 ? 0.12 : 0.2))，带 hour() 与 u() 计量，解析器跳过。
//     这 15 个的 model_ratio 一律 37.5（占位），没有第二个数能还原真实价，所以进 unresolved 而不是瞎算。
//   FAQ 只写了「deepseek 为主，GLM 为辅，计划上新 GPT 模型」，没有充值口径。

const PRICE_MAP = { base: "allrouter" };

const HOSTS = ["fastmodel.top"];
const PATHS = ["/","/pricing","/console/topup"];

const preset = {
  id: "fastmodel",
  name: "Fast Model",
  baseUrl: "https://fastmodel.top/pricing",
  rechargeRmb: 7.3,
  rechargeCredits: 1,
  rechargeRateVerified: true,
  rechargeRateNote: "price = 7.3、usd_exchange_rate = 7.3，判定 1 美元额度 = ¥7.3；站点没有自述档位，收银台要登录，档位留空。",
  rechargePlansVerified: false,
  priceCurrency: "USD",
  priceCurrencyVerified: true,
  priceCurrencyNote: "报文里的倍率与 billing_expr 系数都是美元额度价，报价 = 官方价 × 分组倍率；price = 7.3、quota_per_unit = 500000、quota_display_type = USD、usd_exchange_rate = 7.3、stripe_unit_price = 8。控制台按站点设置的币种显示额度，不影响这里的价格。",
  enabled: true,
  mode: "direct",
  auth: { type: "none" },
  adapter: { kind: "declarative", endpoint: DEFAULT_PRICING_ENDPOINT, method: "GET", responseFormat: "price-map", priceMap: PRICE_MAP }
};

const pluginSource = {
  id: "fastmodel",
  host: "fastmodel.top",
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
  rationale: "Fast Model 的 /api/pricing 匿名可读，46 个模型单分组、表达式与按次报价都不需要登录",
  request: requestPolicy(() => DEFAULT_PRICING_ENDPOINT, { credentials: "omit" })
};

const MODEL_ALIASES = [
  {
    "alias": "gemini-3.8-flash-high",
    "canonicalId": "gemini-3-8-flash"
  },
  {
    "alias": "gemini-4-argon-high",
    "canonicalId": "gemini-4-argon"
  },
  {
    "alias": "gemini-4-hydrogen-xhigh",
    "canonicalId": "gemini-4-hydrogen"
  }
];

export const sitePlugin = { ...pluginSource, modelAliases: MODEL_ALIASES };
