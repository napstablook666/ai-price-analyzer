// 由 scripts/plugin-build.mjs 从 plugins/ 生成，不要手改。重新生成：node scripts/plugin-build.mjs

import { DEFAULT_PRICING_ENDPOINT, requestPolicy } from "../../core/provider-registry.js";

// PQH 中转站 取证（2026-11-23，匿名直连 /api/pricing，不需要登录）：
//   0ait.com 与本站在 /api/status 上的 price、quota_per_unit、汇率字段完全相同（都是 7.3），
//   但模型目录规模不同（108 vs 72），是同一家的两套独立部署，各自单独采集。
//   报文形状与 kuaipao 同族：billing_expr 64 个，quota_type = 1 的按次模型 4 个，
//   另有 billing_usage_schema 字段（按次模型的用量规格），基座已消费。
//   model_ratio 基准同为 1 单位 = 2 美元/百万：claude-opus-5-5 = 2、claude-sonnet-5 = 1。
//   分组 53 个，是本批最细的一家（AWSB企业专供 / AZ-Claude / CCMAX-0注入coding-1 这类按渠道与注入能力拆）。
// 报文形状归到 tokenflux 基座，站点差异只有基座选择与充值口径。
const PRICE_MAP = { base: "tokenflux" };

const HOSTS = ["pqh.ai","www.pqh.ai"];
const PATHS = ["/","/pricing","/console/topup"];

const preset = {
  id: "pqh",
  name: "PQH 中转站",
  baseUrl: "https://pqh.ai/pricing",
  rechargeAuto: false,
  rechargeRmb: 7.3,
  rechargeCredits: 1,
  rechargeRateVerified: true,
  rechargeRateNote: "站点 /api/status：price = 7.3、usd_exchange_rate = 7.3、quota_display_type = USD、quota_per_unit = 500000，两个汇率字段同值，判定 1 美元额度 = ¥7.3。公告只写「充值优先联系 QQ：2037390570 / VX：NEXVIA003」走人工充值，收银台档位与赠送比例要登录才看得到，所以 rechargeAuto 锁手填，档位表留空。",
  priceCurrency: "CREDITS",
  priceCurrencyVerified: true,
  priceCurrencyNote: "额度计价，1 美元额度 = ¥7.3；报价 = 官方价 × 分组倍率（0.12–2.6）。",
  enabled: true,
  mode: "direct",
  auth: { type: "none" },
  adapter: { kind: "declarative", endpoint: DEFAULT_PRICING_ENDPOINT, method: "GET", responseFormat: "price-map", priceMap: PRICE_MAP }
};

const pluginSource = {
  id: "pqh",
  host: "pqh.ai",
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
  rationale: "PQH 中转站 的 /api/pricing 匿名可读，108 个模型 53 个分组，充值口径按站点自报字段核过",
  request: requestPolicy(() => DEFAULT_PRICING_ENDPOINT, { credentials: "omit" })
};

const MODEL_ALIASES = [];

export const sitePlugin = { ...pluginSource, modelAliases: MODEL_ALIASES };
