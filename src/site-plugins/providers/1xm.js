// 由 scripts/plugin-build.mjs 从 plugins/ 生成，不要手改。重新生成：node scripts/plugin-build.mjs

import { DEFAULT_PRICING_ENDPOINT as PRICING_ENDPOINT, requestPolicy } from "../../core/provider-registry.js";

// 站点画像（2026-11-24 实测）：
//   /api/pricing 匿名 200，tokenflux 形状：54 个模型、16 个 group_ratio 键、11 个分组（0.2 到 7.5）。
//   197 条「模型 × 分组」里 189 条文本 token 价、6 条按次、2 条按张。
//   9 个模型带 billing_expr，都是长度分段：len <= 272000 走标准档，超了按 2 倍（claude 系列 5 倍）收。
//   1xm.ai、www.1xm.ai、api.1xm.ai 三个主机返回同一份 54 模型报文。
//   充值：/api/status 里 price = 1、quota_per_unit = 500000、quota_display_type = USD、usd_exchange_rate = 7.3，
//   按 price 口径是 1 元买 1 美元额度；没有真实付款，未核实。
// 站点差异只有这一句：报文形状归到 allrouter 基座（tokenflux 映射 + 图片端点规则 + billing_expr 求解）。
const PRICE_MAP = { base: "allrouter" };

const preset = {
  id: "1xm",
  name: "OneXModel",
  baseUrl: "https://1xm.ai/",
  rechargeRmb: 1,
  rechargeCredits: 1,
  rechargeRateVerified: false,
  rechargeRateNote: "站点 /api/status：price = 1、quota_per_unit = 500000、quota_display_type = USD、usd_exchange_rate = 7.3。按 New API 口径 price 是「1 美元额度的人民币价」，即 1 元 = 1 美元额度；只读了配置，没有真实付款，所以 rechargeRateVerified 为 false，也不列赠送档位。",
  priceCurrency: "USD",
  priceCurrencyVerified: false,
  priceCurrencyNote: "报价由 /api/pricing 的 model_ratio × 分组倍率折算成美元每百万 token（倍率 1 = $2/M），带 billing_expr 的模型以表达式为准；站内按 USD 显示额度，不影响这里的价格。",
  enabled: true,
  mode: "direct",
  auth: { type: "none" },
  adapter: { kind: "declarative", endpoint: PRICING_ENDPOINT, method: "GET", responseFormat: "price-map", priceMap: PRICE_MAP }
};

const HOSTS = ["1xm.ai","www.1xm.ai","api.1xm.ai"];

const pluginSource = {
  id: "1xm",
  host: "1xm.ai",
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
  rationale: "OneXModel 的 /api/pricing 匿名可读，在售模型、分组倍率、表达式都不需要登录",
  request: requestPolicy(() => PRICING_ENDPOINT, { credentials: "omit" })
};

const MODEL_ALIASES = [
  {
    "alias": "gpt-5.5-openai-compact",
    "canonicalId": "gpt-5-5"
  }
];

export const sitePlugin = { ...pluginSource, modelAliases: MODEL_ALIASES };
