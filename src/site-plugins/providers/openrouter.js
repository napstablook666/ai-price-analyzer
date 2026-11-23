// 由 scripts/plugin-build.mjs 从 plugins/ 生成，不要手改。重新生成：node scripts/plugin-build.mjs

import { requestPolicy } from "../../core/provider-registry.js";

// OpenRouter 取证（2026-11-23，匿名直连）：
//   /api/v1/models 不带 cookie 返回 200、927 044 字节、477 个条目，不需要登录。
//   站点本身就是「基准站」的来源（src/core/openrouter.js 拿同一份报文做参照价），
//   所以这里刻意复用它的身份口径：模型身份用 id（openai/gpt-6.2-astra），显示名用 name。
//   两处对不齐会让同一模型在比价表里出现两行。
const MODELS_ENDPOINT = "/api/v1/models";

// 报文里 pricing 的单位是「美元 / token」，四舍五入到 1e-8 美元；
// 乘 1e6 换成项目统一的「美元 / 百万 token」。
const PER_MILLION = 1_000_000;

// 站点差异全在数据形状上，用映射声明，不写 strategy 类。
// rootPath /data：报文是 { data: [...] }。
// nameField id / labelField name：和参照价同一套身份（见文件头）。
// 基础价落 pricing.prompt/completion；decodeModels 会把 pricing.overrides 摊成 pricing.tiers，
// 于是上下文长度分档跟别的站点一样出多行，由 pricing 层按单次请求长度选一档。
const PRICE_MAP = {
  schemaVersion: "price-map/1",
  source: "openrouter",
  rootPath: "/data",
  nameField: "id",
  labelField: "name",
  currency: "USD",
  // 报文里没有分组概念，全部按官方价一条价挂一个占位分组。
  groups: { unlisted: "官方价" },
  rules: [
    {
      kind: "token",
      input: `pricing.prompt * ${PER_MILLION}`,
      output: `pricing.completion * ${PER_MILLION}`,
      cacheRead: `pricing.input_cache_read * ${PER_MILLION}`,
      cacheWrite: `pricing.input_cache_write * ${PER_MILLION}`,
      cacheWrite1h: `pricing.input_cache_write_1h * ${PER_MILLION}`,
      tiers: {
        path: "pricing.tiers",
        minField: "min_tokens",
        maxField: "max_tokens",
        input: `prompt * ${PER_MILLION}`,
        output: `completion * ${PER_MILLION}`,
        cacheRead: `input_cache_read * ${PER_MILLION}`,
        cacheWrite: `input_cache_write * ${PER_MILLION}`,
        cacheWrite1h: `input_cache_write_1h * ${PER_MILLION}`
      }
    }
  ]
};

const TIER_FIELDS = ["prompt", "completion", "input_cache_read", "input_cache_write", "input_cache_write_1h"];

function tierEntry(source, minTokens) {
  const entry = minTokens > 0 ? { min_tokens: minTokens } : { min_tokens: 0 };
  for (const field of TIER_FIELDS) {
    const value = Number(source?.[field]);
    if (Number.isFinite(value)) entry[field] = value;
  }
  return entry;
}

// 三件事，都在归一之前做完：
// 1. 浮动别名（~vendor/x-latest、alias_target 指向同列表里的正式条目的那些）不单独出价，
//    否则同一模型会有十几行「某个拼写」的价，和参照价对不上。
// 2. prompt 与 completion 都不大于 0 的条目丢掉：15 个 `:free` 变体是 0 价，
//    8 个 openrouter/auto 一类路由占位报 -1（没有单价），进比价表只会变成 0 元或脏数据。
// 3. pricing.overrides 是「加价档」，两种形状：
//    - 带 min_prompt_tokens 的是上下文长度档，摊成 pricing.tiers，第一档就是基础价；
//    - 带 utc_start / utc_end / utc_days 的是时段档（只有 3 个模型、10 条），
//      token 规则表达不了时段条件，按已知缺口跳过，基础价照常出。
//      详见 docs/openrouter-research.md。
const decodeModels = payload => {
  const list = Array.isArray(payload?.data) ? payload.data : [];
  const data = [];
  for (const model of list) {
    if (!model || typeof model !== "object") continue;
    if (model.alias_target) continue;
    const pricing = { ...(model.pricing || {}) };
    if (!(Number(pricing.prompt) > 0) && !(Number(pricing.completion) > 0)) continue;
    const overrides = Array.isArray(pricing.overrides) ? pricing.overrides : [];
    if (overrides.length) {
      // 长度档只给 min_prompt_tokens 这个下限，不给上限。
      // 不补 max_tokens 的话每档都是 [min, +∞)，pricing 层按单次长度选档时全都命中，
      // 同一模型会在表里出好几行。相邻两档之间用下一档的下限做开区间上界。
      const tiers = [tierEntry(pricing, 0)];
      for (const override of overrides) {
        if (!override || typeof override !== "object") continue;
        const min = Number(override.min_prompt_tokens);
        if (!Number.isFinite(min) || min <= 0) continue;
        tiers.push(tierEntry({ ...pricing, ...override }, min));
      }
      tiers.sort((left, right) => left.min_tokens - right.min_tokens);
      for (let index = 0; index < tiers.length - 1; index++) {
        tiers[index].max_tokens = tiers[index + 1].min_tokens;
      }
      pricing.tiers = tiers;
    }
    data.push({ ...model, pricing });
  }
  return { ...payload, data };
};

