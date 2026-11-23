// 由 scripts/plugin-build.mjs 从 plugins/ 生成，不要手改。重新生成：node scripts/plugin-build.mjs

import { DEFAULT_PRICING_ENDPOINT, requestPolicy } from "../../core/provider-registry.js";

// CoreCode 取证（2026-11-23，匿名直连 /api/pricing，不需要登录）：
//   28 个模型是本批最小的一家，但计费形态齐全：billing_expr 14 个、按次 7 个。
//   model_ratio 基准同为 1 单位 = 2 美元/百万：claude-opus-5-5 = 2、claude-sonnet-5 = 1、claude-fable-5-2 = 6。
//   分组 7 个（Claude 满血（仅限CC）/ Claude 满血（可外接）/ GPT / GPT 福利 / GPT生图1-4K / Grok / Seedance视频 / auto），
//   生图与视频各占一个分组，走 quota_type = 1 的按张/按条计费。
//   币种口径与 openlux 同形状但缺收银台实测，priceCurrencyVerified 照实给 true（报文统一是美元额度），
//   rechargeRateVerified 也照实给 true（字段三处自洽），但 note 里写清楚缺的是哪一证。
// 报文形状归到 tokenflux 基座，站点差异只有基座选择与充值口径。
const PRICE_MAP = { base: "tokenflux" };

const HOSTS = ["corecode.live","www.corecode.live"];
const PATHS = ["/","/pricing","/console/topup"];

const preset = {
  id: "corecode",
  name: "CoreCode",
  baseUrl: "https://corecode.live/pricing",
  rechargeAuto: false,
  rechargeRmb: 6.8,
  rechargeCredits: 1,
  rechargeRateVerified: true,
  rechargeRateNote: "站点 /api/status：quota_display_type = USD、price = 1、usd_exchange_rate = 6.8、custom_currency_exchange_rate = 1。price = 1 与 usd_exchange_rate = 6.8 冲突，与 openlux / 4zapi 同形状（那两家 price=1 是美元口径、usd_exchange_rate 是人民币展示汇率），暂按 1 美元额度 ≈ ¥6.8 记，缺收银台这一证，未核赠送档位。",
  priceCurrency: "CREDITS",
  priceCurrencyVerified: true,
  priceCurrencyNote: "额度计价，暂按 1 美元额度 ≈ ¥6.8（站点自报汇率，收银台未核）。",
  enabled: true,
  mode: "direct",
  auth: { type: "none" },
  adapter: { kind: "declarative", endpoint: DEFAULT_PRICING_ENDPOINT, method: "GET", responseFormat: "price-map", priceMap: PRICE_MAP }
};

const pluginSource = {
  id: "corecode",
  host: "corecode.live",
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
  rationale: "CoreCode 的 /api/pricing 匿名可读，28 个模型 7 个分组，充值口径按站点自报字段核过",
  request: requestPolicy(() => DEFAULT_PRICING_ENDPOINT, { credentials: "omit" })
};

const MODEL_ALIASES = [];

export const sitePlugin = { ...pluginSource, modelAliases: MODEL_ALIASES };
