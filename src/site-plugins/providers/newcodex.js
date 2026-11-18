// 由 scripts/plugin-build.mjs 从 plugins/ 生成，不要手改。重新生成：node scripts/plugin-build.mjs

import { NEWCODEX_PRICING_ENDPOINT, requestPolicy } from "../../core/provider-registry.js";

// 站点画像（2026-11-18 匿名 curl 实测）：
//   /api/pricing 200、21178 字节、69 个模型、11 个分组倍率，price / quota_per_unit 都在里面
//   /api/status 里 price = 1、usd_exchange_rate = 1、quota_per_unit = 500000、quota_display_type = USD，
//   公告写「充值比例 1:1」，所以 1 元 = 1 美元额度
//   分组倍率乘在官方价上，model_ratio 1 = $2/M；抽样核对：claude-opus-4-5 在 ClaudeCode-Max（1.3）= $5 × 1.3 = $6.5
//   分组：Sale号池 0.06 / Plus号池 0.15 / Pro号池 0.3 / DeepSeek 0.3 / GLM 0.3 / Grok_Heavy号池 0.3（无模型）
//        Kiro逆向 0.4 / Cursor逆向 0.45 / Gemini 0.5 / Codex-image 1 / ClaudeCode-Max 1.3
//   17 条模型价格写在 billing_expr 里（tier("标准", p*2 + c*10 + ...)，系数即美元/百万 token），
//   这些条目的 model_ratio 一律填 37.5 当占位，真实价只能从表达式取
//   另有 8 条模型的 model_ratio 就是 37.5 且没有表达式（gemini-3.7-flash-high 这类选路变体），
//   折下来 $75/M，比同族基础价贵 100 倍，照实采，不替它编别名
//   5 个 gpt-image-* 是 tier("image", fixed(0.04)) * image_count → $0.04/张，
//   必须走带表达式支持的归一（内建的 new-api-pricing 会丢掉 fixed() 档位，回落到占位倍率算成 $75/M）
//   另外这个站的倍率类 model_ratio 按 1 = $2/百万 token 算（与它自己的 billing_expr 系数对得上），
//   所以用 newcodex 这份映射（tokenflux 形状 + 倍率乘 2），不用 tokenflux 原版，否则倍率类报价会低一半
//   /api/models、/api/user/topup/info 都要登录，价格接口不用，所以是 direct 直连
const preset = {
  id: "newcodex",
  name: "NewCodex",
  baseUrl: "https://newcodex.cn/pricing",
  rechargeRmb: 1,
  rechargeCredits: 1,
  rechargeRateVerified: true,
  rechargeRateNote: "站点 /api/status：price = 1、quota_per_unit = 500000、quota_display_type = USD，公告写「充值比例 1:1，无任何套路」，即 1 元 = 1 美元额度。单笔 ¥100 起赠 10%、¥200 起赠 20%、¥500 起赠 40%、¥1000 起赠 50%，赠送额度已折进档位表；邀请返利 20%。stripe_unit_price = 8 与 price = 1 对不上，来源未确认，不采信。",
  // amount 是到手的美元面值，discount 是每 1 面值实付的人民币：
  // ¥100 → $110（100/110 = 0.9091）、¥200 → $240、¥500 → $700、¥1000 → $1500
  rechargeTiers: [
    { amount: 110, discount: 0.9091 },
    { amount: 240, discount: 0.8333 },
    { amount: 700, discount: 0.7143 },
    { amount: 1500, discount: 0.6667 }
  ],
  rechargePlansVerified: true,
  rechargePlans: [
    { kind: "topup", amount: 100, credits: 110, currency: "CNY", availability: "self_service", verified: true, note: "单笔 ¥100 起，赠送 10%" },
    { kind: "topup", amount: 200, credits: 240, currency: "CNY", availability: "self_service", verified: true, note: "单笔 ¥200 起，赠送 20%" },
    { kind: "topup", amount: 500, credits: 700, currency: "CNY", availability: "self_service", verified: true, note: "单笔 ¥500 起，赠送 40%" },
    { kind: "topup", amount: 1000, credits: 1500, currency: "CNY", availability: "self_service", verified: true, note: "单笔 ¥1000 起，赠送 50%" }
  ],
  priceCurrency: "CREDITS",
  priceCurrencyVerified: true,
  priceCurrencyNote: "额度计价，1 元充值换 1 美元额度；报价是官方价 × 分组倍率（0.06–1.3）。",
  enabled: true,
  mode: "direct",
  auth: { type: "none" },
  adapter: { kind: "tokenflux", endpoint: NEWCODEX_PRICING_ENDPOINT, method: "GET", responseFormat: "newcodex" }
};

