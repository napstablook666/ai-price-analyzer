// 由 scripts/plugin-build.mjs 从 plugins/ 生成，不要手改。重新生成：node scripts/plugin-build.mjs

import { DEFAULT_PRICING_ENDPOINT as PRICING_ENDPOINT, requestPolicy } from "../../core/provider-registry.js";

// 站点画像（2026-11-24 实测，匿名直连 /api/pricing，不需要登录）：
//   title 是「BitwisePlus｜面向 AI 编程工具的 GPT 接入站」，system_name = BitwisePlus，register_enabled = true。
//   16 个模型里 5 个是出图（gpt-image-2.6 / 2.6-sunburst / 2.6-flare / 2.5-sunburst / 2.5-flare），走 model_price 0.2/张 + image-generation 端点；
//   其余 11 个带 billing_expr，写法是 len <= 272000 长短分档，并且这批里只有它把 12 小时缓存写进表达式（cc12h 变量）。
//   3 个分组：sale 0.1（usable_group 注明「编程模型，倍率随行情调整」）、default 0.2、image 0.2。
//   2026-11-28 复查（站点体检报 structure-changed）：那 5 个出图模型已全部下线，/api/pricing 现在只返回 11 个模型，
//   全部走 billing_expr，model_price 一律为 0。usable_group 里还留着 image「生图模型（按次计费）」的定义，
//   但没有任何模型挂在它下面，分组倍率一度出现的 default / sale / image 现在是 default / sale / vip。
//   结论：不是解析漏字段，是站点真的撤了按次计费，出图那一档不用再维护。
//   OP（linux.do 3204681）写得很明确：¥1 = $1 站内额度，实际价格 = 模型美元标价 × 分组倍率，没有二次汇率折算，
//   并给了复算例子（sale 组 gpt-6.2-sol 标价 2/10 → 实付 ¥0.2/1）。
//   冲突点：/api/status 的 price = 7.3 说的是 ¥7.3 = 1 美元额度，与 OP 自述的 ¥1 = $1 差 7.3 倍。
//   按 pricing-evidence 的口径，站点自述优先于报文默认值，且 OP 给了可复算的实付例子，所以取 ¥1 = $1；
//   同时把 rechargeAuto 关掉，避免采集到的 price=7.3 覆盖这个判断。
// 报文形状归到 allrouter 基座，站点差异只有基座选择、ratioBase 与充值口径。
const PRICE_MAP = { base: "allrouter" };

const HOSTS = ["bitwiseplus.cc"];
const PATHS = ["/", "/pricing", "/console", "/console/topup", "/topup"];

const preset = {
  id: "bitwiseplus",
  name: "BitwisePlus",
  baseUrl: "https://bitwiseplus.cc/",
  rechargeAuto: false,
  rechargeRmb: 1,
  rechargeCredits: 1,
  rechargeRateVerified: false,
  rechargeRateNote: "站点自述优先：OP（linux.do 3204681）写明「额度换算：¥1 = $1 站内额度」「实际价格 = 模型美元标价 × 分组倍率，没有汇率二次折算」，并给出 sale 组 gpt-6.2-sol 标价 2/10 实付 ¥0.2/1 的复算例子。/api/status 里 price = 7.3、quota_per_unit = 500000、quota_display_type = CNY、usd_exchange_rate = 1，按 New API 默认口径读是 ¥7.3 = 1 美元额度，与自述冲突，故凑不齐三证，取自述并在插件里关掉自动采集（rechargeAuto: false）。没有 bulk_topup_discounts、没有 pay_methods；充值端点匿名全部非 200；只读配置没付款，rechargeRateVerified 为 false。",
  priceCurrency: "USD",
  priceCurrencyVerified: false,
  priceCurrencyNote: "报价 = billing_expr 求值 × 分组倍率（sale 0.1 / default 0.2；image 组已无模型挂载，2026-11-28 起按次计费下线）；人民币按站内自述 ¥1 = $1 折算。",
  enabled: true,
  mode: "direct",
  auth: { type: "none" },
  adapter: { kind: "declarative", endpoint: PRICING_ENDPOINT, method: "GET", responseFormat: "price-map", priceMap: PRICE_MAP }
};

const pluginSource = {
  id: "bitwiseplus",
  host: "bitwiseplus.cc",
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
  rationale: "BitwisePlus 的 /api/pricing 匿名可读，16 个模型 54 条价目与分组倍率都不需要登录",
  request: requestPolicy(() => PRICING_ENDPOINT, { credentials: "omit" })
};

const MODEL_ALIASES = [];

export const sitePlugin = { ...pluginSource, modelAliases: MODEL_ALIASES };
