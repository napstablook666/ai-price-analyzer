// 由 scripts/plugin-build.mjs 从 plugins/ 生成，不要手改。重新生成：node scripts/plugin-build.mjs

import { DEFAULT_PRICING_ENDPOINT as PRICING_ENDPOINT, cookieRefreshAuth, requestPolicy } from "../../core/provider-registry.js";

// 站点画像（2026-11-25 登录态实测）：
//   主机 claw-cn.org / www.claw-cn.org / api.claw-cn.org（价目页在 api 子域）。
//   /api/pricing 匿名 401 `{code:"AUTH_UNAUTHORIZED",message:"Unauthorized, invalid access token"}`，
//   /api/status 匿名 200（9.4KB）；带登录凭据后 /api/pricing 200、18.8KB。
//   鉴权：cookie `new_api_has_session` 换 access_token（POST /api/user/auth/refresh，
//   返回 data.access_token 与 data.access_expires_at），再用 Authorization: Bearer。
//   注意 access_token **不在** localStorage 里（只有 i18nextLng / system-config-storage /
//   app:rev / newapi:default:cache-version / status 五个键），所以只能用 cookie 换，不能读存储。
//   报文是 tokenflux/allrouter 同款：data 行数组 + group_ratio / usable_group /
//   supported_endpoint / vendors / pricing_version 齐全，带 billing_expr 与
//   cache_ratio / create_cache_ratio，故归 allrouter 基座。
//   倍率刻度按价目页核过：claude-opus-4-8 在「国外模型-Anthropic-kiro」组显示
//   `$3 / 1M` 输入、`$15 / 1M` 输出、`$0.3 / 1M` 缓存，等于 model_ratio 2.5 × 分组倍率
//   0.6 × 2，即 model_ratio 1 = $2/百万 token，与基座默认 ratioBase 一致，不用覆盖。
//   页面通篇只有 $ 没有 ¥，priceCurrency 记 USD 且已验证。
//   计费形状：47 个模型、12 个分组倍率、落价 10 个分组、88 条「模型 × 分组 × 分段」，
//   其中 73 条按 token、15 条按次/按张（3 个 deepseek bytime 模型各 3 档长度阶梯走「按次」组，
//   5 个生图模型走「生图专区」按张，未决 0 条）。
//   「按次」组站点自己标注「福利组(倍率随时调整)，不保证稳定，并发低」。
// 充值口径：
//   /api/status：price = 1、quota_per_unit = 500000、quota_display_type = USD、
//   usd_exchange_rate = 1、custom_currency_exchange_rate = 1，即 1 元 = 1 美元额度，
//   没有汇率加成；stripe_unit_price = 8 但 enable_stripe_topup 为 false（Stripe 档没开）。
//   /api/user/topup/info（登录态）：amount_options 10 / 50 / 100 / 500 / 1000，
//   discount 50→0.98、100→0.98、500→0.97、1000→0.96（10 元档不打折），
//   min_topup = 5，支付方式支付宝 / 微信，enable_online_topup = true，enable_redemption = true。
//   读的是接口配置，没有真实付款，rechargeRateVerified 保持 false。
const PRICE_MAP = { base: "allrouter" };

// 登录态在 cookie 里，匿名接口 401；用 cookie 换 access_token 后由 service worker 带 Bearer 出网。
const cookieAuth = cookieRefreshAuth({
  cookieName: "new_api_has_session",
  refreshPath: "/api/user/auth/refresh",
  accessTokenPath: "data.access_token",
  expiresAtPath: "data.access_expires_at",
  missingMessage: "未找到 ClawCn-API 登录凭据，请先在当前 Chrome 配置文件登录后重试",
  failureMessage: "ClawCn-API 登录态已失效，请在当前 Chrome 配置文件重新登录后重试"
});