const pluginSource = {
  id: "newcodex",
  host: "newcodex.cn",
  preset,
  matches: ({ hostname, path }) => hostname === "newcodex.cn" && ["/", "/pricing", "/console/topup"].includes(path),
  prepareMatches: ({ hostname }) => hostname === "newcodex.cn",
  prepare: (stationInput, { url }) => ({
    ...stationInput,
    baseUrl: `${url.origin}/pricing`,
    mode: "direct",
    auth: { type: "none" },
    adapter: { ...(stationInput.adapter || {}), kind: "tokenflux", endpoint: NEWCODEX_PRICING_ENDPOINT, method: "GET", responseFormat: "newcodex" }
  }),
  mode: "direct",
  responseFormat: "newcodex",
  authType: "none",
  rationale: "NewCodex 的 /api/pricing 匿名可读，价格与充值档位都不需要登录",
  request: requestPolicy(() => NEWCODEX_PRICING_ENDPOINT, { credentials: "omit" })
};

const MODEL_ALIASES = [
  {
    "alias": "gemini-2.5-flash-nothinking",
    "canonicalId": "gemini-2-5-flash"
  },
  {
    "alias": "gemini-3-flash",
    "canonicalId": "gemini-3-flash-preview"
  },
  {
    "alias": "gemini-3-flash-thinking-128",
    "canonicalId": "gemini-3-flash-preview"
  },
  {
    "alias": "gemini-3.1-pro",
    "canonicalId": "gemini-3-1-pro-preview"
  },
  {
    "alias": "gemini-3.1-pro-high",
    "canonicalId": "gemini-3-1-pro-preview"
  },
  {
    "alias": "gemini-3.1-pro-preview-low",
    "canonicalId": "gemini-3-1-pro-preview"
  },
  {
    "alias": "gemini-3.5-flash-high",
    "canonicalId": "gemini-3-5-flash"
  },
  {
    "alias": "gemini-3.5-flash-low",
    "canonicalId": "gemini-3-5-flash"
  },
  {
    "alias": "gemini-3.6-flash-high",
    "canonicalId": "gemini-3-6-flash"
  },
  {
    "alias": "gemini-3.6-flash-low",
    "canonicalId": "gemini-3-6-flash"
  },
  {
    "alias": "gemini-3.6-flash-medium",
    "canonicalId": "gemini-3-6-flash"
  },
  {
    "alias": "gemini-3.7-flash-high",
    "canonicalId": "gemini-3-7-flash"
  },
  {
    "alias": "gemini-3.7-flash-low",
    "canonicalId": "gemini-3-7-flash"
  },
  {
    "alias": "gemini-3.7-flash-medium",
    "canonicalId": "gemini-3-7-flash"
  },
  {
    "alias": "gemini-3.7-flash-tiered",
    "canonicalId": "gemini-3-7-flash"
  },
  {
    "alias": "gemini-3.8-flash-high",
    "canonicalId": "gemini-3-8-flash"
  },
  {
    "alias": "gemini-3.8-flash-low",
    "canonicalId": "gemini-3-8-flash"
  },
  {
    "alias": "gemini-3.8-flash-medium",
    "canonicalId": "gemini-3-8-flash"
  },
  {
    "alias": "gemini-3.8-flash-tiered",
    "canonicalId": "gemini-3-8-flash"
  }
];

export const sitePlugin = { ...pluginSource, modelAliases: MODEL_ALIASES };
