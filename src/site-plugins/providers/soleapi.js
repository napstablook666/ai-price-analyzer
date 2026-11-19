// 由 scripts/plugin-build.mjs 从 plugins/ 生成，不要手改。重新生成：node scripts/plugin-build.mjs

import { publicPricingProvider } from "../../core/provider-registry.js";

// 计费口径（2026-11-17 实测，公开接口 /api/public/models + 模型详情页 /zh/models/<模型名>）：
//   结算单位是 Credits，模型页原文「1 Credit = ¥1」
//   charges.prompt / completion / cache_* 是原价，× 分组 multiplier 才是本站每百万 tokens 的 Credits
//   例：gpt-5.6-sol 原价 5 × 0.3 = 1.5 Credits/M，页面标「≈ ¥32.99 官方价，省 95%」
//   同一模型会挂多个分组（ChatGPT折扣 0.3 / ChatGPT稳定 0.5 / Azure 2.5），插件按分组各出一行
//   充值与汇率（2026-11-17 登录态实测 /api/iam/wallet?promo=1 + /api/public/fx）：
//     tiers 50 / 100 / 500 / 1000，折扣 0% / 1% / 2% / 3%，自助范围 minAmountUsd 50 到 maxAmountUsd 50000（字段叫 Usd，界面按元口径）
//     providers = stripe（支付宝/微信/银行卡）+ infini（USDT/USDC），均按美元结算
//     fx USD = 0.1515404082，即 1 元 ≈ $0.1515（1 USD ≈ ¥6.60），充 ¥50 实付 $7.58 得 50 Credits
//     余额字段 balanceUsd，0.0343 Credits 显示 ≈ ¥0.0343，所以 1 Credit 记 1 元额度
//     邀请返现 5%，好友充值后冻结 30 天到账（不进档位计算）
const preset = {
  // >>> recharge-probe（由 scripts/recharge-apply.mjs 生成，勿手改）
  rechargePayments: [
    { channel: "stripe", faceAmount: 50, payAmount: 7.58, currency: "USD", paidRmb: 50, at: "2026-11-17", note: "充 ¥50 实付 $7.58 得 50 Credits，paidRmb 按 1 Credit = 1 元折算" },
  ],
  rechargePaymentsVerified: true,
  // <<< recharge-probe
  id: "soleapi",
  name: "soleapi.com",
  baseUrl: "https://soleapi.com/zh/models",
  rechargeRmb: 1,
  rechargeCredits: 1,
  rechargeRateVerified: true,
  rechargeRateNote: "2026-11-17 登录态实测：档位 50/100/500/1000 Credits 折扣 0/1/2/3%，实付按 Stripe 汇率折美元（1 元≈$0.1515，1 USD≈¥6.60）；1 Credit 记 1 元额度，邀请返现 5% 冻结 30 天。",
  rechargeTiers: [
    { amount: 50, discount: 1 },
    { amount: 100, discount: 0.99 },
    { amount: 500, discount: 0.98 },
    { amount: 1000, discount: 0.97 }
  ],
  priceCurrency: "CREDITS",
  priceCurrencyVerified: true,
  priceCurrencyNote: "每个模型页都标「N Credits / M tokens」；charges 里的 usd/cny 只决定官方原价折算，结算按 Credits。",
  enabled: true,
  mode: "direct",
  auth: { type: "none" },
  adapter: { kind: "public-pricing", endpoint: "/api/public/models", method: "GET", responseFormat: "auto" }
};

const pluginSource = publicPricingProvider("soleapi", "soleapi.com", preset, "SoleAPI 通过公开模型价格 API 采集，价格以 Credits 计（1 Credit = ¥1）");

const MODEL_ALIASES = [];

export const sitePlugin = { ...pluginSource, modelAliases: MODEL_ALIASES };
