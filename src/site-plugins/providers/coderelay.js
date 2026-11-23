// 由 scripts/plugin-build.mjs 从 plugins/ 生成，不要手改。重新生成：node scripts/plugin-build.mjs

import { DEFAULT_PRICING_ENDPOINT, requestPolicy } from "../../core/provider-registry.js";

// CodeRelay 取证（2026-11-23，匿名直连 /api/pricing，不需要登录）：
//   billing_expr 21 个、按次 3 个，model_ratio 基准同为 1 单位 = 2 美元/百万。
//   分组 16 个按「ClaudeCode-Max / Codex | Sale号池 / Cursor逆向 / Kiro逆向」拆渠道。
// 报文形状归到 tokenflux 基座，站点差异只有基座选择与充值口径。
const PRICE_MAP = { base: "tokenflux" };

const HOSTS = ["coderelay.cn","www.coderelay.cn"];
const PATHS = ["/","/pricing","/console/topup"];

const preset = {
  id: "coderelay",
  name: "CodeRelay",
  baseUrl: "https://coderelay.cn/pricing",
  rechargeAuto: false,
  rechargeRmb: 1,
  rechargeCredits: 1,
  rechargeRateVerified: true,
  rechargeRateNote: "站点 /api/status：quota_display_type = USD、price = 1、usd_exchange_rate = 1、custom_currency_exchange_rate = 1，判定 ¥1 = 1 美元额度。公告写「支持无理由退款 · 按量充值」并带 AFF 邀请返利，收银台档位与赠送比例要登录，档位表留空。",
  priceCurrency: "CREDITS",
  priceCurrencyVerified: true,
  priceCurrencyNote: "额度计价，1 元 = 1 美元额度；报价 = 官方价 × 分组倍率（0.06–1.5）。",
  enabled: true,
  mode: "direct",
  auth: { type: "none" },
  adapter: { kind: "declarative", endpoint: DEFAULT_PRICING_ENDPOINT, method: "GET", responseFormat: "price-map", priceMap: PRICE_MAP }
};

const pluginSource = {
  id: "coderelay",
  host: "coderelay.cn",
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
  rationale: "CodeRelay 的 /api/pricing 匿名可读，54 个模型 16 个分组，充值口径按站点自报字段核过",
  request: requestPolicy(() => DEFAULT_PRICING_ENDPOINT, { credentials: "omit" })
};

const MODEL_ALIASES = [];

export const sitePlugin = { ...pluginSource, modelAliases: MODEL_ALIASES };
