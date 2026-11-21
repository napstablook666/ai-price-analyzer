// 由 scripts/plugin-build.mjs 从 plugins/ 生成，不要手改。重新生成：node scripts/plugin-build.mjs

import { DEFAULT_PRICING_ENDPOINT, requestPolicy } from "../../core/provider-registry.js";
import { tokenfluxPriceMap } from "../../core/price-maps/tokenflux.js";

const LEGACY_RECHARGE_NOTE = "公开证据：PoloAPI 帮助文档《价格-充值-分组介绍》（管理员9个月前更新）明确写明充值1元人民币=1美元额度，并支持自定义金额；第三方于2026-08-21记录Stripe $10额度实扣¥10。按公开政策记1:1，status的price/stripe_unit_price仅作交叉检查，不单独作为到账证明。公开资料未列固定赠额档位；当前结算和档位仍未登录实测。";
const RECHARGE_NOTE = "2026-11-21 登录核验：帮助文档的充值1元人民币=1美元额度与当前报价一致；快捷金额200/500/1000/2000，discount={}，无阶梯折扣或充值赠额。50/70/200/500/1000/2000元报价均为等额金额，200元重复报价一致。支付宝最低50元，Stripe最低70元；订阅方案为空。仅核验站内报价，未创建订单或付款，第三方收银台实付与实际到账尚未核实。";
// 2026-11-21：匿名 /api/pricing 返回 468 模型、88 分组；/api/status 声明 requireAuth=false。
// 定价页标 $/1M；ratio=5 的 claude-fable-5 标 $10/1M，表达式系数也按每百万计。
// 不从 price=1、usd_exchange_rate=7.3 推断充值比；topup/info 与 amount 匿名均为 401。
const PRICE_MAP = {
  base: "tokenflux",
  source: "poloai",
  rules: [
    { when: { path: "billing_usage_schema.resolution", present: true }, kind: "unsupported", sourcePath: "billing_expr", reason: "Seedance 分辨率、参考视频与 token 用量联合计费暂不支持" },
    { when: { path: "billing_usage_schema.clips", present: true }, kind: "unsupported", sourcePath: "billing_usage_schema", reason: "歌曲或歌词按 clips 数量计价，暂不能当作每请求价格" },
    { when: { path: "special_prices", present: true }, kind: "unsupported", sourcePath: "special_prices", reason: "图片尺寸专项价格的计费单位尚未核实，暂不参与比价" },
    { when: { path: "text_model_price", present: true }, kind: "unsupported", sourcePath: "text_model_price", reason: "思考模式与普通模式分档暂不支持" },
    { when: { path: "model_name", equals: "gpt-6.1-terra" }, kind: "unsupported", sourcePath: "billing_expr", reason: "12h 缓存写入暂不支持" },
    { when: { path: "description", equals: "按秒计费，模型参数和请求格式同步gpt官方" }, kind: "request", price: "model_price", unit: "second", mediaType: "video" },
    { when: { path: "description", equals: "按输出图片数量计费，价格标价是单张图片的价格" }, kind: "request", price: "model_price", unit: "image", mediaType: "image" },
    ...tokenfluxPriceMap.rules
  ]
};

const preset = {
  id: "poloai",
  name: "PoloAPI",
  baseUrl: "https://poloai.top/pricing",
  enabled: true,
  mode: "direct",
  auth: { type: "none" },
  priceCurrency: "USD",
  priceCurrencyVerified: true,
  priceCurrencyNote: "公开标准价以美元额度标注，token价按每百万，分组倍率只乘一次；登录已核实充值比例1:1与等额快捷金额，第三方实付与到账尚未核验。Seedance视频用量、qwen-plus思考分档、12h缓存、Suno clips与图片专项档位暂不支持，均列入未解析清单，不回退到占位价。",
  rechargeAuto: false,
  rechargeRateVerified: true,
  rechargeRmb: 1,
  rechargeCredits: 1,
  rechargeRateNote: RECHARGE_NOTE,
  rechargePlans: [200, 500, 1000, 2000].map(amount => ({
    kind: "topup", amount, credits: amount, currency: "CNY", availability: "self_service", verified: true,
    note: "等额快捷金额，无阶梯赠额；支付宝最低50元、Stripe最低70元。站内报价已核验，渠道实付未核验。"
  })),
  rechargePlansVerified: true,
  rechargePaymentsVerified: false,
  adapter: { kind: "declarative", endpoint: DEFAULT_PRICING_ENDPOINT, method: "GET", responseFormat: "price-map", priceMap: PRICE_MAP }
};

const pluginSource = {
  id: "poloai",
  host: "poloai.top",
  preservePriceCurrency: true,
  preserveRechargeRateVerification: true,
  preset,
  matches: ({ hostname, path }) => hostname === "poloai.top" && ["/", "/pricing", "/wallet", "/console/topup"].includes(path),
  prepareMatches: ({ hostname }) => hostname === "poloai.top",
  prepare: (stationInput, { url }) => {
    const defaultRate = (stationInput.rechargeRmb == null || Number(stationInput.rechargeRmb) === 1) &&
      (stationInput.rechargeCredits == null || Number(stationInput.rechargeCredits) === 1) &&
      (stationInput.rechargeRate == null || Number(stationInput.rechargeRate) === 1) &&
      stationInput.rechargeCurrency !== "USD";
    const noCustomPlans = !stationInput.rechargeTiers?.length && !stationInput.rechargePlans?.length && !stationInput.rechargePayments?.length;
    const legacyPreset = defaultRate && noCustomPlans && stationInput.rechargeRateNote === LEGACY_RECHARGE_NOTE;
    const useDefaultPlans = legacyPreset || (defaultRate && noCustomPlans && stationInput.rechargePlans == null && stationInput.rechargePlansVerified == null);
    return {
      ...stationInput,
      baseUrl: `${url.origin}/pricing`,
      mode: "direct",
      auth: { type: "none" },
      priceCurrency: "USD",
      priceCurrencyVerified: true,
      priceCurrencyNote: legacyPreset ? preset.priceCurrencyNote : stationInput.priceCurrencyNote || preset.priceCurrencyNote,
      rechargeAuto: false,
      rechargeRateVerified: stationInput.rechargeRateVerified ?? defaultRate,
      rechargeRateNote: legacyPreset ? RECHARGE_NOTE : stationInput.rechargeRateNote || RECHARGE_NOTE,
      ...(useDefaultPlans ? { rechargePlans: preset.rechargePlans, rechargePlansVerified: true } : {}),
      rechargePaymentsVerified: stationInput.rechargePaymentsVerified ?? false,
      adapter: { ...(stationInput.adapter || {}), kind: "declarative", endpoint: DEFAULT_PRICING_ENDPOINT, method: "GET", responseFormat: "price-map", priceMap: PRICE_MAP }
    };
  },
  mode: "direct",
  responseFormat: "price-map",
  authType: "none",
  rationale: "公开报价匿名可读；登录已核实充值比例1:1和四个等额快捷金额，渠道实付尚未核验",
  request: requestPolicy(() => DEFAULT_PRICING_ENDPOINT, { credentials: "omit" })
};

const MODEL_ALIASES = [];

export const sitePlugin = { ...pluginSource, modelAliases: MODEL_ALIASES };
