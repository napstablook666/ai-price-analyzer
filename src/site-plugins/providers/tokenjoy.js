// 由 scripts/plugin-build.mjs 从 plugins/ 生成，不要手改。重新生成：node scripts/plugin-build.mjs

import { requestPolicy } from "../../core/provider-registry.js";

// 站点画像（2026-11-24 实测，匿名直连 /api/models，不需要登录）：
//   TokenJoy 不是 New API 派生站。报文顶层是
//   { available: 70, billing_mode: "token", cny_per_usd: 6.66, model_discount: {...已关闭}, models: [72 条], price_multiplier: 0.6 }。
//   每行的 model 自带渠道前缀（kiro-power/claude-sonnet-5-5），input / output / cache_read / cache_write 就是
//   「实付美元额度 / 百万 token」，已经乘过站点给每个模型定的 multiplier（72 行 input = usd_input × multiplier 全成立，
//   官方美元价在 usd_input/usd_output 里，表里不用它）。
//   计价口径：站点定价页与前端文案明写「1 元人民币买 1 美元额度」，前端也是把接口里的 input 原值直接按 ¥ 渲染，
//   所以 1 美元额度 = 1 元，没有汇率加成；cny_per_usd 6.66 只用来把官方美元价换算成 ¥ 展示。
//   分组 = 渠道，价格已按渠道单独定好，分组倍率一律 1；同一模型在 official / cuosor / kiro-power 三个渠道各出一行，
//   正好可以直接比渠道价（claude-opus-5-5 在 official 是 $4，在 cuosor 是 $2.4）。
//   72 行里 2 行 known=false 且 in/out 全 0（cuosor/claude-sonnet-4、anthropic/claude-sonnet-4），
//   是「官方价未收录」的占位，不是免费，走 unsupported 进未决而不是报 0 元。
//   /api/pricing、/api/status、/api/v1/models、/api/public/models 全 404 或空串，只有 /api/models 有价。
//   price_multiplier 0.6 是「充值越多折扣越深、最高再省 40%」的封顶系数，不参与单价。
const MODELS_ENDPOINT = "/api/models";

const PRICE_MAP = {
  schemaVersion: "price-map/1",
  source: "tokenjoy",
  rootPath: "/models",
  nameField: "model",
  labelField: "model",
  currency: "USD",
  // 渠道自带价，不乘任何分组倍率：groups 只声明分组名，报文里没有 /group_ratio。
  groups: { listPath: "channel" },
  rules: [
    {
      when: { path: "known", equals: false },
      kind: "unsupported",
      reason: "站点未收录该模型的官方价（known=false），报的 0 是占位不是免费"
    },
    {
      kind: "token",
      input: "input",
      output: "output",
      cacheRead: "cache_read",
      cacheWrite: "cache_write",
      tierName: "按量"
    }
  ]
};

const HOSTS = ["tokenjoy.org", "www.tokenjoy.org"];
const PATHS = ["/", "/models", "/pricing", "/docs", "/console", "/models/"];

const preset = {
  id: "tokenjoy",
  name: "TokenJoy",
  baseUrl: "https://tokenjoy.org/",
  rechargeRmb: 1,
  rechargeCredits: 1,
  rechargeRateVerified: false,
  rechargeRateNote: "站点定价页与前端文案明写「1 元人民币买 1 美元额度，失败的请求不扣费，没有月费和最低消费」，前端把接口里的 input 原值直接按 ¥ 渲染（paid 与 official 是两套：official 用 cny_per_usd 6.66 折算成 ¥，paid 原值不变）。另外文案写着「充值额度越大折扣越深，最高再省 40%」，报文 price_multiplier 0.6 就是这个封顶系数，但大额充值档位表要登录才给，没读到具体折扣，所以 rechargeRateVerified 为 false。",
  priceCurrency: "USD",
  priceCurrencyVerified: true,
  priceCurrencyNote: "报价取 /api/models 的 input / output / cache_read / cache_write，单位是美元额度每百万 token，已含站点为每个模型定的 multiplier。官方美元价在 usd_input / usd_output，比实付价高（例如 kiro-power/claude-sonnet-5-5 官方 $2 / 实付 $1.6），这里一律用实付价。",
  enabled: true,
  mode: "direct",
  auth: { type: "none" },
  adapter: { kind: "declarative", endpoint: MODELS_ENDPOINT, method: "GET", responseFormat: "price-map", priceMap: PRICE_MAP }
};

const pluginSource = {
  id: "tokenjoy",
  host: "tokenjoy.org",
  preset,
  matches: ({ hostname, path }) => HOSTS.includes(hostname) && PATHS.includes(path),
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
  rationale: "TokenJoy 的 /api/models 匿名可读，72 个模型按 4 个渠道给出实付价与缓存价，不需要登录",
  request: requestPolicy(() => MODELS_ENDPOINT, { credentials: "omit" })
};

const MODEL_ALIASES = [];

export const sitePlugin = { ...pluginSource, modelAliases: MODEL_ALIASES };
