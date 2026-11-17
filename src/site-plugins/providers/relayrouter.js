// 由 scripts/plugin-build.mjs 从 plugins/ 生成，不要手改。重新生成：node scripts/plugin-build.mjs

import { RELAYROUTER_PRICING_ENDPOINT, requestPolicy } from "../../core/provider-registry.js";

// 充值口径（2026-11-17 调研）：
//   站点 /api/status 里 price = 1、original_price = 1，运营后台文案写着
//   「1 表示 1 人民币 = 1 额度」「当前价格：1 元人民币 = 1 美元额度」，
//   和 New API 上游的实付公式对得上：
//   实付 = 面值 × price × 分组倍率 × 档位折扣。
//   所以 1 美元额度 = 1 元。页面另外显示的 6.68752 是 usd_exchange_rate，
//   只用于把人民币金额换算成美元显示，不参与扣费。
//   注：口径来自站点自身配置，没有真实付款；实测不同就改 rechargeRmb。
const preset = {
  id: "relayrouter",
  name: "RelayRouter",
  baseUrl: "https://www.relayrouter.app/pricing",
  rechargeRmb: 1,
  rechargeCredits: 1,
  rechargeRateVerified: true,
  rechargeRateNote: "站点 price=1（1 元 = 1 美元额度）。面值越大越便宜：10 档 9.9 折，10 万档 0.925，档位折扣已并入档位表。",
  // bulk_topup_discounts 原样搬过来：面值（美元额度）→ 折扣。
  rechargeTiers: [
    { amount: 10, discount: 0.99 },
    { amount: 50, discount: 0.985 },
    { amount: 100, discount: 0.98 },
    { amount: 200, discount: 0.975 },
    { amount: 300, discount: 0.97 },
    { amount: 500, discount: 0.965 },
    { amount: 1000, discount: 0.96 },
    { amount: 2000, discount: 0.955 },
    { amount: 5000, discount: 0.95 },
    { amount: 10000, discount: 0.945 },
    { amount: 30000, discount: 0.94 },
    { amount: 50000, discount: 0.935 },
    { amount: 80000, discount: 0.93 },
    { amount: 100000, discount: 0.925 }
  ],
  priceCurrency: "USD",
  priceCurrencyVerified: true,
  priceCurrencyNote: "",
  enabled: true,
  mode: "direct",
  auth: { type: "none" },
  adapter: { kind: "relayrouter", endpoint: RELAYROUTER_PRICING_ENDPOINT, method: "GET", responseFormat: "relayrouter" }
};

const pluginSource = {
  id: "relayrouter",
  host: "relayrouter.app",
  preset,
  matches: ({ hostname, path }) => ["www.relayrouter.app", "relayrouter.app"].includes(hostname) &&
    ["/", "/pricing", "/console/topup"].includes(path),
  prepareMatches: ({ hostname }) => ["www.relayrouter.app", "relayrouter.app"].includes(hostname),
  prepare: (stationInput, { url }) => ({
    ...stationInput,
    baseUrl: `${url.origin}/pricing`,
    mode: "direct",
    auth: { type: "none" },
    adapter: { ...(stationInput.adapter || {}), kind: "relayrouter", endpoint: RELAYROUTER_PRICING_ENDPOINT, method: "GET", responseFormat: "relayrouter" }
  }),
  mode: "direct",
  responseFormat: "relayrouter",
  authType: "none",
  rationale: "RelayRouter 通过公开定价 API 直连采集，充值档位已核验",
  request: requestPolicy(() => RELAYROUTER_PRICING_ENDPOINT, { credentials: "omit" })
};

const MODEL_ALIASES = [];

export const sitePlugin = { ...pluginSource, modelAliases: MODEL_ALIASES };
