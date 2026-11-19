// 由 scripts/plugin-build.mjs 从 plugins/ 生成，不要手改。重新生成：node scripts/plugin-build.mjs

import { FUCK_EVERYONE_MODEL_PLAZA_ENDPOINT, requestPolicy } from "../../core/provider-registry.js";

const preset = {
  // >>> recharge-probe（由 scripts/recharge-apply.mjs 生成，勿手改）
  rechargePayments: [
    { channel: "wechat", faceAmount: 5, payAmount: 5, currency: "CNY", at: "2026-10-29", note: "订单 863 wxpay CANCELLED" },
    { channel: "wechat", faceAmount: 10, payAmount: 10, currency: "CNY", at: "2026-10-15", note: "订单 698 wxpay EXPIRED" },
  ],
  rechargePaymentsVerified: true,
  // <<< recharge-probe
  id: "fuck-everyone",
  name: "fuck-everyone.com",
  baseUrl: "https://fuck-everyone.com/model-plaza?embedded=1",
  rechargeRmb: 1,
  rechargeCurrency: "CNY",
  rechargeCredits: 1,
  rechargeRateVerified: false,
  rechargeRateNote: "站点未公开币种与充值折算，当前按 CNY 1:1 估算。",
  priceCurrency: "CREDITS",
  priceCurrencyVerified: true,
  priceCurrencyNote: "",
  enabled: true,
  mode: "direct",
  auth: { type: "none" },
  adapter: { kind: "fuck-everyone-model-plaza", endpoint: FUCK_EVERYONE_MODEL_PLAZA_ENDPOINT, method: "GET", responseFormat: "fuck-everyone-model-plaza" }
};

const pluginSource = {
  id: "fuck-everyone",
  preserveRechargeRateVerification: true,
  host: "fuck-everyone.com",
  matches: ({ hostname, path }) => hostname === "fuck-everyone.com" && path === "/model-plaza",
  prepare: (stationInput, { url }) => {
    const prepared = {
      ...stationInput,
      baseUrl: `${url.origin}/model-plaza?embedded=1`,
      mode: "direct",
      auth: { type: "none" },
      adapter: { ...(stationInput.adapter || {}), kind: "fuck-everyone-model-plaza", endpoint: FUCK_EVERYONE_MODEL_PLAZA_ENDPOINT, method: "GET", responseFormat: "fuck-everyone-model-plaza" }
    };
    if (prepared.rechargeRmb == null) prepared.rechargeRmb = preset.rechargeRmb;
    if (!prepared.rechargeCurrency) prepared.rechargeCurrency = preset.rechargeCurrency;
    if (prepared.rechargeCredits == null) prepared.rechargeCredits = preset.rechargeCredits;
    if (typeof prepared.rechargeRateVerified !== "boolean") prepared.rechargeRateVerified = preset.rechargeRateVerified;
    if (prepared.rechargeRateNote == null) prepared.rechargeRateNote = preset.rechargeRateNote;
    if (!prepared.priceCurrency || (prepared.priceCurrency === "UNKNOWN" && prepared.priceCurrencyVerified !== true)) prepared.priceCurrency = preset.priceCurrency;
    if (typeof prepared.priceCurrencyVerified !== "boolean") prepared.priceCurrencyVerified = preset.priceCurrencyVerified;
    if (prepared.priceCurrencyNote == null) prepared.priceCurrencyNote = preset.priceCurrencyNote;
    return prepared;
  },
  mode: "direct",
  responseFormat: "fuck-everyone-model-plaza",
  authType: "none",
  rationale: "fuck-everyone.com 通过公开模型广场 API 直连采集",
  preset,
  request: requestPolicy(() => FUCK_EVERYONE_MODEL_PLAZA_ENDPOINT, { credentials: "omit" })
};

const MODEL_ALIASES = [];

export const sitePlugin = { ...pluginSource, modelAliases: MODEL_ALIASES };
