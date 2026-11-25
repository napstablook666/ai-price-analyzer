// 由 scripts/plugin-build.mjs 从 plugins/ 生成，不要手改。重新生成：node scripts/plugin-build.mjs

// 由 out/recon/linuxdo-20261124/make-b-plugins.mjs 生成，报文取自登录态实测。
import { DEFAULT_PRICING_ENDPOINT as PRICING_ENDPOINT, cookieRefreshAuth, requestPolicy } from "../../core/provider-registry.js";

// 站点画像（2026-11-24 登录态实测）：
//   /api/pricing 匿名 401，带登录凭据 200，报文是 tokenflux/allrouter 同款形状：data 行数组、group_ratio /
//   usable_group / supported_endpoint / vendors / pricing_version 齐全。站点自报 23 个模型、10 个分组，
//   按 17 个 billing_expr 求解并乘分组倍率后落成 59 条「模型 × 分组 × 分段」：文本 token 价 59 条、按次 0 条，未决 0 条。
//   7 个分组倍率 0.15 到 1.5，倍率口径与 allrouter 一致：model_ratio 1 = $2/百万 token。
// 站点差异只有这一句：报文形状归到 allrouter 基座（tokenflux 映射 + 图片端点规则 + billing_expr 求解）。
const PRICE_MAP = { base: "allrouter" };

// 登录态在 cookie 里，匿名接口 401；用 cookie 换 access_token 后由 service worker 带 Bearer 出网。
const cookieAuth = cookieRefreshAuth({
  cookieName: "new_api_has_session",
  refreshPath: "/api/user/auth/refresh",
  accessTokenPath: "data.access_token",
  expiresAtPath: "data.access_expires_at",
  missingMessage: "未找到纸飞机登录凭据，请先在当前 Chrome 配置文件登录后重试",
  failureMessage: "纸飞机登录态已失效，请在当前 Chrome 配置文件重新登录后重试"
});

const preset = {
  id: "sccx",
  name: "纸飞机",
  baseUrl: "https://sccx.cc/",
  rechargeRmb: 1,
  rechargeCredits: 1,
  rechargeRateVerified: false,
  rechargeRateNote: "站点 /api/status：price = 1、quota_per_unit = 500000、quota_display_type = USD、usd_exchange_rate = 7.3，即 1 元买 1 美元额度、界面按 7.3 折算人民币显示。充值档位实测于 2026-11-25（登录态先 POST /api/user/auth/refresh 换 access_token，再读 /api/user/topup/info）：面额 10 / 20 / 50 / 100 / 200 / 500 元，discount 六个档全是 1，既没有赠送额度也没有折扣；支付开支付宝与微信，另有发卡页 https://wzyp.cn/shop/9JWDQ35P。读的是接口配置，没真实付款，rechargeRateVerified 保持 false。",
  rechargeTiers: [],
  rechargePlans: [
    { kind: "topup", amount: 10, credits: 10, discount: 1, currency: "USD", availability: "self_service", verified: true, note: "支付宝 / 微信，无折扣" },
    { kind: "topup", amount: 20, credits: 20, discount: 1, currency: "USD", availability: "self_service", verified: true, note: "支付宝 / 微信，无折扣" },
    { kind: "topup", amount: 50, credits: 50, discount: 1, currency: "USD", availability: "self_service", verified: true, note: "支付宝 / 微信，无折扣" },
    { kind: "topup", amount: 100, credits: 100, discount: 1, currency: "USD", availability: "self_service", verified: true, note: "支付宝 / 微信，无折扣" },
    { kind: "topup", amount: 200, credits: 200, discount: 1, currency: "USD", availability: "self_service", verified: true, note: "支付宝 / 微信，无折扣" },
    { kind: "topup", amount: 500, credits: 500, discount: 1, currency: "USD", availability: "self_service", verified: true, note: "支付宝 / 微信，无折扣" }
  ],
  rechargePlansVerified: true,
  rechargePayments: [
    { channel: "alipay", faceAmount: null, payAmount: null, currency: "CNY", status: "unavailable", paidRmb: null, at: "2026-11-25", note: "站点开支付宝与微信；发卡页在 wzyp.cn，未发起真实订单，未证明到账。" }
  ],
  rechargePaymentsVerified: false,
  priceCurrency: "USD",
  priceCurrencyVerified: false,
  priceCurrencyNote: "报价由 /api/pricing 的 model_ratio × 分组倍率折算成美元每百万 token（倍率 1 = $2/M），带 billing_expr 的模型以表达式为准；只读了登录态报文，没有真实付款核对，所以 priceCurrencyVerified 为 false。",
  enabled: true,
  mode: "direct",
  auth: { type: "none" },
  adapter: { kind: "declarative", endpoint: PRICING_ENDPOINT, method: "GET", responseFormat: "price-map", priceMap: PRICE_MAP }
};

const HOSTS = ["sccx.cc","www.sccx.cc"];
const PATHS = ["/","/sign-in","/console","/console/topup","/topup","/pricing"];

const pluginSource = {
  id: "sccx",
  host: "sccx.cc",
  preset,
  matches: ({ hostname, path }) => HOSTS.includes(hostname) && PATHS.includes(path),
  prepareMatches: ({ hostname }) => HOSTS.includes(hostname),
  prepare: (stationInput, { url }) => ({
    ...stationInput,
    baseUrl: `${url.origin}/`,
    mode: "direct",
    auth: { type: "none" },
    adapter: { ...(stationInput.adapter || {}), kind: "declarative", endpoint: PRICING_ENDPOINT, method: "GET", responseFormat: "price-map", priceMap: PRICE_MAP }
  }),
  mode: "direct",
  responseFormat: "price-map",
  authType: "none",
  rationale: "纸飞机 的 /api/pricing 要登录态，带上站点自己的凭据后直连采集",
  request: requestPolicy(() => PRICING_ENDPOINT, { credentials: "include", cookieAuth })
};

const MODEL_ALIASES = [];

export const sitePlugin = { ...pluginSource, modelAliases: MODEL_ALIASES };
