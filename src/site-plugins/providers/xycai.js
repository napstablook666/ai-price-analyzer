// 由 scripts/plugin-build.mjs 从 plugins/ 生成，不要手改。重新生成：node scripts/plugin-build.mjs

import { DEFAULT_PRICING_ENDPOINT as PRICING_ENDPOINT, requestPolicy } from "../../core/provider-registry.js";

// 站点画像（2026-11-24 实测）：
//   /api/pricing 匿名 200，tokenflux 形状：data 336 个模型，group_ratio 34 个键、usable_group 35 个、
//   supported_endpoint 覆盖 openai / openai-response / gemini / anthropic / image-generation / openai-video。
//   382 条「模型 × 分组」里 305 条有文本 token 价、57 条按次、20 条按张；14 个模型把价写在 billing_expr 里，
//   形态是长度分段（len <= 272000 走 standard，否则 long_context 翻倍），例如 claude 的 p*5 + c*30 + cr*0.5。
//   两个域名 xycai.cn 与 xyc.ai 的报文字节数、哈希都一样（129997 / 628acd7f6b），是同一套后端，只写一个插件两份 matches。
//   充值：/api/status 里 price = 6.9、quota_per_unit = 500000、quota_display_type = USD、
//   usd_exchange_rate = 6.9，也就是 6.9 元买 1 美元额度（贴着汇率，没有折扣）。没有真实付款，不列档位。
// 站点差异只有这一句：报文形状归到 allrouter 基座（tokenflux 映射 + 图片端点规则 + billing_expr 求解）。
const PRICE_MAP = { base: "allrouter" };

const preset = {
  id: "xycai",
  name: "星云中转",
  baseUrl: "https://xycai.cn/",
  rechargeRmb: 6.9,
  rechargeCredits: 1,
  rechargeRateVerified: false,
  rechargeRateNote: "站点 /api/status：price = 6.9、quota_per_unit = 500000、quota_display_type = USD、usd_exchange_rate = 6.9。按 New API 口径 price 是「1 美元额度的人民币价」，即 6.9 元 = 1 美元额度；只读了配置，没有真实付款，所以 rechargeRateVerified 为 false，也不列赠送档位。",
  priceCurrency: "USD",
  priceCurrencyVerified: false,
  priceCurrencyNote: "报价由 /api/pricing 的 model_ratio × 分组倍率折算成美元每百万 token（倍率 1 = $2/M），带 billing_expr 的模型以表达式为准；站内按 USD 显示额度，不影响这里的价格。",
  enabled: true,
  mode: "direct",
  auth: { type: "none" },
  adapter: { kind: "declarative", endpoint: PRICING_ENDPOINT, method: "GET", responseFormat: "price-map", priceMap: PRICE_MAP }
};

const HOSTS = ["xycai.cn","www.xycai.cn","xyc.ai","www.xyc.ai"];

const pluginSource = {
  id: "xycai",
  host: "xycai.cn",
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
  rationale: "星云中转 的 /api/pricing 匿名可读，在售模型、分组倍率、表达式都不需要登录",
  request: requestPolicy(() => PRICING_ENDPOINT, { credentials: "omit" })
};

const MODEL_ALIASES = [];

export const sitePlugin = { ...pluginSource, modelAliases: MODEL_ALIASES };
