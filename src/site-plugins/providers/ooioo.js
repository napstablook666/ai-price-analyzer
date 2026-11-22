// 由 scripts/plugin-build.mjs 从 plugins/ 生成，不要手改。重新生成：node scripts/plugin-build.mjs

import { DEFAULT_PRICING_ENDPOINT, requestPolicy } from "../../core/provider-registry.js";

// 站点画像（2026-11-22 实测，全部匿名）：
//   ooioo 是 New API v1.1.12 的魔改版。/api/pricing 匿名 200，报文形状与 tokenflux 族站点
//   同源：data 数组 37 个模型，外加 group_ratio / usable_group / auto_groups /
//   supported_endpoint / vendors / pricing_version。
//   三条线路 ooioo.work（主线路-三网优化）、oo1oo.work（全球 CDN）、00i00.work（备用）
//   返回的 /api/pricing 与 /api/status 逐字节一致（md5 相同），共用一个插件。
//   计费：全站 quota_type=0、model_price=0，没有按次/按张/按秒，37 个模型全是按 token。
//   报文里有两套声明：16 个模型带 billing_expr（按上下文长度切 standard / long_context 两档，
//   系数 p/c/cr/cc 依次是输入/输出/缓存读/缓存写），21 个模型带 model_ratio +
//   completion_ratio + cache_ratio + create_cache_ratio。两套经 price-map 归一后都是
//   USD/百万 token。实测 glm-5.3-flash 归一出 $0.24 / $0.84 / $0.069，与渲染后的模型广场
//   页面逐字一致；104 行全部解析成功，没有算不出价的模型。
//   分组倍率公开：cc-business 2、cc-max 1.3、codex-business 0.4、codex-plus 0.08、
//   codex-pro 0.2、grok 0.2、国产模型-余额 0.3。enable_groups 里另有 codex-订阅、
//   国产模型-订阅 两个名字，group_ratio 没有对应键，不产生可比价行。
//   币种：quota_display_type=USD、usd_exchange_rate=1、price=1，报价是美元/百万 token；
//   引擎算出的 glm-5.3-flash 输入 $0.24 / 输出 $0.84 / 缓存 $0.069 与渲染后的模型广场
//   页面逐字一致。
//   充值：docs.ooioo.work《计费规则》「余额与订阅」一节写明「充值金额与余额 1:1」，与
//   /api/status 的 price=1、quota_display_type=USD 口径一致。档位与折扣要看
//   /console/topup 与 /api/user/topup/info，前者匿名 302 到 /sign-in、后者 401，未登录
//   核验，所以不列档位、不记折扣。stripe_unit_price=8 无旁证，不采信。
// 站点差异只有这一句：报文形状归到 tokenflux 基座。
const PRICE_MAP = { base: "tokenflux" };

const RECHARGE_NOTE =
  "公开证据：docs.ooioo.work《计费规则》「余额与订阅」写明「充值金额与余额 1:1」，" +
  "与 /api/status 的 price=1、quota_display_type=USD、usd_exchange_rate=1 三处口径一致，" +
  "故记 1 元 = 1 美元额度。充值档位与折扣要看 /console/topup 与 /api/user/topup/info，" +
  "匿名访问分别 302 到 /sign-in 与返回 401，未登录核验，所以不列档位、不记折扣；" +
  "本次没有创建订单或付款，第三方收银台实付与实际到账比例尚未核实。";

const preset = {
  id: "ooioo",
  name: "ooioo",
  baseUrl: "https://ooioo.work/pricing",
  rechargeAuto: false,
  rechargeRmb: 1,
  rechargeCredits: 1,
  rechargeRateVerified: true,
  rechargeRateNote: RECHARGE_NOTE,
  rechargePlansVerified: false,
  priceCurrency: "USD",
  priceCurrencyVerified: true,
  priceCurrencyNote:
    "报价是美元/百万 token：/api/status 的 quota_display_type=USD、usd_exchange_rate=1，" +
    "模型广场页面也标 $/1M；引擎算出的 glm-5.3-flash 输入 $0.24 / 输出 $0.84 / 缓存 $0.069 " +
    "与页面逐字一致。分组倍率取自公开的 /api/pricing，按站点的「倍率 × 官方价」口径折算。",
  enabled: true,
  mode: "direct",
  auth: { type: "none" },
  adapter: {
    kind: "declarative",
    endpoint: DEFAULT_PRICING_ENDPOINT,
    method: "GET",
    responseFormat: "price-map",
    priceMap: PRICE_MAP
  }
};

const pluginSource = {
  id: "ooioo",
  host: "ooioo.work",
  preservePriceCurrency: true,
  preserveRechargeRateVerification: true,
  preset,
  matches: ({ hostname, path }) =>
    ["ooioo.work", "oo1oo.work", "00i00.work"].includes(hostname) &&
    ["/", "/pricing", "/console/topup"].includes(path),
  prepareMatches: ({ hostname }) =>
    ["ooioo.work", "oo1oo.work", "00i00.work"].includes(hostname),
  prepare: (stationInput, { url }) => ({
    ...stationInput,
    baseUrl: `${url.origin}/pricing`,
    mode: "direct",
    auth: { type: "none" },
    adapter: {
      ...(stationInput.adapter || {}),
      kind: "declarative",
      endpoint: DEFAULT_PRICING_ENDPOINT,
      method: "GET",
      responseFormat: "price-map",
      priceMap: PRICE_MAP
    }
  }),
  mode: "direct",
  responseFormat: "price-map",
  authType: "none",
  rationale: "ooioo 的 /api/pricing 匿名可读，37 个模型、7 个分组、USD 报价都不需要登录；充值比例有公开文档，档位未核验所以不列",
  request: requestPolicy(() => DEFAULT_PRICING_ENDPOINT, { credentials: "omit" })
};

const MODEL_ALIASES = [];

export const sitePlugin = { ...pluginSource, modelAliases: MODEL_ALIASES };
