// 由 scripts/plugin-build.mjs 从 plugins/ 生成，不要手改。重新生成：node scripts/plugin-build.mjs

// 由 out/recon/linuxdo-20261124/make-b-plugins.mjs 生成，报文取自登录态实测。
import { DEFAULT_PRICING_ENDPOINT as PRICING_ENDPOINT, localStoragePageAuth, requestPolicy } from "../../core/provider-registry.js";

// 站点画像（2026-11-24 登录态实测）：
//   /api/pricing 匿名 401，带登录凭据 200，报文是 tokenflux/allrouter 同款形状：data 行数组、group_ratio /
//   usable_group / supported_endpoint / vendors / pricing_version 齐全。站点自报 51 个模型、10 个分组，
//   按 10 个 billing_expr 求解并乘分组倍率后落成 109 条「模型 × 分组 × 分段」：文本 token 价 93 条、按次 16 条，未决 0 条。
//   9 个分组倍率 0.2 到 1.2，倍率口径与 allrouter 一致：model_ratio 1 = $2/百万 token。
// 站点差异只有这一句：报文形状归到 allrouter 基座（tokenflux 映射 + 图片端点规则 + billing_expr 求解）。
const PRICE_MAP = { base: "allrouter" };

// 登录态：localStorage 的 user.id 要做成 New-Api-User 头，session cookie 由请求自己带上。
const pageAuth = localStoragePageAuth("user", "New-Api-User", "未找到Yuki登录凭据，请先在当前 Chrome 配置文件登录后重试", "", [401], null, ["id"]);

const preset = {
  id: "yuki",
  name: "Yuki",
  baseUrl: "https://yukiapi.com/",
  rechargeRmb: 1,
  rechargeCredits: 1,
  rechargeRateVerified: false,
  rechargeRateNote: "站点 /api/status：price = 1、quota_per_unit = 500000、quota_display_type = USD、usd_exchange_rate = 1，即 1 元买 1 美元额度。充值档位在 /api/user/topup/info（需登录）：10 元起，满 50 打 99 折、100 打 98 折、200 打 97 折、300 打 95 折；同样只读配置、未真实付款，rechargeRateVerified 为 false。",
  rechargePlansVerified: false,
  priceCurrency: "USD",
  priceCurrencyVerified: false,
  priceCurrencyNote: "报价由 /api/pricing 的 model_ratio × 分组倍率折算成美元每百万 token（倍率 1 = $2/M），带 billing_expr 的模型以表达式为准；只读了登录态报文，没有真实付款核对，所以 priceCurrencyVerified 为 false。",
  enabled: true,
  mode: "direct",
  auth: { type: "none" },
  adapter: { kind: "declarative", endpoint: PRICING_ENDPOINT, method: "GET", responseFormat: "price-map", priceMap: PRICE_MAP }
};

const HOSTS = ["yukiapi.com","www.yukiapi.com"];
const PATHS = ["/","/pricing","/console","/console/topup","/topup","/login"];

const pluginSource = {
  id: "yuki",
  host: "yukiapi.com",
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
  rationale: "Yuki 的 /api/pricing 要登录态，带上站点自己的凭据后直连采集",
  request: requestPolicy(() => PRICING_ENDPOINT, { credentials: "include", pageAuth })
};

const MODEL_ALIASES = [];

export const sitePlugin = { ...pluginSource, modelAliases: MODEL_ALIASES };
