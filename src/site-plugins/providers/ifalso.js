// 由 scripts/plugin-build.mjs 从 plugins/ 生成，不要手改。重新生成：node scripts/plugin-build.mjs

import { DEFAULT_PRICING_ENDPOINT, requestPolicy } from "../../core/provider-registry.js";

// 轻盈科技 取证（2026-11-25，匿名直连 /api/pricing + /api/status，不需要登录）：
//   39 个模型、14 个分组，从 0.3（codex特惠速度快、特价claude）到 7（官转claudecodecli），是这一批分组跨度最大的站。
//   12 个模型带 billing_expr，9 个按次/按张，其余走 model_ratio。倍率基准与基座一致（1 单位 = 2 美元/百万）。
//   从 Claude Code 官方转发的「官转claudecodecli」组卖到 7 倍，同一模型在「所有模型」组是 1 倍，7 倍价差都如实出现在表里。
//   claude-sonnet-5 是个站点数据问题：只有占位倍率 37.5、没有 billing_expr，算出来 $75/M，乘「优选claude-限cc」1.5 后 $112.5/M。
//     这是站点自己填的占位值，不是真实报价，但报文里没有第二个数可以校准，所以照报文出价，不臆造。
//   4 个算不出价：MinMax-H3-C / SD2.0 / SD2.5 的秒计费用 resolution 三元表达式，seedance2.5-pcs 是 u("video_count") * 0，
//     站点自己标 0 价，都进 unresolved。
//   9 个按次/按张的模型（ttsd2.x 系列按秒、gpt-image 系列按张），单位价按各自的 unit 出。

const PRICE_MAP = { base: "allrouter" };

const HOSTS = ["api.ifalso.com"];
const PATHS = ["/","/pricing","/console/topup"];

const preset = {
  id: "ifalso",
  name: "轻盈科技",
  baseUrl: "https://api.ifalso.com/pricing",
  rechargeRmb: 1,
  rechargeCredits: 1,
  rechargeRateVerified: true,
  rechargeRateNote: "price = 1 即「1 元 = 1 美元额度」；报文里没有档位字段，收银台要登录，档位留空。",
  rechargePlansVerified: false,
  priceCurrency: "USD",
  priceCurrencyVerified: true,
  priceCurrencyNote: "报文里的倍率与 billing_expr 系数都是美元额度价，报价 = 官方价 × 分组倍率；price = 1、quota_per_unit = 500000、quota_display_type = USD、usd_exchange_rate = 1、stripe_unit_price = 8。控制台按站点设置的币种显示额度，不影响这里的价格。",
  enabled: true,
  mode: "direct",
  auth: { type: "none" },
  adapter: { kind: "declarative", endpoint: DEFAULT_PRICING_ENDPOINT, method: "GET", responseFormat: "price-map", priceMap: PRICE_MAP }
};

const pluginSource = {
  id: "ifalso",
  host: "api.ifalso.com",
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
  rationale: "轻盈科技的 /api/pricing 匿名可读，39 个模型 14 个分组，充值口径取自 /api/status",
  request: requestPolicy(() => DEFAULT_PRICING_ENDPOINT, { credentials: "omit" })
};

const MODEL_ALIASES = [];

export const sitePlugin = { ...pluginSource, modelAliases: MODEL_ALIASES };
