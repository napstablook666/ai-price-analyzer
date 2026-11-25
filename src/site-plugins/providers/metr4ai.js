// 由 scripts/plugin-build.mjs 从 plugins/ 生成，不要手改。重新生成：node scripts/plugin-build.mjs

import { DEFAULT_PRICING_ENDPOINT, requestPolicy } from "../../core/provider-registry.js";

// Akari AI 中转站 取证（2026-11-25，匿名直连 /api/pricing + /api/status，不需要登录）：
//   26 个模型里 21 个走 billing_expr，5 个走纯 model_ratio；7 个分组全部是折扣组（0.08 的 GPT Plus 到 1.5 的 cc-max）。
//   倍率基准按纯倍率模型核对：1 单位 = 2 美元/百万，与基座一致。
//   58 条报价行全是 token 计价，这一批里唯一没有按次、按张的站。
//   claude-opus-5 在「【Cursor】限时特价 Claude」（0.6）算出来 $3/M、「【Claude】cc-max 满血满智」（1.5）算 $7.5/M，
//   两组同时在卖，价差就是站点给两个渠道的定价，照实采。
//   codex-auto-review 的表达式是 p * 0 + c * 0 + cr * 0 + cc * 0，站点自己标 0 价，进 unresolved 不参与比价。
//   站点自述只给了 help 页（metr4ai.com/help），FAQ 为空，充值档位要登录，没有档位表。

const PRICE_MAP = { base: "allrouter" };

const HOSTS = ["metr4ai.com"];
const PATHS = ["/","/pricing","/console/topup"];

const preset = {
  id: "metr4ai",
  name: "Akari AI 中转站",
  baseUrl: "https://metr4ai.com/pricing",
  rechargeRmb: 1,
  rechargeCredits: 1,
  rechargeRateVerified: true,
  rechargeRateNote: "price = 1 即「1 元 = 1 美元额度」。quota_display_type = CNY 只决定控制台把额度折成人民币显示，报文里的倍率与表达式系数仍是美元额度，不改成 CNY 计价。",
  rechargePlansVerified: false,
  priceCurrency: "USD",
  priceCurrencyVerified: true,
  priceCurrencyNote: "报文里的倍率与 billing_expr 系数都是美元额度价，报价 = 官方价 × 分组倍率；price = 1、quota_per_unit = 500000、quota_display_type = CNY、usd_exchange_rate = 1、stripe_unit_price = 8。控制台按站点设置的币种显示额度，不影响这里的价格。",
  enabled: true,
  mode: "direct",
  auth: { type: "none" },
  adapter: { kind: "declarative", endpoint: DEFAULT_PRICING_ENDPOINT, method: "GET", responseFormat: "price-map", priceMap: PRICE_MAP }
};

const pluginSource = {
  id: "metr4ai",
  host: "metr4ai.com",
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
  rationale: "Akari AI 的 /api/pricing 匿名可读，26 个模型 7 个折扣分组、充值口径都取自 /api/status",
  request: requestPolicy(() => DEFAULT_PRICING_ENDPOINT, { credentials: "omit" })
};

const MODEL_ALIASES = [];

export const sitePlugin = { ...pluginSource, modelAliases: MODEL_ALIASES };
