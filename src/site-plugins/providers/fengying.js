// 由 scripts/plugin-build.mjs 从 plugins/ 生成，不要手改。重新生成：node scripts/plugin-build.mjs

import { DEFAULT_PRICING_ENDPOINT as PRICING_ENDPOINT, requestPolicy } from "../../core/provider-registry.js";

// 站点画像（2026-11-24 实测）：
//   /api/pricing 匿名 200，tokenflux 形状：53 个模型、5 个 group_ratio 键、倍率 0.1 到 999（999 那个是官方价参照组，不是给人买的）。
//   101 条「模型 × 分组」全部是文本 token 价，没有按次也没有按张，是本批最纯的文本站。
//   14 个模型带 billing_expr，用分时谓词加价：
//   weekday("UTC") 1-5 且 hour("UTC") 落在 1-4 或 6-10 时走 peak 价，其余时段走半价。
//   充值：/api/status 里 price = 0.5、quota_per_unit = 500000、quota_display_type = USD、usd_exchange_rate = 1，
//   即 0.5 元买 1 美元额度；这个价等于把官方价打到 1/14，站点靠分组倍率回收，没付款不核实。
// 站点差异只有这一句：报文形状归到 allrouter 基座（tokenflux 映射 + 图片端点规则 + billing_expr 求解）。
const PRICE_MAP = { base: "allrouter" };

const preset = {
  id: "fengying",
  name: "风影",
  baseUrl: "https://api.fengying.xin/",
  rechargeRmb: 0.5,
  rechargeCredits: 1,
  rechargeRateVerified: false,
  rechargeRateNote: "站点 /api/status：price = 0.5、quota_per_unit = 500000、quota_display_type = USD、usd_exchange_rate = 1。按 New API 口径 price 是「1 美元额度的人民币价」，即 0.5 元 = 1 美元额度；只读了配置，没有真实付款，所以 rechargeRateVerified 为 false，也不列赠送档位。",
  priceCurrency: "USD",
  priceCurrencyVerified: false,
  priceCurrencyNote: "报价由 /api/pricing 的 model_ratio × 分组倍率折算成美元每百万 token（倍率 1 = $2/M），带 billing_expr 的模型以表达式为准；站内按 USD 显示额度，不影响这里的价格。",
  enabled: true,
  mode: "direct",
  auth: { type: "none" },
  adapter: { kind: "declarative", endpoint: PRICING_ENDPOINT, method: "GET", responseFormat: "price-map", priceMap: PRICE_MAP }
};

const HOSTS = ["api.fengying.xin"];

const pluginSource = {
  id: "fengying",
  host: "api.fengying.xin",
  preset,
  matches: ({ hostname, path }) => HOSTS.includes(hostname) && ["/","/pricing","/console","/console/topup"].includes(path),
  prepareMatches: ({ hostname }) => HOSTS.includes(hostname),
  prepare: (stationInput, { url }) => ({
    ...stationInput,
    baseUrl: `${url.origin}/`,
    mode: "direct",
    auth: { type: "none" },
    adapter: { ...(stationInput.adapter || {}), kind: "declarative", endpoint: PRICING_ENDPOINT, method: "GET", responseFormat: "price-map", priceMap: PRICE_MAP }
  }),
  mode: "direct",
  responseFormat: "price-map",
  authType: "none",
  rationale: "风影 的 /api/pricing 匿名可读，在售模型、分组倍率、表达式都不需要登录",
  request: requestPolicy(() => PRICING_ENDPOINT, { credentials: "omit" })
};

const MODEL_ALIASES = [
  {
    "alias": "gpt-5.6-sol-openai-compact",
    "canonicalId": "gpt-5-6-sol"
  }
];

export const sitePlugin = { ...pluginSource, modelAliases: MODEL_ALIASES };