const preset = {
  id: "clawcn",
  name: "ClawCn-API",
  baseUrl: "https://api.claw-cn.org/pricing",
  rechargeRmb: 1,
  rechargeCredits: 1,
  rechargeRateVerified: false,
  rechargeRateNote: "站点 /api/status：price = 1、quota_per_unit = 500000、quota_display_type = USD、usd_exchange_rate = 1、custom_currency_exchange_rate = 1，即 1 元买 1 美元额度、没有汇率加成。充值档位实测于 2026-11-25（登录态带 Bearer 读 /api/user/topup/info）：面额 10 / 50 / 100 / 500 / 1000 元，50 与 100 打 98 折、500 打 97 折、1000 打 96 折、10 元档不打折，min_topup = 5，支付开支付宝与微信。读的是接口配置，没真实付款，rechargeRateVerified 保持 false。",
  rechargeTiers: [
    { amount: 10, discount: 1 },
    { amount: 50, discount: 0.98 },
    { amount: 100, discount: 0.98 },
    { amount: 500, discount: 0.97 },
    { amount: 1000, discount: 0.96 }
  ],
  rechargePlans: [
    { kind: "topup", amount: 10, credits: 10, discount: 1, currency: "USD", availability: "self_service", verified: true, note: "最低面额，无折扣" },
    { kind: "topup", amount: 50, credits: 50, discount: 0.98, currency: "USD", availability: "self_service", verified: true, note: "98 折" },
    { kind: "topup", amount: 100, credits: 100, discount: 0.98, currency: "USD", availability: "self_service", verified: true, note: "98 折" },
    { kind: "topup", amount: 500, credits: 500, discount: 0.97, currency: "USD", availability: "self_service", verified: true, note: "97 折" },
    { kind: "topup", amount: 1000, credits: 1000, discount: 0.96, currency: "USD", availability: "self_service", verified: true, note: "96 折，全额最高档" }
  ],
  rechargePlansVerified: true,
  rechargePayments: [
    { channel: "alipay", faceAmount: null, payAmount: null, currency: "CNY", status: "unavailable", paidRmb: null, at: "2026-11-25", note: "pay_methods 里有支付宝与微信，min_topup 5 元；未发起真实订单，未证明到账。" }
  ],
  rechargePaymentsVerified: false,
  priceCurrency: "USD",
  priceCurrencyVerified: true,
  priceCurrencyNote: "价目页按美元每百万 token 展示（实测 claude-opus-4-8 在 kiro 组 $3 输入 / $15 输出 / $0.3 缓存，等于 model_ratio 2.5 × 0.6 × 2），页面无 ¥ 符号",
  enabled: true,
  mode: "direct",
  auth: { type: "none" },
  adapter: { kind: "declarative", endpoint: PRICING_ENDPOINT, method: "GET", responseFormat: "price-map", priceMap: PRICE_MAP }
};

const HOSTS = ["claw-cn.org", "www.claw-cn.org", "api.claw-cn.org"];
const PATHS = ["/", "/pricing", "/console", "/console/topup", "/topup", "/sign-in"];

const pluginSource = {
  id: "clawcn",
  host: "claw-cn.org",
  preset,
  matches: ({ hostname, path }) => HOSTS.includes(hostname) && PATHS.includes(path),
  prepareMatches: ({ hostname }) => HOSTS.includes(hostname),
  prepare: (stationInput, { url }) => ({
    ...stationInput,
    baseUrl: `${url.origin}/pricing`,
    mode: "direct",
    auth: { type: "none" },
    adapter: { ...(stationInput.adapter || {}), kind: "declarative", endpoint: PRICING_ENDPOINT, method: "GET", responseFormat: "price-map", priceMap: PRICE_MAP }
  }),
  mode: "direct",
  responseFormat: "price-map",
  authType: "none",
  rationale: "ClawCn-API 的 /api/pricing 要登录态，带上站点自己的凭据后直连采集",
  request: requestPolicy(() => PRICING_ENDPOINT, { credentials: "include", cookieAuth })
};

const MODEL_ALIASES = [];

export const sitePlugin = { ...pluginSource, modelAliases: MODEL_ALIASES };
