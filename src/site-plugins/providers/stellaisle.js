// 由 scripts/plugin-build.mjs 从 plugins/ 生成，不要手改。重新生成：node scripts/plugin-build.mjs

import { requestPolicy, STELLAISLE_PRICING_ENDPOINT } from "../../core/provider-registry.js";

const preset = {
  id: "stellaisle",
  name: "飓星API",
  category: "paid",
  baseUrl: "https://token.stellaisle.com/pricing",
  rechargeRmb: 1,
  rechargeCredits: 1,
  rechargeRateVerified: true,
  rechargeRateNote: "站点 FAQ：充值按 1:1 折算美元额度，1 元 = 1 美元额度。单笔 500 美元以上 8.8 折要找管理员，Codex 套餐有效倍率最低 0.13，两者都不能自助购买。",
  rechargePlansVerified: true,
  rechargePlans: [
    { kind: "topup", amount: 500, credits: 500, currency: "USD", discount: 0.88, availability: "manual", verified: true, note: "单笔 500 美元以上需管理员处理，不能自助购买" }
  ],
  priceCurrency: "CREDITS",
  priceCurrencyVerified: true,
  priceCurrencyNote: "额度计价，1 元充值换 1 美元额度",
  enabled: true,
  mode: "direct",
  auth: { type: "none" },
  adapter: { kind: "stellaisle", endpoint: STELLAISLE_PRICING_ENDPOINT, method: "GET", responseFormat: "stellaisle" }
};

const pluginSource = {
  id: "stellaisle",
  host: "token.stellaisle.com",
  preserveRechargeRateVerification: true,
  matches: ({ hostname, path }) => hostname === "token.stellaisle.com" && ["/", "/pricing"].includes(path),
  prepareMatches: ({ hostname }) => hostname === "token.stellaisle.com",
  prepare: (stationInput, { url }) => ({
    ...stationInput,
    baseUrl: `${url.origin}/pricing`,
    category: "paid",
    rechargeRateVerified: true,
    mode: "direct",
    auth: { type: "none" },
    adapter: { ...(stationInput.adapter || {}), kind: "stellaisle", endpoint: STELLAISLE_PRICING_ENDPOINT, method: "GET", responseFormat: "stellaisle" }
  }),
  mode: "direct",
  responseFormat: "stellaisle",
  authType: "none",
  rationale: "飓星API 的 /api/pricing 匿名可读，价格不需要登录",
  preset,
  request: requestPolicy(() => STELLAISLE_PRICING_ENDPOINT, { credentials: "omit" })
};

const MODEL_ALIASES = [
  {
    "alias": "gpt-5-openai-compact",
    "canonicalId": "gpt-5-2025-08-07"
  },
  {
    "alias": "gpt-5.1-openai-compact",
    "canonicalId": "gpt-5-1"
  },
  {
    "alias": "gpt-5.1-codex-openai-compact",
    "canonicalId": "gpt-5-1-codex"
  },
  {
    "alias": "gpt-5.1-codex-mini-openai-compact",
    "canonicalId": "gpt-5-1-codex-mini"
  },
  {
    "alias": "gpt-5.1-codex-max-openai-compact",
    "canonicalId": "gpt-5-1-codex-max"
  },
  {
    "alias": "gpt-5.2-openai-compact",
    "canonicalId": "gpt-5-2"
  },
  {
    "alias": "gpt-5.2-codex-openai-compact",
    "canonicalId": "gpt-5-2-codex"
  },
  {
    "alias": "gpt-5.3-codex-openai-compact",
    "canonicalId": "gpt-5-3-codex"
  },
  {
    "alias": "gpt-5.4-openai-compact",
    "canonicalId": "gpt-5-4"
  },
  {
    "alias": "gemini-4-argon-high",
    "canonicalId": "gemini-4-argon"
  },
  {
    "alias": "gemini-3.8-flash-high",
    "canonicalId": "gemini-3-8-flash"
  }
];

export const sitePlugin = { ...pluginSource, modelAliases: MODEL_ALIASES };
