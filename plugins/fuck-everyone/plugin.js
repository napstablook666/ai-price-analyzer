import { FUCK_EVERYONE_MODEL_PLAZA_ENDPOINT, requestPolicy } from "@app/core/provider-registry.js";

const preset = {
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

export const sitePlugin = {
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
