// 由 scripts/plugin-build.mjs 从 plugins/ 生成，不要手改。重新生成：node scripts/plugin-build.mjs

import { localStoragePageAuth, normalizeHostname, normalizePath, requestPolicy, stationContext } from "../../core/provider-registry.js";

const HOST = "jiji.cc";
const MODEL_PAGE = "/custom/13235f4cd3f1e94e";
const LEGACY_MODEL_PAGE = "/extension/models";
const MODEL_API = "/extension/api/model-market";
const MODEL_PATHS = new Set(["/", MODEL_PAGE, LEGACY_MODEL_PAGE, MODEL_API].map(normalizePath));
const isModelPath = path => MODEL_PATHS.has(normalizePath(path));

// 充值与返利口径（2026-11-17 登录态实测 /api/v1/payment/checkout-info + /api/v1/user/aff + /purchase 页面）：
//   快捷金额 10/20/50/100/200/500/1000/2000/5000 元；点 20 → 支付金额 ¥20.00 → 余额 +$20.00
//   balance_recharge_multiplier = 1；recharge_bonus_tiers = []、recharge_bonus_mode = bonus、notice 为空，无加赠
//   recharge_fee_rate = 0；plans = []，没有订阅制；subscription_usd_to_cny_rate = 0
//   支付宝 currency CNY、单笔 5–2000 元、日限 10000；Stripe currency CNY、单笔 50–5000 元、日限 0（不限）
//   global_min 5、global_max 5000；自定义金额走同一个 1:1 额度
//   邀请返利 effective_rebate_rate_percent = 5，好友每次充值返 5%，返利额度可一键转入余额
//   模型报价是 USD/1M tokens × 分组倍率（0.15–4.0），所以 1 元 = 1 美元额度，折算比例 1:1
const preset = {
  id: "jiji",
  name: HOST,
  baseUrl: `https://${HOST}${MODEL_PAGE}`,
  rechargeRmb: 1,
  rechargeCredits: 1,
  rechargeRateVerified: true,
  rechargeRateNote: "2026-11-17 登录态实测：充 20 元实付 ¥20.00、余额 +$20.00；9 档全部 1:1，无加赠、无手续费、无订阅制；支付宝 ¥5–2000/笔（日限 ¥10000），Stripe ¥50–5000/笔；邀请返利 5% 可转余额。",
  rechargeTiers: [
    { amount: 10, discount: 1 },
    { amount: 20, discount: 1 },
    { amount: 50, discount: 1 },
    { amount: 100, discount: 1 },
    { amount: 200, discount: 1 },
    { amount: 500, discount: 1 },
    { amount: 1000, discount: 1 },
    { amount: 2000, discount: 1 },
    { amount: 5000, discount: 1 }
  ],
  priceCurrency: "USD",
  priceCurrencyVerified: true,
  priceCurrencyNote: "模型市场按分组倍率折算，币种 USD/1M tokens；分组倍率跨度 0.15–4.0（Codex Cheap 0.185、Codex SVIP 0.55、Claude Code Max 1.5）。",
  enabled: true,
  mode: "page",
  auth: { type: "none" },
  adapter: { kind: "jiji", endpoint: `https://${HOST}${MODEL_API}`, method: "GET", responseFormat: "auto" }
};

function requestConfig(value) {
  const url = value instanceof URL ? value : stationContext({ baseUrl: value }).url;
  if (!url || normalizeHostname(url.hostname) !== HOST || !isModelPath(url.pathname)) return null;
  const token = url.searchParams.get("token") || "";
  const endpoint = new URL(MODEL_API, url.origin);
  return { baseUrl: `${url.origin}${MODEL_PAGE}`, endpoint: endpoint.toString(), token };
}

function prepare(stationInput, { url }) {
  const config = requestConfig(url);
  if (!config) return stationInput;
  const inputAuth = stationInput.auth || {};
  const token = String(inputAuth.token || config.token || "").trim();
  return {
    ...stationInput,
    baseUrl: config.baseUrl,
    mode: "page",
    auth: token ? { ...inputAuth, type: "bearer", token } : inputAuth,
    adapter: { ...(stationInput.adapter || {}), kind: "jiji", endpoint: config.endpoint, method: "GET", responseFormat: "auto" }
  };
}

const pluginSource = {
  id: "jiji",
  host: HOST,
  matches: ({ hostname, path }) => hostname === HOST && isModelPath(path),
  prepareMatches: ({ hostname, path }) => hostname === HOST && isModelPath(path),
  prepare,
  preset,
  mode: "direct",
  openTemporaryPage: true,
  rationale: "通过吉吉模型市场 API 直连采集",
  request: requestPolicy(() => MODEL_API, {
    endpointCandidates: "provider",
    credentials: "omit",
    pageHeaders: ["Authorization"],
    // 站点把 auth_token 存在 localStorage，24 小时过期。过期后前端拿 refresh_token 换一对新的
    // （refresh_token 每次轮换），这里照同一套续期，登录过一次之后就不用再回来手动登。
    pageAuth: localStoragePageAuth("auth_token", "Authorization", "未找到 Jiji 登录凭据，请先在当前 Chrome 配置文件登录后重试", "Bearer", [401], {
      endpoint: "/api/v1/auth/refresh",
      credentials: "same-origin",
      requestTokenKey: "refresh_token",
      responsePath: "data",
      accessTokenKey: "access_token",
      refreshTokenStorageKey: "refresh_token",
      refreshTokenKey: "refresh_token",
      expiresInKey: "expires_in",
      expiresAtStorageKey: "token_expires_at",
      statuses: [401]
    })
  })
};

const MODEL_ALIASES = [];

export const sitePlugin = { ...pluginSource, modelAliases: MODEL_ALIASES };
