// 由 scripts/plugin-build.mjs 从 plugins/ 生成，不要手改。重新生成：node scripts/plugin-build.mjs

import { DEFAULT_PRICING_ENDPOINT, requestPolicy } from "../../core/provider-registry.js";

// New AI 取证（2026-11-25，匿名直连 /api/pricing + /api/status，不需要登录）：
//   17 个模型，0 条 billing_expr、0 条按次，全部走纯 model_ratio，是这一批里唯一一个表达式为 0 的站。
//   报文形状带 RelayRouter 系字段（顶层有 time_discount、副键 _），分组只有 default 1 与 vip 1 两档，所以基座取 relayrouter。
//   倍率基准与基座一致：1 单位 = 2 美元/百万。k3 ratio 2 → $4/M、k3.1-pro 1.7 → $3.4/M、k3.1-pro-highspeed 3.5 → $7/M。
//   completion_ratio 全部是 1，也就是输入输出同价，这是报文原值，不是插件猜的。
//   顶层 time_discount 给 glm-5-turbo / glm-5.2 / glm-5.3 / glm-5.3-flash / glm-5.3-flashx / glm-5.4 挂了「高峰期 ×2.5」。
//     两个基座都不读这个字段，所以表里出的是非高峰价，高峰时段实际扣费要乘 2.5——这是映射的已知缺口，不是站点方言。
//   k3 / k3.1-pro / k3.1-pro-highspeed 是 Kimi K3 系列的站内简写，归到 kimi-k3 / kimi-k3-1-pro；
//     k3-256k 是同模型的长上下文档，价不同（$2/M），不并进来。glm-5.4 在规范表里还没有对应 id，不给别名。
//   FAQ 是站长的运营问答（省 token 技巧、号池规模），没有充值档位。

const PRICE_MAP = { base: "relayrouter" };

const HOSTS = ["ai.deadlion.cn"];
const PATHS = ["/","/pricing","/console/topup"];

const preset = {
  id: "deadlion",
  name: "New AI",
  baseUrl: "https://ai.deadlion.cn/pricing",
  rechargeRmb: 7.3,
  rechargeCredits: 1,
  rechargeRateVerified: true,
  rechargeRateNote: "price = 7.3、usd_exchange_rate = 7.3，判定 1 美元额度 = ¥7.3。这家的额度口径与别家不同：quota_per_unit = 1000000、display_in_currency = false、额度按「积分/TOKENS」显示（1 美元额度 = 100 万积分），price 仍是「元 / 美元额度」，不跟着改成按积分算。",
  rechargePlansVerified: false,
  priceCurrency: "USD",
  priceCurrencyVerified: true,
  priceCurrencyNote: "报文里的倍率与 billing_expr 系数都是美元额度价，报价 = 官方价 × 分组倍率；price = 7.3、quota_per_unit = 1000000、quota_display_type = TOKENS、display_in_currency = false、custom_currency_symbol = 积分、usd_exchange_rate = 7.3。控制台按站点设置的币种显示额度，不影响这里的价格。",
  enabled: true,
  mode: "direct",
  auth: { type: "none" },
  adapter: { kind: "declarative", endpoint: DEFAULT_PRICING_ENDPOINT, method: "GET", responseFormat: "price-map", priceMap: PRICE_MAP }
};

const pluginSource = {
  id: "deadlion",
  host: "ai.deadlion.cn",
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
  rationale: "New AI 的 /api/pricing 匿名可读，17 个模型两档分组、纯倍率计价，充值口径取自 /api/status",
  request: requestPolicy(() => DEFAULT_PRICING_ENDPOINT, { credentials: "omit" })
};

const MODEL_ALIASES = [];

export const sitePlugin = { ...pluginSource, modelAliases: MODEL_ALIASES };
