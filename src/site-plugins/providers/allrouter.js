// 由 scripts/plugin-build.mjs 从 plugins/ 生成，不要手改。重新生成：node scripts/plugin-build.mjs

import { ALLROUTER_PRICING_ENDPOINT, requestPolicy } from "../../core/provider-registry.js";

// 站点画像（2026-11-18 实测）：
//   /api/pricing 匿名 200，报文是标准 tokenflux 形状：data 行数组 52 个模型，外加
//   group_ratio / usable_group / group_desc / auto_groups / supported_endpoint / vendors /
//   pricing_version。每条模型的 enable_groups 就是它真正在卖的分组，52 个模型共 102 条
//   「模型 × 分组」，全部落在 group_ratio 与 usable_group 的键上。
//   分组倍率是公开的：default 0.75（官方 API）、deepseek 0.4、gemini 0.45、glm 0.3、
//   gpt-azure-api 0.6、claude-official-api 0.65、gpt 0.053（自营 codex 号池）、
//   grok 0.045、claude-max 0.25、kimi 号池 0.06。站点计费口径 =「官方价 × 分组倍率」，
//   见 docs.allrouter.cc/billing：充值是 $1 = 10 credits，扣费按模型官方价乘分组倍率。
//   倍率口径：model_ratio 1 = $2/百万 token，与 billing_expr 里的美元系数对得上
//   （claude-opus-5-5 ratio 2 ↔ expr p*4；claude-haiku-4-5 ratio 0.5 ↔ 官方 $1/M），
//   所以倍率类要乘 2。
//   37 个模型把真实价写在 billing_expr 里，带长度分段（len <= 272000 之类）或分时条件
//   （DeepSeek 三个：工作日 9-12 点与 14-18 点走 peak，其余走 off_peak 半价），
//   这些以表达式为准，ratio 只是占位。全站没有 model_price > 0、也没有 quota_type = 1 的条目。
//   三个 gpt-image-2.5 的表达式是 p*5 + cr*1.25 + img*8 + c*30：img 系数按图片 token 计，
//   解析器不认，只报文本 token 价，按张的钱没有公开口径。
//   换掉 /api/ratio_config 的原因：那条路是 New API 的列式报文，486 个模型名里绝大多数是
//   出厂默认表、站点根本不卖，也没有任何分组信息，只能按白名单挑 49 个再加一个编出来的
//   「基准价」分组，界面上就出现了官网没有的分组名。/api/pricing 三样东西一起给了：
//   在售清单、分组、倍率。
//   充值：/api/status 里 price = 1（1 元 = 1 美元额度）、quota_per_unit = 500000、
//   custom_currency_symbol = "credits"、custom_currency_exchange_rate = 10，
//   也就是界面上的 10 credits = $1；赠送档位在 /api/user/topup/info，需要登录，没核实就不写。
// 站点差异只有这一句：报文形状归到 allrouter 基座（tokenflux 映射 + 图片端点规则）。
const PRICE_MAP = { base: "allrouter" };

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
  priceCurrencyNote: "报价是美元/百万 token，和站内 billing_expr 的美元系数一致；界面把额度折算成 credits 显示（10 credits = $1），不影响这里的价格。分组倍率取自公开的 /api/pricing：default 0.75、deepseek 0.4、gpt 0.053 等，按站点的「官方价 × 分组倍率」口径折算。",
  enabled: true,
  mode: "direct",
  auth: { type: "none" },
  adapter: { kind: "declarative", endpoint: ALLROUTER_PRICING_ENDPOINT, method: "GET", responseFormat: "price-map", priceMap: PRICE_MAP }
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
    adapter: { ...(stationInput.adapter || {}), kind: "declarative", endpoint: ALLROUTER_PRICING_ENDPOINT, method: "GET", responseFormat: "price-map", priceMap: PRICE_MAP }
  }),
  mode: "direct",
  responseFormat: "price-map",
  authType: "none",
  rationale: "AllRouter 的 /api/pricing 匿名可读，在售模型、分组倍率、充值口径都不需要登录",
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
