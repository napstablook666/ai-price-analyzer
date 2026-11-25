// 由 scripts/plugin-build.mjs 从 plugins/ 生成，不要手改。重新生成：node scripts/plugin-build.mjs

import { ALLROUTER_PRICING_ENDPOINT, requestPolicy } from "../../core/provider-registry.js";

// 站点画像（2026-11-25 实测）：
//   主机 acombcom.cn，站名 Relayo（价目页抬头「Relayo」）。
//   GET /api/pricing 匿名 200、16.5KB、30 条、2 个分组（default 1 / Token Plan User 0.8），
//   无需登录；/api/user/topup/info 要登录，401 AUTH_UNAUTHORIZED。
//   报文形状与常见 New API 不同：billing_mode = "direct"，不给 model_ratio，直接给
//   input_price / output_price / cache_read_price / cache_write_price，按人民币每百万
//   token 计；billing_type 区分 tokens / request。这个形状吃 `direct` 基座。
//   币种实测过：渲染 /pricing 页面，claude-sonnet-5-5 显示「¥0.53424 / 1M Tokens」
//   缓存读取价，等于 /api/pricing 的 cache_read_price 0.6678 × Token Plan User 0.8，
//   页面通篇只有 ¥ 没有 $，故 priceCurrency 记 CNY。
//   计费形状：17 条按 token、13 条按次（9 个出图按张、4 个其它按次：3 个语音合成 + 1 个出图端点未标的）。
//   两个模型挂 0 价（hungerg-free、gpt-6-luna-free），站点公告自己写着「免费模型不计费，
//   也不承诺 SLA」，`direct` 基座把它们归到「按 0 计费（免费模型），不参与比价」。
//   另有 1 个 embedding 模型输出价为 0（本来就只按输入 token 收），行保留。
// 充值口径：
//   /api/status：price = 1、quota_per_unit = 500000、quota_display_type = CNY、
//   custom_currency_exchange_rate = 1，即 1 元换 1 元额度，没有汇率加成。
//   topup_preset_amounts = "1,20,100"；pay_methods = 支付宝 / 微信 / 自定义（满 50）；
//   epay_enabled = false（易支付未开）。档位与支付方式都读自运行时配置，但没有真实付款，
//   到账与赠送未证实，rechargePlansVerified / rechargePaymentsVerified 保持 false。
const PRICE_MAP = { base: "direct" };

const preset = {
  id: "relayo",
  name: "Relayo",
  baseUrl: "https://acombcom.cn/pricing",
  rechargeRmb: 1,
  rechargeCredits: 1,
  rechargeRateVerified: false,
  rechargeRateNote: "运行时配置 /api/status：price = 1、quota_per_unit = 500000、quota_display_type = CNY、custom_currency_exchange_rate = 1，即 1 元 = 1 元额度。未真实付款。",
  rechargeTiers: [
    { amount: 1, discount: 1 },
    { amount: 20, discount: 1 },
    { amount: 100, discount: 1 }
  ],
  rechargePlans: [
    { kind: "topup", amount: 1, credits: 1, discount: 1, currency: "CNY", availability: "self_service", verified: false, note: "topup_preset_amounts「1,20,100」最低档" },
    { kind: "topup", amount: 20, credits: 20, discount: 1, currency: "CNY", availability: "self_service", verified: false, note: "常用档，无赠送说明" },
    { kind: "topup", amount: 100, credits: 100, discount: 1, currency: "CNY", availability: "self_service", verified: false, note: "最高预设档，无赠送说明" },
    { kind: "topup", amount: 50, credits: 50, discount: 1, currency: "CNY", availability: "self_service", verified: false, note: "自定义金额通道最低 50 元" }
  ],
  rechargePlansVerified: false,
  rechargePayments: [
    { channel: "alipay", faceAmount: null, payAmount: null, currency: "CNY", status: "unavailable", paidRmb: null, at: "2026-11-25", note: "pay_methods 里有支付宝，充值页需登录；未发起真实订单。" },
    { channel: "wechat", faceAmount: null, payAmount: null, currency: "CNY", status: "unavailable", paidRmb: null, at: "2026-11-25", note: "pay_methods 里有微信，未验证到账。" }
  ],
  rechargePaymentsVerified: false,
  priceCurrency: "CNY",
  priceCurrencyVerified: true,
  priceCurrencyNote: "价目页按人民币每百万 token 展示（实测 claude-sonnet-5-5 缓存读取 ¥0.53424/M，等于接口值 0.6678 × Token Plan User 0.8）",
  enabled: true,
  mode: "direct",
  auth: { type: "none" },
  adapter: { kind: "declarative", endpoint: ALLROUTER_PRICING_ENDPOINT, method: "GET", responseFormat: "price-map", priceMap: PRICE_MAP }
};

const pluginSource = {
  id: "relayo",
  host: "acombcom.cn",
  preset,
  matches: ({ hostname, path }) => ["acombcom.cn", "www.acombcom.cn"].includes(hostname) &&
    ["/", "/pricing", "/console/topup", "/models"].includes(path),
  prepareMatches: ({ hostname }) => ["acombcom.cn", "www.acombcom.cn"].includes(hostname),
  prepare: (stationInput, { url }) => ({
    ...stationInput,
    baseUrl: `${url.origin}/pricing`,
    mode: "direct",
    auth: { type: "none" },
    adapter: { ...(stationInput.adapter || {}), kind: "declarative", endpoint: ALLROUTER_PRICING_ENDPOINT, method: "GET", responseFormat: "price-map", priceMap: PRICE_MAP }
  }),
  mode: "direct",
  responseFormat: "price-map",
  authType: "none",
  rationale: "Relayo 公开 /api/pricing 直连采集，30 个模型走人民币每百万直价（direct 形状），2 个分组",
  request: requestPolicy(() => ALLROUTER_PRICING_ENDPOINT, { credentials: "omit" })
};

const MODEL_ALIASES = [];

export const sitePlugin = { ...pluginSource, modelAliases: MODEL_ALIASES };
