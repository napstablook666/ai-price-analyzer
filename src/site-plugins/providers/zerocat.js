// 由 scripts/plugin-build.mjs 从 plugins/ 生成，不要手改。重新生成：node scripts/plugin-build.mjs

import { DEFAULT_PRICING_ENDPOINT, requestPolicy } from "../../core/provider-registry.js";

// ZeroCat 取证（2026-11-23，匿名直连 /api/pricing，不需要登录）：
//   本批唯一没有按次模型的站：67 个模型全部按 token 计。billing_expr 47 个。
//   表达式里有按 UTC 时段的加价（hour("UTC") >= 1 && < 4 ? 2 : 1），
//   求值器只认四则运算，时间条件与 tier() 都会被 parseBillingTiers 先切走，
//   所以采到的是基础档价，夜间的 2 倍加价不入价。
//   分组 11 个，命名是「【Claude】Ultra纯血分组」这类渠道+纯度组合。
// 报文形状归到 tokenflux 基座，站点差异只有基座选择与充值口径。
const PRICE_MAP = { base: "tokenflux" };

const HOSTS = ["zero.cat","www.zero.cat"];
const PATHS = ["/","/pricing","/console/topup"];

const preset = {
  id: "zerocat",
  name: "ZeroCat",
  baseUrl: "https://zero.cat/pricing",
  rechargeAuto: false,
  rechargeRmb: 1,
  rechargeCredits: 1,
  rechargeRateVerified: true,
  rechargeRateNote: "站点 /api/status：quota_display_type = CNY、price = 1、usd_exchange_rate = 1，判定 ¥1 = 1 美元额度。公告指向 pass.zerocat.cc 的 USDT 充值入口与企业大额兑换码，收银台档位与赠送比例要登录，档位表留空。",
  priceCurrency: "CREDITS",
  priceCurrencyVerified: true,
  priceCurrencyNote: "额度计价，1 元 = 1 美元额度；报价 = 官方价 × 分组倍率（0.04–1.5）。",
  enabled: true,
  mode: "direct",
  auth: { type: "none" },
  adapter: { kind: "declarative", endpoint: DEFAULT_PRICING_ENDPOINT, method: "GET", responseFormat: "price-map", priceMap: PRICE_MAP }
};

const pluginSource = {
  id: "zerocat",
  host: "zero.cat",
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
  rationale: "ZeroCat 的 /api/pricing 匿名可读，67 个模型 11 个分组，充值口径按站点自报字段核过",
  request: requestPolicy(() => DEFAULT_PRICING_ENDPOINT, { credentials: "omit" })
};

const MODEL_ALIASES = [];

export const sitePlugin = { ...pluginSource, modelAliases: MODEL_ALIASES };
