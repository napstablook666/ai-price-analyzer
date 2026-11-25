// 由 scripts/plugin-build.mjs 从 plugins/ 生成，不要手改。重新生成：node scripts/plugin-build.mjs

import { DEFAULT_EXCHANGE_RATE } from "../../shared/schema.js";
import { requestPolicy } from "../../core/provider-registry.js";

// 站点画像（2026-11-24 实测，匿名直连 /api/public/models，不需要登录）：
//   SU8 Codes 是 Astro 单页 + /api/public/*，不是 New API 派生站。
//   data.models[34]，每个模型下面 channel_prices[]（34 个模型合计 68 条）是各渠道的价，渠道就是分组：
//   Codex / Codex官渠 / Codex-Pro / Azure / Claude / Kimi / Kimi官渠 / DeepSeek官渠 / UltraFast /
//   Volcengine / Zai官渠 / Zhipu / Image生图分组，共 13 个。
//   每个渠道给两份价：pay_as_you_go 是「官方价 × 该渠道倍率」的挂牌价，pay_as_you_go_effective 是站点自己说的到手价。
//   实测两者的倍率比恒为 1/6.72（paygo_effective_multiplier / paygo_multiplier），也就是余额额度按 6.72 折计费，
//   站点模型页写的「Best pay-as-you-go 92.5% off / landed discount」用的就是 effective 这一份，所以这里一律取 effective。
//   8 条按次：gpt-image-2.6-sunburst / 2.6-flare / 2.5-sunburst / 2.5-flare / gpt-image-2 在 Image生图分组与 Azure 下
//   billing_type = request、meter_unit = per_request，走 request_price（美元/张）。
//   套餐（package_matrix）比按量更便宜：Pro 套餐 $42.47/30 天、日额度 $7（现金率 0.2022/额度美元），
//   gpt-5.6-sol 输入按量到手 $0.476 而 Pro 套餐 $0.404、SU500 套餐 $0.064，但那要买固定日额度，所以主价仍用按量到手价。
//   货币是美元现金（Stripe 收 USD，套餐价也是 USD），人民币成本按汇率折算。
//   /api/pricing、/api/models、/api/status、/api/user/topup/info 全 404 或空串，只有 /api/public/models 与
//   /api/public/packages 有数据；/api/config 显示 Stripe 与 Turnstile 都开着、注册开放、支持 linux.do SSO。
const MODELS_ENDPOINT = "/api/public/models";

const PRICE_MAP = {
  schemaVersion: "price-map/1",
  source: "su8",
  rootPath: "/data/models",
  // 价格在 models[].channel_prices[] 里，渠道名才是分组名，模型名与显示名都从父对象取。
  expand: { itemsPath: "channel_prices", parentKey: "$parent" },
  nameField: "$parent.model_code",
  labelField: "$parent.display_name",
  currency: "USD",
  groups: { listPath: "channel_name" },
  rules: [
    {
      when: { path: "pay_as_you_go_effective.billing_type", equals: "request" },
      kind: "request",
      price: "pay_as_you_go_effective.request_price",
      unit: "image",
      mediaType: "image",
      tierName: "按张"
    },
    {
      kind: "token",
      input: "pay_as_you_go_effective.input_price",
      output: "pay_as_you_go_effective.output_price",
      cacheRead: "pay_as_you_go_effective.extra_price_json.cached_price",
      cacheWrite: "pay_as_you_go_effective.extra_price_json.cache_creation_price",
      tierName: "到手价"
    }
  ]
};

const HOSTS = ["www.su8.codes", "su8.codes"];
const PATHS = ["/", "/models", "/pricing", "/docs"];

const preset = {
  id: "su8",
  name: "SU8 Codes",
  baseUrl: "https://www.su8.codes/",
  rechargeRmb: DEFAULT_EXCHANGE_RATE,
  rechargeCurrency: "USD",
  rechargeCredits: 1,
  rechargeRateVerified: true,
  rechargeRateNote: "报价本身就是实付美元现金（Stripe 收 USD），所以人民币成本按汇率折算，用系统默认 7.3 而不是站内倍率。套餐是真折扣但形态不同：Pro $42.47 / 30 天、日额度 $7（42.47 ÷ 210 = 0.2022 现金/额度美元），SU500 $500 / 日额度 $125（0.1333），套餐额度按北京时间 0 点刷新、未用完可结转一天，所以主价仍用按量到手价，套餐档不混进比价行。",
  rechargePlansVerified: false,
  priceCurrency: "USD",
  priceCurrencyVerified: true,
  priceCurrencyNote: "报价取 channel_prices[].pay_as_you_go_effective，是站点自己标注的「landed / 到手价」美元每百万 token，已含渠道倍率与余额折扣（恒为挂牌价 × 1/6.72）。官方价在 official_base_price（例如 gpt-5.6-sol 官方 $4 / $20，Codex 渠道到手 $0.298 / $1.488）。8 条按张出图走 request_price，单位美元每张。",
  enabled: true,
  mode: "direct",
  auth: { type: "none" },
  adapter: { kind: "declarative", endpoint: MODELS_ENDPOINT, method: "GET", responseFormat: "price-map", priceMap: PRICE_MAP }
};

const pluginSource = {
  id: "su8",
  host: "www.su8.codes",
  preset,
  matches: ({ hostname, path }) => HOSTS.includes(hostname) &&
    (PATHS.includes(path) || path.startsWith("/model/")),
  prepareMatches: ({ hostname }) => HOSTS.includes(hostname),
  prepare: (stationInput, { url }) => ({
    ...stationInput,
    baseUrl: `${url.origin}/`,
    mode: "direct",
    auth: { type: "none" },
    adapter: { ...(stationInput.adapter || {}), kind: "declarative", endpoint: MODELS_ENDPOINT, method: "GET", responseFormat: "price-map", priceMap: PRICE_MAP }
  }),
  mode: "direct",
  responseFormat: "price-map",
  authType: "none",
  rationale: "SU8 Codes 的 /api/public/models 匿名可读（audience=guest），34 个模型按 13 个渠道给到手价，不需要登录",
  request: requestPolicy(() => MODELS_ENDPOINT, { credentials: "omit" })
};

const MODEL_ALIASES = [];

export const sitePlugin = { ...pluginSource, modelAliases: MODEL_ALIASES };
