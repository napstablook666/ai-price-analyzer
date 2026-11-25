// 由 scripts/plugin-build.mjs 从 plugins/ 生成，不要手改。重新生成：node scripts/plugin-build.mjs

import { DEFAULT_PRICING_ENDPOINT as PRICING_ENDPOINT, requestPolicy } from "../../core/provider-registry.js";

// 站点画像（2026-11-24 实测，匿名直连 /api/pricing，不需要登录）：
//   title 与 system_name 都是「深龙 AI - 连接你的模型入口」，register_enabled = true，无 Turnstile。
//   18 个模型、9 个分组全是渠道名：Plus号池低价通道 0.12、国模官方直连 0.2、Pro号池稳定通道 0.3、
//   Gemini Pro反重力 0.35、CC官方渠道 0.45、Gemini官方直连 0.5、DeepSeek官方直连 1.5、GPT官方直连 1.5、智谱特惠折扣 0.08。
//   13 个模型带 billing_expr，这批里分档写法最杂：len < 272000 与 len <= 272000 两种写法混用，档名有 standard / long_context、
//   短上下文 / 长上下文、≤272K / >272K 三套命名，值一样但名字不统一，映射引擎按 tier 名照收，所以同一模型会出现两组「档」行。
//   另有 1 个模型（deepseek-v4-1-flash-1017）是多语句表达式：let 拼出时区 / 日期 / 星期 / 小时 / 一份 2026 年节假日表，
//   工作日且非节假日 9–12 与 14–18 点走 tier("高峰")，其余走 tier("空闲")——分时档不只 orbitix 一家有。
//   7 条带 cache_ratio，cache_creation 系字段全无；没有按次、没有图片端点。
//   www 与主域都能直连 /api/pricing（都是 18 行），两个都挂。
//   OP（linux.do 3153976）：双十一（截止 11-11 23:59）充值加赠 50%。
// 报文形状归到 allrouter 基座，站点差异只有基座选择、ratioBase 与充值口径。
const PRICE_MAP = { base: "allrouter" };

const HOSTS = ["shenlongapi.com","www.shenlongapi.com"];
const PATHS = ["/", "/pricing", "/console", "/console/topup", "/topup"];

const preset = {
  id: "shenlong",
  name: "深龙 AI",
  baseUrl: "https://shenlongapi.com/",
  rechargeRmb: 6.8,
  rechargeCredits: 1,
  rechargeRateVerified: false,
  rechargeRateNote: "站点 /api/status：price = 6.8、quota_per_unit = 500000、quota_display_type = USD、usd_exchange_rate = 1、payment_currency = CNY、price_packages_enabled = true，即 ¥6.8 = 1 美元额度。OP 写了活动档位：$10 面额实付 ¥68 到账 $15、$20 实付 ¥136 到账 $30、$50 实付 ¥340 到账 $75、$100 实付 ¥680 到账 $150（6.7 折），首充另有 9/8.5/8 折且与加赠同享（$100 档实付 ¥544 到账 $150）；活动截止 11-11 已过期，档位不写进插件。充值端点匿名全部非 200，当期档位读不到。没付款，rechargeRateVerified 为 false。",
  priceCurrency: "USD",
  priceCurrencyVerified: false,
  priceCurrencyNote: "报价 = billing_expr 求值 × 分组倍率（0.08–1.5）；4 个没有表达式的模型走 model_ratio × ratioBase(2) 再乘分组倍率；分时那个模型按抓取时刻求值（工作日非节假日 9–12 与 14–18 点抓到的是高峰价）。",
  enabled: true,
  mode: "direct",
  auth: { type: "none" },
  adapter: { kind: "declarative", endpoint: PRICING_ENDPOINT, method: "GET", responseFormat: "price-map", priceMap: PRICE_MAP }
};

const pluginSource = {
  id: "shenlong",
  host: "shenlongapi.com",
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
  rationale: "深龙 AI 的 /api/pricing 匿名可读，18 个模型 74 条价目与分组倍率都不需要登录",
  request: requestPolicy(() => PRICING_ENDPOINT, { credentials: "omit" })
};

const MODEL_ALIASES = [];

export const sitePlugin = { ...pluginSource, modelAliases: MODEL_ALIASES };
