// 由 scripts/plugin-build.mjs 从 plugins/ 生成，不要手改。重新生成：node scripts/plugin-build.mjs

import { DEFAULT_PRICING_ENDPOINT, requestPolicy } from "../../core/provider-registry.js";

// 快跑AI 取证（2026-11-23，匿名直连 /api/pricing，不需要登录）：
//   kuaipao.ai 与 kuaipao.pro 是同一后端：两域名的 /api/pricing 响应字节数完全一致（55190），
//   /api/status 的 server_address 自报 https://kuaipao.ai，所以两个域名都挂在同一个插件下。
//   报文是 new-api 新版形状：data[] + group_ratio + usable_group + vendors，模型条目带
//   billing_expr 的有 51 个（tier("标准", p*x + c*y ...) 这类，系数即美元/百万 token），
//   另有 6 个 quota_type = 1 的按次/按秒模型（如 qwen-audio-3.0-asr-flash 的 tier("按秒", p*0.0022)）。
//   model_ratio 的基准与 tokenflux 基座一致（1 单位 = 2 美元/百万），不需要 ratioBase 覆盖：
//   claude-opus-5-5 = 2（$4/M）、claude-sonnet-5 = 1（$2/M）、claude-fable-5-2 = 4（$8/M），
//   与 kelaode 那份按官方价核过的表对得上。
//   带 billing_expr 的条目 model_ratio 一律填 37.5 当占位，真实价只从表达式取，这是这一族的常态。
// 报文形状归到 tokenflux 基座，站点差异只有基座选择与充值口径。
const PRICE_MAP = { base: "tokenflux" };

const HOSTS = ["kuaipao.ai","kuaipao.pro","www.kuaipao.ai","www.kuaipao.pro"];
const PATHS = ["/","/pricing","/console/topup"];

const preset = {
  id: "kuaipao",
  name: "快跑AI",
  baseUrl: "https://kuaipao.ai/pricing",
  rechargeAuto: false,
  rechargeRmb: 0.4,
  rechargeCredits: 1,
  rechargeRateVerified: true,
  rechargeRateNote: "站点公告 /api/notice 原文写「汇率参考：¥0.4 ≈ $1」，与 /api/status 的 price = 0.4、custom_currency_exchange_rate = 0.4 以及分组说明里的「× 0.4 充值」三处一致，判定 0.4 元 = 1 美元额度。充值入口在 /console/topup，档位未逐档核（要登录），所以只记汇率不记赠送。",
  priceCurrency: "CREDITS",
  priceCurrencyVerified: true,
  priceCurrencyNote: "额度计价，报文里的倍率价是美元额度；报价 = 官方价 × 分组倍率（0.2–15.3）。",
  enabled: true,
  mode: "direct",
  auth: { type: "none" },
  adapter: { kind: "declarative", endpoint: DEFAULT_PRICING_ENDPOINT, method: "GET", responseFormat: "price-map", priceMap: PRICE_MAP }
};

const pluginSource = {
  id: "kuaipao",
  host: "kuaipao.ai",
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
  rationale: "快跑AI 的 /api/pricing 匿名可读，123 个模型 19 个分组，充值口径按站点自报字段核过",
  request: requestPolicy(() => DEFAULT_PRICING_ENDPOINT, { credentials: "omit" })
};

const MODEL_ALIASES = [];

export const sitePlugin = { ...pluginSource, modelAliases: MODEL_ALIASES };