// 充值口径（2026-11-23 登录实测，workflow：settings/credits → Buy Credits）：
//   信用卡（Stripe）：$10 → 手续费 $0.80、实付 $10.80；$100 → 手续费 $5.50、实付 $105.50。
//   页面自述是 5.5%（最低 $0.80），两档都对得上。
//   加密：$10 → 实付 $10.50；$100 → 实付 $105。固定 5%、无最低手续费，是更便宜的一条路。
//   起充 $10（输 5/6/7 报 Invalid amount，输 10 正常）。
//   余额币种就是美元（Total available 显示 $），1 额度 = $1，没有赠送档位。
// 折算：最便宜路径是加密 $10 档，$1 额度实付 $1.05。
// 项目里 priceCurrency 为 USD 的站点按 rechargeRate 当「1 美元的元价」（pricing.currencyToRmb），
// 所以这里按扩展默认汇率 7.3 折成人民币：1.05 × 7.3 = 7.665 元 / 美元额度。
// 汇率变了要跟着调（设置页汇率只影响展示换算，不动这里存的值）。
const USD_CNY = 7.3;
const CRYPTO_FEE = 1.05;
const CREDIT_RMB = Number((CRYPTO_FEE * USD_CNY).toFixed(3));

const preset = {
  id: "openrouter",
  name: "OpenRouter",
  baseUrl: "https://openrouter.ai/models",
  enabled: true,
  mode: "direct",
  auth: { type: "none" },
  rechargeAuto: false,
  rechargeCurrency: "CNY",
  rechargeRmb: CREDIT_RMB,
  rechargeCredits: 1,
  rechargeRateVerified: true,
  rechargeRateNote:
    `2026-11-23 登录实测收银台：信用卡 $10 → 手续费 $0.80、实付 $10.80；$100 → 手续费 $5.50、实付 $105.50（页面自述 5.5%，最低 $0.80）。`
    + `加密支付固定 5% 无最低：$10 → $10.50、$100 → $105。起充 $10，无赠送档位，1 额度 = 1 美元。`
    + `取最便宜路径 $1 额度实付 $1.05，按扩展默认汇率 7.3 折 ${CREDIT_RMB} 元 / 美元额度。`,
  rechargePayments: [
    {
      channel: "crypto",
      faceAmount: 10,
      payAmount: 10.5,
      currency: "USD",
      paidRmb: Number((10.5 * USD_CNY).toFixed(2)),
      feeRate: 0.05,
      at: "2026-11-23",
      note: "加密支付 $10 → Total due $10.5，固定 5%、无最低手续费。另有 $100 → $105 同比例档。",
    },
    {
      channel: "stripe",
      faceAmount: 10,
      payAmount: 10.8,
      currency: "USD",
      paidRmb: Number((10.8 * USD_CNY).toFixed(2)),
      feeRate: 0.08,
      at: "2026-11-23",
      note: "信用卡 $10 档：手续费 $0.80 触底（8%），实付 $10.80。",
    },
    {
      channel: "stripe",
      faceAmount: 100,
      payAmount: 105.5,
      currency: "USD",
      paidRmb: Number((105.5 * USD_CNY).toFixed(2)),
      feeRate: 0.055,
      at: "2026-11-23",
      note: "信用卡 $100 档：手续费 $5.50，实付 $105.50，等于页面自述的 5.5%。",
    },
  ],
  rechargePaymentsVerified: true,
  // 只有一次性充值，没有订阅套餐。
  rechargePlans: [],
  priceCurrency: "USD",
  priceCurrencyVerified: true,
  priceCurrencyNote: "/api/v1/models 的 pricing 是「美元 / token」，乘 1e6 换成美元 / 百万 token；余额与标价都是美元，1 额度 = $1。",
  adapter: {
    kind: "declarative",
    endpoint: MODELS_ENDPOINT,
    method: "GET",
    responseFormat: "price-map",
    priceMap: PRICE_MAP,
  },
};

const pluginSource = {
  id: "openrouter",
  host: "openrouter.ai",
  matches: ({ hostname }) => hostname === "openrouter.ai" || hostname === "www.openrouter.ai",
  prepare: stationInput => ({
    ...stationInput,
    baseUrl: "https://openrouter.ai/models",
    mode: "direct",
    auth: { type: "none" },
    adapter: {
      ...(stationInput.adapter || {}),
      kind: "declarative",
      endpoint: MODELS_ENDPOINT,
      method: "GET",
      responseFormat: "price-map",
      priceMap: PRICE_MAP,
    },
  }),
  mode: "direct",
  responseFormat: "price-map",
  authType: "none",
  preservePriceCurrency: true,
  preserveRechargeRateVerification: true,
  rationale: "官方聚合站，/api/v1/models 匿名可读，直连采集全量价目与分档价",
  preset,
  request: requestPolicy(() => MODELS_ENDPOINT, { credentials: "omit", decodeResponse: decodeModels }),
};

const MODEL_ALIASES = [];

export const sitePlugin = { ...pluginSource, modelAliases: MODEL_ALIASES };
