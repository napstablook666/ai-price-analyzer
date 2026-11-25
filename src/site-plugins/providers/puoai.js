// 由 scripts/plugin-build.mjs 从 plugins/ 生成，不要手改。重新生成：node scripts/plugin-build.mjs

import { DEFAULT_PRICING_ENDPOINT, requestPolicy } from "../../core/provider-registry.js";

// PuoAI 取证（2026-11-25，匿名直连 /api/pricing + /api/status，不需要登录）：
//   28 个模型全部带 billing_expr，只有 default 一个分组（倍率 1），报价行 25 条。
//   倍率基准对不齐（gpt-5.6-sol 的 ratio 2.5 配 p * 2.2、gpt-5.6-terra 的 1.25 配 p * 0.9），
//     ratio 是占位值，以表达式为准，不写 ratioBase 覆盖。
//   nano-banana 系列是 Gemini 生图的站内叫法，按规范表的名字归到 gemini-3-1-flash-image / gemini-3-pro-image /
//     gemini-3-1-flash-lite-image。-cl / -2k-cl / -4k-cl / -vip / -4k-vip 是同一档的分辨率与渠道变体，归到同一个模型；
//     nano-banana-2.1 在规范表里有 preview 与非 preview 两个同名 id，无法判定，不写别名。
//   3 个算不出价：agnes-video-2.5 / minimax-h3 / wan-3.0 的表达式是 tier("base", p * 0 + c * 0) 占位 0 价，
//     带 billing_usage_schema 但没有非 0 系数，进 unresolved。
//   stripe_unit_price = 1，与其它家的 8 不同，说明这家配过美元支付单位；报文里没有档位字段，档位留空。

const PRICE_MAP = { base: "allrouter" };

const HOSTS = ["puoai.com","www.puoai.com"];
const PATHS = ["/","/pricing","/console/topup"];

const preset = {
  id: "puoai",
  name: "PuoAI",
  baseUrl: "https://puoai.com/pricing",
  rechargeRmb: 1,
  rechargeCredits: 1,
  rechargeRateVerified: true,
  rechargeRateNote: "price = 1 即「1 元 = 1 美元额度」。usd_exchange_rate = 7.3 是站内把额度折成美元参考价用的显示值，不是充值比例，不用它当汇率。",
  rechargePlansVerified: false,
  priceCurrency: "USD",
  priceCurrencyVerified: true,
  priceCurrencyNote: "报文里的倍率与 billing_expr 系数都是美元额度价，报价 = 官方价 × 分组倍率；price = 1、quota_per_unit = 500000、quota_display_type = USD、usd_exchange_rate = 7.3、stripe_unit_price = 1。控制台按站点设置的币种显示额度，不影响这里的价格。",
  enabled: true,
  mode: "direct",
  auth: { type: "none" },
  adapter: { kind: "declarative", endpoint: DEFAULT_PRICING_ENDPOINT, method: "GET", responseFormat: "price-map", priceMap: PRICE_MAP }
};

const pluginSource = {
  id: "puoai",
  host: "puoai.com",
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
  rationale: "PuoAI 的 /api/pricing 匿名可读，28 个模型单分组、全部走表达式，充值口径取自 /api/status",
  request: requestPolicy(() => DEFAULT_PRICING_ENDPOINT, { credentials: "omit" })
};

const MODEL_ALIASES = [
  {
    "alias": "nano-banana-2",
    "canonicalId": "gemini-3-1-flash-image"
  },
  {
    "alias": "nano-banana-2-cl",
    "canonicalId": "gemini-3-1-flash-image"
  },
  {
    "alias": "nano-banana-2-2k-cl",
    "canonicalId": "gemini-3-1-flash-image"
  },
  {
    "alias": "nano-banana-2-4k-cl",
    "canonicalId": "gemini-3-1-flash-image"
  },
  {
    "alias": "nano-banana-2-lite",
    "canonicalId": "gemini-3-1-flash-lite-image"
  },
  {
    "alias": "nano-banana-pro",
    "canonicalId": "gemini-3-pro-image"
  },
  {
    "alias": "nano-banana-pro-cl",
    "canonicalId": "gemini-3-pro-image"
  },
  {
    "alias": "nano-banana-pro-vip",
    "canonicalId": "gemini-3-pro-image"
  },
  {
    "alias": "nano-banana-pro-4k-vip",
    "canonicalId": "gemini-3-pro-image"
  },
  {
    "alias": "gemini-3.1-pro",
    "canonicalId": "gemini-3-1-pro-preview"
  }
];

export const sitePlugin = { ...pluginSource, modelAliases: MODEL_ALIASES };
