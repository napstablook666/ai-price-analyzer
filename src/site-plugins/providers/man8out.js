// 由 scripts/plugin-build.mjs 从 plugins/ 生成，不要手改。重新生成：node scripts/plugin-build.mjs

import { NEXA_CHANNEL_CATALOG_ENDPOINT, requestPolicy } from "../../core/provider-registry.js";

const preset = {
  id: "man8out",
  name: "Man8Out",
  baseUrl: "https://ai.man8out.com/modelsmarket",
  preserveRechargeRateVerification: true,
  // 收银台实测 2026-11-23：自定义 10 元 → 到账 ◈10.00，手续费 1%（¥0.10），确认支付 ¥10.10。
  // 站内 ◈ 与官方美元额度 1:1（官方价 × 分组倍率的数值直接记作 ◈），折算 1 美元额度 = ¥1.01。
  rechargeRmb: 1.01,
  rechargeCredits: 1,
  rechargeRateVerified: true,
  rechargeRateNote: "收银台实测 2026-11-23：充 10 元到账 ◈10.00，手续费 1% 收 ¥0.10，实付 ¥10.10。站内 ◈ 与官方美元额度 1:1，折算 1 美元额度 = ¥1.01。单笔 1–10000 元，支付宝与微信，无赠送档位。",
  rechargePayments: [
    {
      channel: "alipay",
      faceAmount: 10,
      payAmount: 10.1,
      currency: "CNY",
      paidRmb: 10.1,
      feeRate: 0.01,
      at: "2026-11-23",
      note: "自定义 10 元：到账 ◈10.00，手续费 1% = ¥0.10",
    },
  ],
  rechargePaymentsVerified: true,
  // 订阅套餐：每周刷新额度，用不完不累积，到期作废。credits 是单周额度。
  rechargePlans: [
    { kind: "subscription", amount: 25, credits: 22.5, currency: "CNY", availability: "self_service", period: "28 天", recurring: true, accumulates: false, verified: true, note: "Go：周限额 ◈22.5，每 7 天刷新，有效期 28 天，赠 1 NEX" },
    { kind: "subscription", amount: 38, credits: 30, currency: "CNY", availability: "self_service", period: "28 天", recurring: true, accumulates: false, verified: true, note: "Lite：周限额 ◈30，每 7 天刷新，有效期 28 天，赠 2 NEX" },
    { kind: "subscription", amount: 68, credits: 62, currency: "CNY", availability: "self_service", period: "28 天", recurring: true, accumulates: false, verified: true, note: "Standard：周限额 ◈62，每 7 天刷新，有效期 28 天，赠 2 NEX" },
    { kind: "subscription", amount: 128, credits: 123, currency: "CNY", availability: "self_service", period: "28 天", recurring: true, accumulates: false, verified: true, note: "Advance：周限额 ◈123，每 7 天刷新，有效期 28 天，赠 3 NEX" },
    { kind: "subscription", amount: 138, credits: 94, currency: "CNY", availability: "self_service", period: "28 天", recurring: true, accumulates: false, verified: true, note: "Plus：周限额 ◈94，每 7 天刷新，有效期 28 天，赠 5 NEX" },
    { kind: "subscription", amount: 328, credits: 325, currency: "CNY", availability: "self_service", period: "30 天", recurring: true, accumulates: false, verified: true, note: "Boost：周限额 ◈325，每 7 天刷新，有效期 30 天，赠 4 NEX" },
    { kind: "subscription", amount: 388, credits: 328, currency: "CNY", availability: "self_service", period: "28 天", recurring: true, accumulates: false, verified: true, note: "Pro：周限额 ◈328，每 7 天刷新，有效期 28 天，赠 15 NEX" },
    { kind: "subscription", amount: 768, credits: 783, currency: "CNY", availability: "self_service", period: "28 天", recurring: true, accumulates: false, verified: true, note: "Powerful：周限额 ◈783，每 7 天刷新，有效期 28 天，赠 5 NEX" },
    { kind: "subscription", amount: 1098, credits: 932, currency: "CNY", availability: "self_service", period: "28 天", recurring: true, accumulates: false, verified: true, note: "Max：周限额 ◈932，每 7 天刷新，有效期 28 天，赠 40 NEX" },
    { kind: "subscription", amount: 2198, credits: 2329.26, currency: "CNY", availability: "unknown", period: "28 天", recurring: true, accumulates: false, verified: true, note: "Ultra：周限额 ◈2329.26，每 7 天刷新，有效期 28 天，赠 90 NEX，当前售罄" },
  ],
  rechargePlansVerified: true,
  priceCurrency: "USD",
  priceCurrencyVerified: true,
  enabled: true,
  mode: "direct",
  auth: { type: "none" },
  adapter: { endpoint: NEXA_CHANNEL_CATALOG_ENDPOINT, method: "GET", responseFormat: "auto" }
};

const pluginSource = {
  preservePriceCurrency: true,
  preserveRechargeRateVerification: true,
  id: "man8out",
  host: "ai.man8out.com",
  matches: ({ hostname }) => hostname === "ai.man8out.com",
  prepare: (stationInput, { url }) => ({
    ...stationInput,
    baseUrl: `${url.origin}/modelsmarket`,
    rechargeRateVerified: stationInput.rechargeRateVerified === true,
    mode: "direct",
    auth: { type: "none" },
    adapter: { ...(stationInput.adapter || {}), endpoint: NEXA_CHANNEL_CATALOG_ENDPOINT, method: "GET", responseFormat: "auto" }
  }),
  mode: "direct",
  responseFormat: "auto",
  authType: "none",
  rationale: "Man8Out 的渠道目录接口匿名可读，直连采集",
  preset,
  request: requestPolicy(() => NEXA_CHANNEL_CATALOG_ENDPOINT, { credentials: "omit" })
};

const MODEL_ALIASES = [];

export const sitePlugin = { ...pluginSource, modelAliases: MODEL_ALIASES };
