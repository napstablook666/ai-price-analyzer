// 由 scripts/plugin-build.mjs 从 plugins/ 生成，不要手改。重新生成：node scripts/plugin-build.mjs

import { DEFAULT_PRICING_ENDPOINT as PRICING_ENDPOINT, requestPolicy } from "../../core/provider-registry.js";

// 站点画像（2026-11-24 实测）：
//   /api/pricing 匿名 200，tokenflux 形状：31 个模型、9 个分组，倍率都小于 1：
//   domestic_main1 0.075、domestic_welfare 0.04、domestic_official 0.5、foreign 0.5、foreign_image 1，还有一个 free = 0。
//   全站一个 billing_expr 都没有，但有 4 个模型是 quota_type = 1（按次），4 个 model_price > 0。
//   所以报文归 relayrouter 基座：先看 quota_type=1 的按次价，再走 model_ratio 换算，
//   这两样 allrouter 基座也能吃，但 relayrouter 基座的取价顺序更贴它的字段组合（无 expr 站的标准路径）。
//   supported_endpoint 只有 openai 与 image-generation。
//   充值：/api/status 里 price = 7.3、quota_per_unit = 500000、quota_display_type = CNY、system_name = 极光中转站 | Boreara，
//   即 7.3 元买 1 美元额度；没有真实付款，未核实。
// 站点差异只有这一句：报文形状归到 relayrouter 基座。
const PRICE_MAP = { base: "relayrouter" };

const preset = {
  id: "boreara",
  name: "极光 Boreara",
  baseUrl: "https://api.boreara.com/",
  rechargeRmb: 7.3,
  rechargeCredits: 1,
  rechargeRateVerified: false,
  rechargeRateNote: "站点 /api/status：price = 7.3、quota_per_unit = 500000、quota_display_type = CNY、usd_exchange_rate = 7.3。按 New API 口径 price 是「1 美元额度的人民币价」，即 7.3 元 = 1 美元额度；只读了配置，没有真实付款，所以 rechargeRateVerified 为 false，也不列赠送档位。",
  priceCurrency: "USD",
  priceCurrencyVerified: false,
  priceCurrencyNote: "报价由 /api/pricing 的 model_ratio × 分组倍率折算成美元每百万 token（倍率 1 = $2/M），带 billing_expr 的模型以表达式为准；站内按 CNY 显示额度，不影响这里的价格。",
  enabled: true,
  mode: "direct",
  auth: { type: "none" },
  adapter: { kind: "declarative", endpoint: PRICING_ENDPOINT, method: "GET", responseFormat: "price-map", priceMap: PRICE_MAP }
};

const HOSTS = ["api.boreara.com"];

const pluginSource = {
  id: "boreara",
  host: "api.boreara.com",
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
  rationale: "极光 Boreara 的 /api/pricing 匿名可读，在售模型、分组倍率、表达式都不需要登录",
  request: requestPolicy(() => PRICING_ENDPOINT, { credentials: "omit" })
};

const MODEL_ALIASES = [];

export const sitePlugin = { ...pluginSource, modelAliases: MODEL_ALIASES };
