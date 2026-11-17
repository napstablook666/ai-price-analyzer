// 由 scripts/plugin-build.mjs 从 plugins/ 生成，不要手改。重新生成：node scripts/plugin-build.mjs

import { MAOLAO_PRICING_ENDPOINT, requestPolicy } from "../../core/provider-registry.js";

// 充值口径（2026-11-17 实测，登录态接口 /api/user/topup/info + 页面实付）：
//   1 额度 = 1.03 元（页面「充值数量」输入框：10 额度 → 实付 10.3 元，50 → 51.5）
//   amount_options = 10/20/50/100/200/500/1000，discount = 200:0.98 / 500:0.95 / 1000:0.9
//   折扣乘在 1.03 上：200 → 201.88，500 → 489.25，1000 → 927
// 订阅是固定包价（98/188/358 元买 120/240/480 额度），不是可叠乘的折扣，
// 所以不进 rechargeTiers，只写在 rechargeRateNote 里备查。
const preset = {
  id: "maolaoapi",
  name: "maolaoapi.com",
  baseUrl: "https://maolaoapi.com/pricing",
  rechargeRmb: 1.03,
  rechargeCredits: 1,
  rechargeRateVerified: true,
  rechargeRateNote: "2026-11-17 实测：10 额度实付 10.3 元；200/500/1000 档 9.8/9.5/9.0 折已并入档位表。订阅包价更低（98 元 120 额度 = 0.817 元/额度，188 元 240 = 0.783，358 元 480 = 0.746），按周刷新、不累计。",
  rechargeTiers: [
    { amount: 10, discount: 1 },
    { amount: 20, discount: 1 },
    { amount: 50, discount: 1 },
    { amount: 100, discount: 1 },
    { amount: 200, discount: 0.98 },
    { amount: 500, discount: 0.95 },
    { amount: 1000, discount: 0.9 }
  ],
  priceCurrency: "CREDITS",
  priceCurrencyVerified: true,
  priceCurrencyNote: "",
  enabled: true,
  mode: "direct",
  auth: { type: "none" },
  adapter: { kind: "tokenflux", endpoint: MAOLAO_PRICING_ENDPOINT, method: "GET", responseFormat: "tokenflux" }
};

const pluginSource = {
  id: "maolaoapi",
  host: "maolaoapi.com",
  preset,
  matches: ({ hostname, path }) => hostname === "maolaoapi.com" && ["/", "/pricing", "/console/topup"].includes(path),
  prepareMatches: ({ hostname }) => hostname === "maolaoapi.com",
  prepare: (stationInput, { url }) => ({
    ...stationInput,
    baseUrl: `${url.origin}/pricing`,
    mode: "direct",
    auth: { type: "none" },
    adapter: { ...(stationInput.adapter || {}), kind: "tokenflux", endpoint: MAOLAO_PRICING_ENDPOINT, method: "GET", responseFormat: "tokenflux" }
  }),
  mode: "direct",
  responseFormat: "tokenflux",
  authType: "none",
  rationale: "maolaoapi.com 通过公开定价 API 直连采集，充值档位已核验",
  request: requestPolicy(() => MAOLAO_PRICING_ENDPOINT, { credentials: "omit" })
};

const MODEL_ALIASES = [];

export const sitePlugin = { ...pluginSource, modelAliases: MODEL_ALIASES };
