// 由 scripts/plugin-build.mjs 从 plugins/ 生成，不要手改。重新生成：node scripts/plugin-build.mjs

import { ALLROUTER_PRICING_ENDPOINT, requestPolicy } from "../../core/provider-registry.js";

// 站点画像（2026-11-18 实测）：
//   /api/ratio_config 匿名 200、约 43 KB，data 是 New API 的列式报文：model_ratio / completion_ratio /
//   cache_ratio / create_cache_ratio / model_price / billing_expr / billing_mode 七张「模型名 → 值」的表，
//   没有行数组，拼接在 normalizers.js 的 AllRouterPricingStrategy 里做。
//   ratio 表里 486 个模型名，绝大多数是 New API 出厂默认表，站点根本不卖；
//   真实在售清单只有 /api/user/models 有，且需要登录，所以插件按白名单采 49 个
//   default 分组的在售模型（清单在 price-maps/allrouter.js，站点上新模型时去改那里）。
//   倍率口径：model_ratio 1 = $2/百万 token，与 billing_expr 里的美元系数对得上
//   （claude-opus-5-5 ratio 2 ↔ expr p*4；claude-sonnet-5-5 ratio 1 ↔ expr p*2；
//   claude-haiku-4-5 ratio 0.5 ↔ 官方 $1/M），所以倍率类要乘 2。
//   27 个模型把真实价写在 billing_expr 里，带长度分段（len <= 272000 之类）或分时条件
//   （DeepSeek 三个：工作日 9-12 点与 14-18 点走 peak，其余走 off_peak 半价），
//   这些以表达式为准，ratio 只是占位。
//   三个 gpt-image-2.5 的表达式是 p*5 + img*8 + c*30：img 系数按图片 token 计，解析器不认，
//   只报文本 token 价，按张的钱没有公开口径。
//   充值：/api/status 里 price = 1（1 元 = 1 美元额度）、quota_per_unit = 500000、
//   custom_currency_symbol = "credits"、custom_currency_exchange_rate = 10，
//   也就是界面上的 10 credits = $1；赠送档位在 /api/user/topup/info，需要登录，没核实就不写。
//   分组倍率同样要登录（/api/user/groups 401），插件出的是基准价。
const preset = {
  id: "allrouter",
  name: "AllRouter",
  baseUrl: "https://allrouter.cc/console/topup",
  rechargeRmb: 1,
  rechargeCredits: 1,
  rechargeRateVerified: true,
  rechargeRateNote: "站点 /api/status：price = 1、quota_per_unit = 500000，1 元 = 1 美元额度；界面按 custom_currency_exchange_rate = 10 显示成 credits，10 credits = $1。大额充值的赠送档位要看 /api/user/topup/info，需要登录，本次没有核实，所以不列档位。",
  rechargePlansVerified: false,
  priceCurrency: "USD",
  priceCurrencyVerified: true,
  priceCurrencyNote: "报价是美元/百万 token，和站内 billing_expr 的美元系数一致；界面把额度折算成 credits 显示（10 credits = $1），不影响这里的价格。分组倍率要登录才看得到，插件报的是基准价。",
  enabled: true,
  mode: "direct",
  auth: { type: "none" },
  adapter: { kind: "tokenflux", endpoint: ALLROUTER_PRICING_ENDPOINT, method: "GET", responseFormat: "allrouter" }
};

const pluginSource = {
  id: "allrouter",
  host: "allrouter.cc",
  preset,
  matches: ({ hostname, path }) => ["allrouter.cc", "www.allrouter.cc"].includes(hostname) &&
    ["/", "/console", "/console/topup"].includes(path),
  prepareMatches: ({ hostname }) => ["allrouter.cc", "www.allrouter.cc"].includes(hostname),
  prepare: (stationInput, { url }) => ({
    ...stationInput,
    baseUrl: `${url.origin}/console/topup`,
    mode: "direct",
    auth: { type: "none" },
    adapter: { ...(stationInput.adapter || {}), kind: "tokenflux", endpoint: ALLROUTER_PRICING_ENDPOINT, method: "GET", responseFormat: "allrouter" }
  }),
  mode: "direct",
  responseFormat: "allrouter",
  authType: "none",
  rationale: "AllRouter 的 /api/ratio_config 匿名可读，公开定价和充值口径都不需要登录",
  request: requestPolicy(() => ALLROUTER_PRICING_ENDPOINT, { credentials: "omit" })
};

const MODEL_ALIASES = [
  {
    "alias": "claude-opus-5-5[1m]",
    "canonicalId": "claude-opus-5-5"
  },
  {
    "alias": "gpt-5.6-luna-openai-compact",
    "canonicalId": "gpt-5-6-luna"
  },
  {
    "alias": "gpt-5.6-sol-openai-compact",
    "canonicalId": "gpt-5-6-sol"
  },
  {
    "alias": "gpt-5.6-terra-openai-compact",
    "canonicalId": "gpt-5-6-terra"
  },
  {
    "alias": "gpt-6-astra-openai-compact",
    "canonicalId": "gpt-6-astra"
  },
  {
    "alias": "gpt-6-luna-openai-compact",
    "canonicalId": "gpt-6-luna"
  },
  {
    "alias": "gpt-6-sol-openai-compact",
    "canonicalId": "gpt-6-sol"
  },
  {
    "alias": "gpt-6.1-sol-openai-compact",
    "canonicalId": "gpt-6-1-sol"
  },
  {
    "alias": "gpt-6.1-terra-openai-compact",
    "canonicalId": "gpt-6-1-terra"
  },
  {
    "alias": "kimi-k3.1-pro-highspeed",
    "canonicalId": "kimi-k3-1-pro"
  }
];

export const sitePlugin = { ...pluginSource, modelAliases: MODEL_ALIASES };
