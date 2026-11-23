// 由 scripts/plugin-build.mjs 从 plugins/ 生成，不要手改。重新生成：node scripts/plugin-build.mjs

import { DEFAULT_PRICING_ENDPOINT, requestPolicy } from "../../core/provider-registry.js";

// 0AIT 中转站 取证（2026-11-23，匿名直连 /api/pricing，不需要登录）：
//   与 pqh.ai 同一运营（/api/status 的 price、quota_per_unit、汇率字段逐项相同），但模型目录 72 个、
//   分组 37 个，是独立部署，所以单独一个插件而不是挂在 pqh 下。
//   billing_expr 53 个、按次 4 个，形状与 pqh 同族；model_ratio 基准同为 1 单位 = 2 美元/百万。
//   分组名以云厂商与专线为主（AWS-BEDROCK-1 / AWSBedrock 专线 F系列 / AZ-Claude / Azure_gpt）。
// 报文形状归到 tokenflux 基座，站点差异只有基座选择与充值口径。
const PRICE_MAP = { base: "tokenflux" };

const HOSTS = ["0ait.com","www.0ait.com"];
const PATHS = ["/","/pricing","/console/topup"];

const preset = {
  id: "0ait",
  name: "0AIT 中转站",
  baseUrl: "https://0ait.com/pricing",
  rechargeAuto: false,
  rechargeRmb: 7.3,
  rechargeCredits: 1,
  rechargeRateVerified: true,
  rechargeRateNote: "站点 /api/status 与 pqh.ai 完全同值：price = 7.3、usd_exchange_rate = 7.3、quota_display_type = USD、quota_per_unit = 500000，判定 1 美元额度 = ¥7.3。公告为空，收银台档位要登录，档位表留空。",
  priceCurrency: "CREDITS",
  priceCurrencyVerified: true,
  priceCurrencyNote: "额度计价，1 美元额度 = ¥7.3；报价 = 官方价 × 分组倍率（0.15 起，25 档）。",
  enabled: true,
  mode: "direct",
  auth: { type: "none" },
  adapter: { kind: "declarative", endpoint: DEFAULT_PRICING_ENDPOINT, method: "GET", responseFormat: "price-map", priceMap: PRICE_MAP }
};

const pluginSource = {
  id: "0ait",
  host: "0ait.com",
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
  rationale: "0AIT 中转站 的 /api/pricing 匿名可读，72 个模型 37 个分组，充值口径按站点自报字段核过",
  request: requestPolicy(() => DEFAULT_PRICING_ENDPOINT, { credentials: "omit" })
};

const MODEL_ALIASES = [];

export const sitePlugin = { ...pluginSource, modelAliases: MODEL_ALIASES };
