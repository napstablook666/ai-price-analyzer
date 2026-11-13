import { DEFAULT_EXCHANGE_RATE } from "../../shared/schema.js";
import { requestPolicy, SIDRUNE_MODEL_PLAZA_ENDPOINT } from "../../core/provider-registry.js";

const preset = {
  id: "sidrune",
  name: "sidrune.ai",
  baseUrl: "https://sidrune.ai/model-plaza",
  enabled: true,
  mode: "direct",
  rechargeRmb: DEFAULT_EXCHANGE_RATE,
  rechargeCurrency: "USD",
  rechargeCredits: 1,
  auth: { type: "none" },
  adapter: { kind: "sidrune-model-plaza", endpoint: SIDRUNE_MODEL_PLAZA_ENDPOINT, method: "GET", responseFormat: "auto" }
};

export const sitePlugin = {
  id: "sidrune",
  host: "sidrune.ai",
  matches: ({ hostname, path }) => hostname === "sidrune.ai" && path === "/model-plaza",
  prepare: (stationInput, { url }) => ({
    ...stationInput,
    baseUrl: `${url.origin}/model-plaza`,
    mode: "direct",
    auth: { type: "none" },
    adapter: { ...(stationInput.adapter || {}), kind: "sidrune-model-plaza", endpoint: SIDRUNE_MODEL_PLAZA_ENDPOINT, method: "GET", responseFormat: "auto" }
  }),
  mode: "direct",
  authType: "none",
  rationale: "Sidrune 通过公开模型广场 API 采集",
  preset: options => ({ ...preset, rechargeRmb: options.exchangeRate ?? DEFAULT_EXCHANGE_RATE }),
  request: requestPolicy(() => SIDRUNE_MODEL_PLAZA_ENDPOINT, { credentials: "omit" })
};
