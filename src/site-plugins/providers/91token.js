// 由 scripts/plugin-build.mjs 从 plugins/ 生成，不要手改。重新生成：node scripts/plugin-build.mjs

import { DEFAULT_PRICING_ENDPOINT, requestPolicy } from "../../core/provider-registry.js";

// 2026-11-19：/api/pricing 匿名返回 63 个模型、18 个分组，价格都在 billing_expr。
// 系数 × group_ratio 对齐页面 ¥：claude-fable-5 / Claude MAX 为 13 / 65 / 1.3。
// /api/status 的 price=1、usd_exchange_rate=1；充值视角与标准视角同价。
// 这些只能佐证 1:1 基准，登录后的档位、渠道费率和实付金额尚未核实。
const PRICE_MAP = { base: "tokenflux", source: "91token", currency: "CREDITS" };
const RECHARGE_NOTE = "公开 status 的 price=1、usd_exchange_rate=1，定价页充值视角与标准视角同价，暂按 1 元对应 1 美元额度记录。充值方案、赠送档位及渠道实付需要登录核实，当前比例未验证，不参与已验证推荐。";

const preset = {
  id: "91token",
  name: "91Token",
  baseUrl: "https://91token.com/pricing",
  rechargeRmb: 1,
  rechargeCredits: 1,
  rechargeAuto: false,
  rechargeRateVerified: false,
  rechargeRateNote: RECHARGE_NOTE,
  rechargePlansVerified: false,
  priceCurrency: "CREDITS",
  priceCurrencyVerified: true,
  priceCurrencyNote: "billing_expr 系数按每百万 token 的额度记，乘公开分组倍率后与页面 ¥ 数字一致。报价按美元额度保留，实际人民币成本仍取决于未验证的充值比例。长度档和峰谷档分别保留；fast/priority 加价保留为条件，数值为普通服务档基价。11 个视频模型含秒数、分辨率或其他用量表达式，暂不折算。",
  enabled: true,
  mode: "direct",
  auth: { type: "none" },
  adapter: { kind: "declarative", endpoint: DEFAULT_PRICING_ENDPOINT, method: "GET", responseFormat: "price-map", priceMap: PRICE_MAP }
};

const pluginSource = {
  id: "91token",
  host: "91token.com",
  preserveRechargeRateVerification: true,
  preset,
  matches: ({ hostname, path }) => hostname === "91token.com" && ["/", "/pricing", "/console", "/console/topup"].includes(path),
  prepareMatches: ({ hostname }) => hostname === "91token.com",
  prepare: (stationInput, { url }) => ({
    ...stationInput,
    baseUrl: `${url.origin}/pricing`,
    rechargeAuto: false,
    rechargeRateVerified: stationInput.rechargeRateVerified === true,
    rechargeRateNote: stationInput.rechargeRateNote || RECHARGE_NOTE,
    mode: "direct",
    auth: { type: "none" },
    adapter: { ...(stationInput.adapter || {}), kind: "declarative", endpoint: DEFAULT_PRICING_ENDPOINT, method: "GET", responseFormat: "price-map", priceMap: PRICE_MAP }
  }),
  mode: "direct",
  responseFormat: "price-map",
  authType: "none",
  rationale: "91Token 公开定价接口匿名采集；充值方案及实付需要登录另行核实",
  request: requestPolicy(() => DEFAULT_PRICING_ENDPOINT, { credentials: "omit" })
};

const MODEL_ALIASES = [];

export const sitePlugin = { ...pluginSource, modelAliases: MODEL_ALIASES };
