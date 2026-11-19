// 由 scripts/plugin-build.mjs 从 plugins/ 生成，不要手改。重新生成：node scripts/plugin-build.mjs

import { DEFAULT_PRICING_ENDPOINT, requestPolicy } from "../../core/provider-registry.js";

// 口径调研（2026-11-20，匿名可读，不需要登录）：
//   报文 /api/pricing：322 个模型，quota_type 0（按 token）211 个、1（按次）111 个，
//     model_ratio 的基准是 2 美元/M（quota_per_unit = 500000，price = 1，与 New API 默认一致）。
//   页面 /pricing：claude-opus-5-5 显示 0.353，最低分组 0.08824 × 2 × 2 = 0.35296 对得上；
//     gpt-image-2-c 显示 0.00882 / request，报文最低分组 0.0088236 对得上。页面不带货币符号。
//   站点自述：/relay 与 /wholesale 写着「1 美元 = 1 美元额度，用多少扣多少，最低充值 $1」，
//     /api/status 里 currency_type = USD、payment_currency_symbol = $、price = 1、original_price = 1、
//     custom_currency_exchange_rate = 1（1 美元额度就是 1 美元），
//     usd_exchange_rate = 6.68752（站内把美元额度换算成人民币显示用的值，不是收银台汇率），
//     bulk_topup_discounts 14 档（10 面值 9.9 折，10 万面值 0.925），min_topup = 1。
//   收银台实测（2026-11-19，登录态 uid 1069525，只下单未付款）：
//     面值 $10 → 页面「折扣 -$0.10 / 实付 $9.90」→ 下单后 /api/user/pay 返回
//     money = "9.90"、type 分别为 antom / wxpay / alipay，三个渠道进网关后全是「USD 9.90」：
//       antom（Alipay+，商户 COGNIS AI PTE. LTD.）→ g.alipayplus.com 收银台「支付总额 USD 9.90」；
//       doit 收银台（支付宝/微信两条国内通道）→ 「Total Amount: USD 9.90」。
//     全链路没有出现人民币金额，也没有汇率字段；人民币是支付宝/微信钱包在扫码那一刻按自身汇率换算的。
//   所以：1 美元额度 = 0.99 美元实付（10 档），人民币成本 = 0.99 × 钱包汇率，
//     站点侧唯一的人民币换算是 usd_exchange_rate 6.68752，按它折算 1 美元额度 ≈ 6.62 元。
//     真实账单（钱包里扣的 ¥）没有拿到，等有账单以账单为准；若按中行牌价 7.3 换，约 7.23 元/美元额度。
// 报文形状与 RelayRouter 一致，映射直接复用基座；分组倍率 0.03677 ~ 1.1，95 个分组。
const PRICE_MAP = { base: "relayrouter" };

const preset = {
  // >>> recharge-probe（由 scripts/recharge-apply.mjs 生成，勿手改）
  rechargePayments: [
    { channel: "card", faceAmount: 300, payAmount: 291, currency: "USD", at: "2026-11-19", note: "用户截图，Antom 收银台待支付总额 $291.00（页面标节省 3.0%）" },
    { channel: "alipay", faceAmount: 10, payAmount: 9.9, currency: "USD", at: "2026-11-19", note: "登录态实测，doit 收银台 Total Amount USD 9.90" },
    { channel: "wechat", faceAmount: 10, payAmount: 9.9, currency: "USD", at: "2026-11-19", note: "登录态实测，doit 收银台 Total Amount USD 9.90" },
    { channel: "card", faceAmount: 10, payAmount: 9.9, currency: "USD", at: "2026-11-19", note: "登录态实测，antom（Alipay+，商户 COGNIS AI PTE. LTD.）收银台支付总额 USD 9.90" },
  ],
  rechargePaymentsVerified: true,
  // <<< recharge-probe
  id: "openlux",
  name: "OpenLux",
  baseUrl: "https://www.openlux.ai/pricing",
  // 1 美元额度 = 6.68752 元（站点 /api/status 的 usd_exchange_rate），面值折扣见档位表。
  // 收银台是美元实付（$10 档 $9.90），人民币要过钱包汇率，6.62 是站点自报汇率的折算值。
  rechargeRmb: 6.68752,
  rechargeCredits: 1,
  rechargeRateVerified: true,
  // /api/status 的 price 在这里是「1 美元面值卖 1 美元」（payment_currency_symbol 是 $），
  // 自动采集会把它当成「1 美元额度 = 1 元」写进折算，价格直接低 6.7 倍，所以锁手填值。
  rechargeAuto: false,
  rechargeRateNote: "支付全链路是美元：$10 面值实付 $9.90，/api/user/pay 的 money=9.90，antom（Alipay+）和 doit（支付宝/微信）收银台都显示 USD 9.90，站点不报人民币金额，人民币由钱包扫码时按自身汇率换算。这里的 6.68752 是站点 /api/status 的 usd_exchange_rate，按它折 1 美元额度 ≈ 6.62 元；真实人民币账单未取到，按中行牌价 7.3 会更高。price=1 是美元口径，自动采集会读成 1 元/美元额度，所以锁手填值。面值 10 起每档 9.9~9.25 折，已并入档位表。",
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
  priceCurrencyNote: "报文与页面都是美元额度，页面显示不带货币符号",
  enabled: true,
  mode: "direct",
  auth: { type: "none" },
  adapter: { kind: "declarative", endpoint: DEFAULT_PRICING_ENDPOINT, method: "GET", responseFormat: "price-map", priceMap: PRICE_MAP }
};

const pluginSource = {
  id: "openlux",
  host: "openlux.ai",
  preset,
  matches: ({ hostname, path }) => ["www.openlux.ai", "openlux.ai"].includes(hostname) &&
    ["/", "/pricing", "/console/topup", "/console/models"].includes(path),
  prepareMatches: ({ hostname }) => ["www.openlux.ai", "openlux.ai"].includes(hostname),
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
  rationale: "OpenLux 的 /api/pricing 匿名可读，按 token 与按次两种计费都覆盖，分组倍率与充值档位已按站点自述核过",
  request: requestPolicy(() => DEFAULT_PRICING_ENDPOINT, { credentials: "omit" })
};

const MODEL_ALIASES = [];

export const sitePlugin = { ...pluginSource, modelAliases: MODEL_ALIASES };
