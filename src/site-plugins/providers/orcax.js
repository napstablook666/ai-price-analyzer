// 由 scripts/plugin-build.mjs 从 plugins/ 生成，不要手改。重新生成：node scripts/plugin-build.mjs

import { DEFAULT_PRICING_ENDPOINT, requestPolicy } from "../../core/provider-registry.js";

// OrcaX 取证（2026-11-25，匿名直连 /api/pricing + /api/status，不需要登录）：
//   14 个模型，只有 Gold 一个分组（倍率 0.6），2 个带 billing_expr，其余 12 个走 model_ratio。
//   倍率基准与基座一致（1 单位 = 2 美元/百万）：gpt-6-sol 的 ratio 1 算 $1.2/M、乘 Gold 0.6 后出价。
//   2 条按张的生图报价，其余 12 条按 token。0 条算不出价。
//   站点的自述页是 /about，没有可读的充值档位。

const PRICE_MAP = { base: "allrouter" };

const HOSTS = ["orcax.net","www.orcax.net"];
const PATHS = ["/","/pricing","/console/topup"];

const preset = {
  id: "orcax",
  name: "OrcaX",
  baseUrl: "https://orcax.net/pricing",
  rechargeRmb: 1,
  rechargeCredits: 1,
  rechargeRateVerified: true,
  rechargeRateNote: "price = 1 即「1 元 = 1 美元额度」。额度在界面上显示成 🔱，custom_currency_exchange_rate = 1 表示 1 个 🔱 = 1 美元额度，所以 price = 1 也就是「1 元 = 1 🔱」。",
  rechargePlansVerified: false,
  priceCurrency: "USD",
  priceCurrencyVerified: true,
  priceCurrencyNote: "报文里的倍率与 billing_expr 系数都是美元额度价，报价 = 官方价 × 分组倍率；price = 1、quota_per_unit = 500000、quota_display_type = CUSTOM、custom_currency_symbol = 🔱、custom_currency_exchange_rate = 1、usd_exchange_rate = 1。控制台按站点设置的币种显示额度，不影响这里的价格。",
  enabled: true,
  mode: "direct",
  auth: { type: "none" },
  adapter: { kind: "declarative", endpoint: DEFAULT_PRICING_ENDPOINT, method: "GET", responseFormat: "price-map", priceMap: PRICE_MAP }
};

const pluginSource = {
  id: "orcax",
  host: "orcax.net",
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
  rationale: "OrcaX 的 /api/pricing 匿名可读，14 个模型单分组、倍率与充值口径都取自 /api/status",
  request: requestPolicy(() => DEFAULT_PRICING_ENDPOINT, { credentials: "omit" })
};

const MODEL_ALIASES = [];

export const sitePlugin = { ...pluginSource, modelAliases: MODEL_ALIASES };
