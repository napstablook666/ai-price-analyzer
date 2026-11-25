// 由 scripts/plugin-build.mjs 从 plugins/ 生成，不要手改。重新生成：node scripts/plugin-build.mjs

import { DEFAULT_PRICING_ENDPOINT as PRICING_ENDPOINT, requestPolicy } from "../../core/provider-registry.js";

// 站点画像（2026-11-24 实测，匿名直连 /api/pricing，不需要登录）：
//   system_name = 跃点，register_enabled = true，无 Turnstile。22 个模型，20 个把价写进 billing_expr，
//   写法这批里最全：tier("standard", p*A + c*B + cr*C + cc*D + cc1h*E)、len <= 272000 的长上下文分档、
//   以及 param("service_tier") in ["fast","priority"] 的双倍快档（fast_standard / fast_long_context 两个档名）。
//   5 个分组都是渠道名：cc 1、gpt官Key 0.4、gemini 0.4、gemini25 0.25、gptPro 0.2；20 条带 cache_ratio，
//   但 cache_creation 系字段（create_cache_ratio / cache_creation_5m/1h_ratio）一个都没有，缓存写入价落空。
//   按次只有 2 个模型（gpt-image-2.5-flare 0.03、gpt-image-2 0.05，都在 gptPro / gpt官Key 两组各占一行，共 4 行），没有图片端点标记。
//   www.mxwq.net 301 到主域，但同一 API 路径可用，两个都挂。
//   2026-11-25 复测：同一端点已涨到 137 行（模型数没变，是分组的可用面扩了），表里行数按线上实时算，95 是 11-24 的快照值。
//   OP（linux.do 2994872 / 3195702）：最低 0.1 倍率、主推 0.2 稳定不降智分组，回帖送 $5 体验额度。
// 报文形状归到 allrouter 基座，站点差异只有基座选择、ratioBase 与充值口径。
const PRICE_MAP = { base: "allrouter" };

const HOSTS = ["mxwq.net","www.mxwq.net"];
const PATHS = ["/", "/pricing", "/console", "/console/topup", "/topup"];

const preset = {
  id: "yuedian",
  name: "跃点 API",
  baseUrl: "https://mxwq.net/",
  rechargeRmb: 1,
  rechargeCredits: 1,
  rechargeRateVerified: false,
  rechargeRateNote: "站点 /api/status：price = 1、quota_per_unit = 500000、quota_display_type = USD、usd_exchange_rate = 7.3，按 New API 口径是 ¥1 = 1 美元额度，usd_exchange_rate 只用于把额度折成人民币显示。没有 bulk_topup_discounts、没有 pay_methods；充值端点匿名全部非 200，档位表读不到。只读配置没付款，rechargeRateVerified 为 false。",
  priceCurrency: "USD",
  priceCurrencyVerified: false,
  priceCurrencyNote: "报价 = billing_expr 求值结果 × 分组倍率（0.2–1），表达式口径是美元/百万；其余 2 个是 quota_type 1 的按张模型（gpt-image-2.5-flare 0.03 / gpt-image-2 0.05，各占两组共 4 行）。",
  enabled: true,
  mode: "direct",
  auth: { type: "none" },
  adapter: { kind: "declarative", endpoint: PRICING_ENDPOINT, method: "GET", responseFormat: "price-map", priceMap: PRICE_MAP }
};

const pluginSource = {
  id: "yuedian",
  host: "mxwq.net",
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
  rationale: "跃点 API 的 /api/pricing 匿名可读，22 个模型 95 条价目与分组倍率都不需要登录",
  request: requestPolicy(() => PRICING_ENDPOINT, { credentials: "omit" })
};

const MODEL_ALIASES = [];

export const sitePlugin = { ...pluginSource, modelAliases: MODEL_ALIASES };
