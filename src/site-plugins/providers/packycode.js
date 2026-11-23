// 由 scripts/plugin-build.mjs 从 plugins/ 生成，不要手改。重新生成：node scripts/plugin-build.mjs

import { DEFAULT_PRICING_ENDPOINT, requestPolicy } from "../../core/provider-registry.js";

// packycode 取证（2026-11-23，匿名直连 /api/pricing，不需要登录）：
//   packycode.com 与 packyapi.com 是同一后端：/api/pricing 响应一致（28946 字节，catalog_version 同为 5808），
//   两个域名挂在同一个插件下。
//   本批第二家没有 billing_expr 的站（78 个模型里 13 个按次），全靠 model_ratio + completion_ratio 走 token 规则。
//   model_ratio 基准 1 单位 = 2 美元/百万（glm-5 = 2、qwen3.8-max = 6，与 kuaipao 同值）。
//   两处基座覆盖不到的字段：
//     1. tiers[] 长上下文档（15 个模型带，结构 {threshold, ratio}，如 qwen3.5-plus 128K 起 2.5 倍、256K 起 5 倍），
//        tokenflux 的 token 规则不读 tiers，所以这些模采到的是基础档价。
//     2. price_currency: "CNY" 写在模型条目里，与 /api/status 的美元额度口径冲突，按额度口径处理，不当人民币单价。
// 报文形状归到 tokenflux 基座，站点差异只有基座选择与充值口径。
const PRICE_MAP = { base: "tokenflux" };

const HOSTS = ["packycode.com","packyapi.com","www.packycode.com","www.packyapi.com"];
const PATHS = ["/","/pricing","/console/topup"];

const preset = {
  id: "packycode",
  name: "packycode",
  baseUrl: "https://packycode.com/pricing",
  rechargeAuto: false,
  rechargeRmb: 7,
  rechargeCredits: 1,
  rechargeRateVerified: true,
  rechargeRateNote: "站点 /api/status：price = 1、usd_exchange_rate = 7、custom_currency_exchange_rate = 7，判定 ¥7 = 1 美元额度。公告为空，收银台档位要登录，档位表留空。",
  priceCurrency: "CREDITS",
  priceCurrencyVerified: true,
  priceCurrencyNote: "额度计价，1 美元额度 = ¥7；报价 = 官方价 × 分组倍率（0.3–7）。",
  enabled: true,
  mode: "direct",
  auth: { type: "none" },
  adapter: { kind: "declarative", endpoint: DEFAULT_PRICING_ENDPOINT, method: "GET", responseFormat: "price-map", priceMap: PRICE_MAP }
};

const pluginSource = {
  id: "packycode",
  host: "packycode.com",
  preset,
  matches: ({ hostname, path }) => HOSTS.includes(hostname) && PATHS.includes(path),
  prepareMatches: ({ hostname }) => HOSTS.includes(hostname),
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
  rationale: "packycode 的 /api/pricing 匿名可读，78 个模型 25 个分组，充值口径按站点自报字段核过",
  request: requestPolicy(() => DEFAULT_PRICING_ENDPOINT, { credentials: "omit" })
};

const MODEL_ALIASES = [];

export const sitePlugin = { ...pluginSource, modelAliases: MODEL_ALIASES };
