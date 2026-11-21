// 由 scripts/plugin-build.mjs 从 plugins/ 生成，不要手改。重新生成：node scripts/plugin-build.mjs

import { DEFAULT_PRICING_ENDPOINT, requestPolicy } from "../../core/provider-registry.js";
import { tokenfluxPriceMap } from "../../core/price-maps/tokenflux.js";

// 2026-11-19：/api/pricing 匿名返回 63 个模型、18 个分组，价格都在 billing_expr。
// 系数 × group_ratio 对齐页面 ¥：claude-fable-5 / Claude MAX 为 13 / 65 / 1.3。
// 登录后 topup/info 的 discount={}；抽查 8 个金额的 amount 报价均为 1:1，订阅列表为空。
// 支付宝、微信确认页均为充 ¥10 / 付 ¥10；尚未进入第三方收银台，不记录渠道实付。
const PRICE_MAP = {
  base: "tokenflux",
  source: "91token",
  currency: "CREDITS",
  rules: [
    {
      when: [
        { path: "billing_usage_schema.tokens", present: true },
        { path: "billing_usage_schema.resolution", present: true },
        { path: "billing_usage_schema.video_input", present: true }
      ],
      kind: "unsupported",
      sourcePath: "billing_expr",
      reason: "视频按 token 用量、分辨率和参考视频联合计费，暂不支持"
    },
    {
      when: [
        { path: "billing_usage_schema.credit_source", present: true },
        { path: "billing_usage_schema.credits", present: true }
      ],
      kind: "unsupported",
      sourcePath: "billing_expr",
      reason: "视频按实际 credits 或分辨率与时长估算计费，暂不支持"
    },
    {
      when: [
        { path: "billing_usage_schema.input_video_seconds", present: true },
        { path: "billing_usage_schema.seconds", present: true }
      ],
      kind: "unsupported",
      sourcePath: "billing_expr",
      reason: "视频按输入与输出秒数及分辨率联合计费，暂不支持"
    },
    ...tokenfluxPriceMap.rules
  ]
};
const LEGACY_RECHARGE_NOTE = "公开 status 的 price=1、usd_exchange_rate=1，定价页充值视角与标准视角同价，暂按 1 元对应 1 美元额度记录。充值方案、赠送档位及渠道实付需要登录核实，当前比例未验证，不参与已验证推荐。";
const RECHARGE_NOTE = "2026-11-19 登录核验：1 元换 1 额度。10/20/50/100/200/500 元为快捷金额，无阶梯折扣或充值赠送；自定义范围 10–3000 元，另测 1000/3000 元报价仍为 1:1。当前订阅方案为空。支付宝、微信确认页充 10 元均待付 10 元，第三方收银台实付尚未核实。";

const preset = {
  id: "91token",
  name: "91Token",
  baseUrl: "https://91token.com/pricing",
  rechargeRmb: 1,
  rechargeCredits: 1,
  rechargeAuto: false,
  rechargeRateVerified: true,
  rechargeRateNote: RECHARGE_NOTE,
  rechargePlans: [10, 20, 50, 100, 200, 500].map(amount => ({
    kind: "topup", amount, credits: amount, currency: "CNY", availability: "self_service", verified: true,
    note: "快捷金额，非折扣；登录报价接口返回等额人民币，支持自定义 10–3000 元。"
  })),
  rechargePlansVerified: true,
  rechargePaymentsVerified: false,
  priceCurrency: "CREDITS",
  priceCurrencyVerified: true,
  priceCurrencyNote: "billing_expr 系数按每百万 token 的额度记，乘公开分组倍率后与页面 ¥ 数字一致；已核实 1 元换 1 额度。长度档和峰谷档分别保留；fast/priority 加价保留为条件，数值为普通服务档基价。按 token 用量、credits 或输入与输出秒数联合计费的视频模型暂不折算，具体原因列入未定价清单。",
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
  matches: ({ hostname, path }) => hostname === "91token.com" && ["/", "/pricing", "/wallet", "/console", "/console/topup"].includes(path),
  prepareMatches: ({ hostname }) => hostname === "91token.com",
  prepare: (stationInput, { url }) => {
    const defaultRate = (stationInput.rechargeRmb == null || Number(stationInput.rechargeRmb) === 1) &&
      (stationInput.rechargeCredits == null || Number(stationInput.rechargeCredits) === 1) &&
      (stationInput.rechargeRate == null || Number(stationInput.rechargeRate) === 1) &&
      stationInput.rechargeCurrency !== "USD";
    const legacyPreset = defaultRate && stationInput.rechargeRateNote === LEGACY_RECHARGE_NOTE &&
      !stationInput.rechargeTiers?.length && !stationInput.rechargePlans?.length && !stationInput.rechargePayments?.length;
    return {
      ...stationInput,
      baseUrl: `${url.origin}/pricing`,
      rechargeAuto: false,
      rechargeRateVerified: stationInput.rechargeRateVerified === true || legacyPreset ||
        (defaultRate && stationInput.rechargeRateVerified == null),
      rechargeRateNote: legacyPreset ? RECHARGE_NOTE : stationInput.rechargeRateNote || RECHARGE_NOTE,
      ...(legacyPreset || stationInput.rechargePlans == null ? {
        rechargePlans: preset.rechargePlans,
        rechargePlansVerified: true
      } : {}),
      priceCurrencyNote: legacyPreset ? preset.priceCurrencyNote : stationInput.priceCurrencyNote || preset.priceCurrencyNote,
      mode: "direct",
      auth: { type: "none" },
      adapter: { ...(stationInput.adapter || {}), kind: "declarative", endpoint: DEFAULT_PRICING_ENDPOINT, method: "GET", responseFormat: "price-map", priceMap: PRICE_MAP }
    };
  },
  mode: "direct",
  responseFormat: "price-map",
  authType: "none",
  rationale: "91Token 公开定价接口匿名采集；登录已核实充值报价 1:1，第三方收银台实付尚未核实",
  request: requestPolicy(() => DEFAULT_PRICING_ENDPOINT, { credentials: "omit" })
};

const MODEL_ALIASES = [];

export const sitePlugin = { ...pluginSource, modelAliases: MODEL_ALIASES };
