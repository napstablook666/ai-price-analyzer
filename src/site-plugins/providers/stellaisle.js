// 由 scripts/plugin-build.mjs 从 plugins/ 生成，不要手改。重新生成：node scripts/plugin-build.mjs

import {
  requestPolicy,
  STELLAISLE_PLAZA_ENDPOINT,
  STELLAISLE_PLAZA_GROUP_ENDPOINT,
  STELLAISLE_PRICING_ENDPOINT
} from "../../core/provider-registry.js";

const preset = {
  // >>> recharge-probe（由 scripts/recharge-apply.mjs 生成，勿手改）
  rechargePayments: [
    { channel: "alipay", faceAmount: 10, payAmount: 10, currency: "CNY", at: "2026-11-19", note: "订单 585/588 收银台 expected 1000 minor = ¥10.00，payment_fee 0" },
    { channel: "alipay", faceAmount: 1000, payAmount: 1000, currency: "CNY", at: "2026-11-19", note: "订单 589 收银台 expected 100000 minor = ¥1000.00，payment_fee 0，到账 1025 额度含 25 元赠送" },
    { channel: "wechat", faceAmount: 10, payAmount: 10.1, currency: "CNY", feeRate: 0.01, at: "2026-11-19", note: "订单 586 收银台 expected 1010 minor = ¥10.10，payment_fee 0.1，微信收 1%" },
    { channel: "wechat", faceAmount: 1000, payAmount: 1010, currency: "CNY", feeRate: 0.01, at: "2026-11-19", note: "订单 587 收银台 expected 101000 minor = ¥1010.00，payment_fee 10，微信收 1%" },
  ],
  rechargePaymentsVerified: true,
  // <<< recharge-probe
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
  matches: ({ hostname, path }) => hostname === "token.stellaisle.com" && ["/", "/pricing", "/group-plaza"].includes(path),
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
  rationale: "飓星API 的 /api/pricing 与分组广场都匿名可读，价格和分组倍率都不需要登录",
  preset,
  // 分组广场才是真正能买的分组：列表给 ratio / 状态 / 供应商，逐组详情给该组
  // 每个模型的真实价。列表本身不带价，所以它是辅助请求，主请求仍是 /api/pricing。
  // 只拉 status=ok 的组：不可用的分组价格不可信，拉回来也会被展开逻辑丢掉。
  request: requestPolicy(() => STELLAISLE_PRICING_ENDPOINT, {
    credentials: "omit",
    aux: [
      { key: "groups", endpoint: STELLAISLE_PLAZA_ENDPOINT },
      {
        key: "groupPrices",
        endpoint: STELLAISLE_PLAZA_GROUP_ENDPOINT,
        forEach: "groups.data.items",
        idField: "group_id",
        where: { status: "ok" }
      }
    ]
  })
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
