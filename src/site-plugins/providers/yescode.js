// 由 scripts/plugin-build.mjs 从 plugins/ 生成，不要手改。重新生成：node scripts/plugin-build.mjs

import { requestPolicy } from "../../core/provider-registry.js";

// YesCode 取证（2026-11-23，匿名直连）：模型目录在 /api/v1/public/models，67KB、61 个模型，
//   字段 input_token_price / output_token_price 直接就是美元每百万 token，不用再换算；
//   rate_multiplier 三档（1 / 1.4 / 0.8）已经按模型乘好，写进表达式即可。
//   request_price 非零的 3 个是 gpt-image 三档尺寸，按次 0.1 美元一张。
//   /api/v1/model-plaza 在这站是 404，不是 sub2api 标准广场，所以走自定义 price-map，不套基座。
const MODELS_ENDPOINT = "/api/v1/public/models";

const PRICE_MAP = {
  schemaVersion: "price-map/1",
  source: "yescode",
  rootPath: "/models",
  nameField: "model_name",
  labelField: "display_name",
  currency: "USD",
  // 站点不给 enable_groups，模型目录也不说是哪个分组在卖，按倍率 1 出一条基准价，不编分组。
  groups: { unlisted: { group: "标准", ratio: 1 } },
  rules: [
    {
      when: { path: "request_price", gt: 0 },
      kind: "request",
      price: "request_price",
      unit: "request",
      mediaType: "image",
      tierName: "按次"
    },
    {
      when: { path: "input_token_price", gt: 0 },
      kind: "token",
      input: "input_token_price * rate_multiplier",
      output: "output_token_price * rate_multiplier",
      cacheRead: "cache_read_token_price * rate_multiplier",
      cacheWrite: "cache_creation_token_price * rate_multiplier",
      tierName: "标准"
    }
  ]
};

const RECHARGE_NOTE = "站点 admin-settings：payg_topup 按量充值最低 1 元、rate 记 0，另有 ¥100–¥1000 订阅档。按量充值是否 1:1 未做第三方收银台实测，倍率留给用户按实际到手额度修正。";

const preset = {
  id: "yescode",
  name: "YesCode",
  baseUrl: "https://co.yes.vg/model-plaza",
  rechargeAuto: false,
  rechargeRmb: 1,
  rechargeCredits: 1,
  rechargeRateVerified: false,
  rechargeRateNote: RECHARGE_NOTE,
  priceCurrency: "USD",
  priceCurrencyVerified: true,
  priceCurrencyNote: "模型目录直接按美元每百万 token 标价，rate_multiplier 已并入。",
  enabled: true,
  mode: "direct",
  auth: { type: "none" },
  adapter: { kind: "declarative", endpoint: MODELS_ENDPOINT, method: "GET", responseFormat: "price-map", priceMap: PRICE_MAP }
};

const pluginSource = {
  id: "yescode",
  host: "co.yes.vg",
  preset,
  matches: ({ hostname, path }) => hostname === "co.yes.vg" && ["/model-plaza", "/subscription"].includes(path),
  prepareMatches: ({ hostname }) => hostname === "co.yes.vg",
  prepare: (stationInput, { url }) => ({
    ...stationInput,
    baseUrl: `${url.origin}/model-plaza`,
    mode: "direct",
    auth: { type: "none" },
    adapter: { ...(stationInput.adapter || {}), kind: "declarative", endpoint: MODELS_ENDPOINT, method: "GET", responseFormat: "price-map", priceMap: PRICE_MAP }
  }),
  mode: "direct",
  responseFormat: "price-map",
  authType: "none",
  rationale: "YesCode 的公开模型目录匿名可读，61 个模型自带倍率；充值比例未实测故不锁倍率",
  request: requestPolicy(() => MODELS_ENDPOINT, { credentials: "omit" })
};

const MODEL_ALIASES = [];

export const sitePlugin = { ...pluginSource, modelAliases: MODEL_ALIASES };
