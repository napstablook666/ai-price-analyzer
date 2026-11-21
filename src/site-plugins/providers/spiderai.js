// 由 scripts/plugin-build.mjs 从 plugins/ 生成，不要手改。重新生成：node scripts/plugin-build.mjs

import { requestPolicy } from "../../core/provider-registry.js";

const PAYMENT_MULTIPLIER = 0.149752;
const RECHARGE_BONUS = 0.05;
const PAYMENT_RATE = 1 / (PAYMENT_MULTIPLIER * (1 + RECHARGE_BONUS));
const own = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);
const finitePrice = value => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
const roundMoney = value => Math.round((value + Number.EPSILON) * 100) / 100;
const COLUMNS = { input: "inputUsd", output: "outputUsd", cacheRead: "cacheReadUsd", cacheWrite: "cacheCreateUsd" };
const tokenPrices = {
  input: "input", output: "output", cacheRead: "cacheRead", cacheWrite: "cacheWrite", imageOutput: "imageOutput"
};
const PRICE_MAP = {
  schemaVersion: "price-map/1",
  source: "spiderai-public-page",
  rootPath: "/data",
  nameField: "name",
  currency: "USD",
  ratioBase: 1,
  groups: { lookupPath: "/groups", keyPath: "id", refPath: "group_id", namePath: "name", ratio: [{ path: "rate" }] },
  rules: [
    { when: { path: "billing_expr", present: true }, kind: "expression", exprPath: "billing_expr" },
    {
      when: { path: "media_type", equals: "image" }, kind: "request", unit: "image", mediaType: "image",
      sizeTiers: { path: "sizes", nameField: "name", priceField: "price" }
    },
    {
      when: { path: "media_type", equals: "video" }, kind: "request", unit: "second", mediaType: "video",
      sizeTiers: { path: "sizes", nameField: "name", priceField: "price" }
    },
    {
      kind: "token", ...tokenPrices,
      tiers: { path: "tiers", nameField: "name", minField: "min", maxField: "max", ...tokenPrices }
    }
  ]
};

function parsePricingPage(html) {
  if (typeof html !== "string" || html.length > 4_000_000) throw new Error("SpiderAI pricing response is not a bounded HTML document");
  const match = html.match(/\bconst PX_DATA=(\{[^\r\n]*\});/);
  if (!match) throw new Error("SpiderAI PX_DATA catalogue marker not found");
  const data = JSON.parse(match[1]);
  if (!Array.isArray(data.catalog) || !data.catalog.length || !Array.isArray(data.groups) || !data.usd?.rates || !data.usd?.media) {
    throw new Error("SpiderAI PX_DATA is missing the active USD catalogue");
  }
  return data;
}

function fixedModel(data, model) {
  return model ? { ...model, ...(data.usd.fixes?.[model.name] || {}) } : null;
}

function groupModels(data, product, group) {
  const name = group.original_name || "";
  if (name.includes("生图")) return [];
  const isMax = /claude\s*(?:max|官渠)/i.test(name);
  let models = (product.groupModels || product.models || []).map(model => fixedModel(data, model))
    .filter(model => !data.usd.hide?.includes(model.name) && (!model.enterpriseOnly || name.includes("企业")));
  if (product.id === "gemini" && name.includes("官方")) {
    models = models.filter(model => !["gemini-3-pro", "gemini-3-pro-preview", "gemini-3-flash", "gemini-3-flash-preview"].includes(model.name));
  }
  if (product.id === "claude") {
    if (/claude\s*plus/i.test(name)) models = models.filter(model => model.name !== "claude-haiku-4-5");
    if (!/claude\s*max/i.test(name) && !/claude\s*plus/i.test(name)) models = models.filter(model => model.name !== "claude-sonnet-5");
    if (!isMax) models = models.filter(model => !["claude-fable-5", "claude-fable-5-1"].includes(model.name));
    if (isMax) models.push(...[data.haiku55, data.fable52].filter(Boolean).map(model => fixedModel(data, model)));
  }
  if (product.id === "deepseek") {
    const major = /大厂直供|major provider access/i.test(name);
    if (!/官方|official|云厂商/i.test(name) && !major) models = models.filter(model => model.name !== "deepseek-flash");
    if (name.includes("官方直连") || major) models = models.filter(model => model.name !== "deepseek-v4-flash");
    if (major) {
      models = models.map(model => model.name === "deepseek-v4-pro"
        ? { ...model, ...fixedModel(data, data.dsPeak), name: model.name, periodPrices: undefined } : model);
      if (data.dsEconomy) models = models.flatMap(model => model.name === "deepseek-flash" ? [model, fixedModel(data, data.dsEconomy)] : [model]);
    }
  }
  return models;
}

// In the active USD layer, domestic CNY list numbers are the billing bases too.
// Explicit null means unquoted; it must not fall back to the old USD template.
function pricesOf(model) {
  return Object.fromEntries(Object.entries(COLUMNS).map(([column, usdKey]) => {
    const baseKey = column === "cacheWrite" ? "cacheCreate" : column;
    const value = own(model.channelBaseCny, baseKey) ? model.channelBaseCny[baseKey] : model[usdKey];
    return [column, finitePrice(value)];
  }));
}

function contextRows(data, product, model) {
  if (!model.contextPrices?.length) return pricesOf(model);
  const contextKey = { grok: "grokContexts", qwen: "qwenContexts", minimax: "minimaxContexts" }[product.id] || "contexts";
  const labels = model.contextTierLabels || data.usd.i18n?.zh?.[contextKey] || data.i18n?.zh?.[contextKey];
  const match = labels?.standard?.match(/([\d.]+)\s*([KM])?/i);
  if (!match) throw new Error(`SpiderAI context boundary missing: ${model.name}`);
  const boundary = Number(match[1]) * ({ K: 1000, M: 1_000_000 }[match[2]?.toUpperCase()] || 1);
  return { tiers: model.contextPrices.map(tier => ({
    name: labels[tier.id] || tier.id,
    min: tier.id === "long" ? boundary + 1 : 0,
    max: tier.id === "standard" ? boundary : null,
    ...pricesOf({ ...model, ...tier })
  })) };
}

const TIER_LABELS = { peak: "高峰时段", offPeak: "空闲时段" };

function tokenItem(data, product, model, groupId) {
  const item = { name: model.name, group_id: groupId };
  if (!model.periodPrices?.length) return { ...item, ...contextRows(data, product, model) };
  const branches = new Map(model.periodPrices.map(tier => {
    const prices = pricesOf({ ...model, ...tier });
    if (prices.input === null || prices.output === null) throw new Error(`SpiderAI period price missing: ${model.name}`);
    const terms = Object.entries({ p: prices.input, c: prices.output, cr: prices.cacheRead, cc: prices.cacheWrite })
      .filter(([, value]) => value !== null).map(([key, value]) => `${key} * ${value}`).join(" + ");
    // 档名会原样显示在对比表里，用页面上的说法，别让用户看到 peak/offPeak。
    return [tier.id, `tier("${TIER_LABELS[tier.id] || tier.id}", ${terms})`];
  }));
  if (branches.size !== 2 || !branches.has("peak") || !branches.has("offPeak")) throw new Error(`SpiderAI unsupported periods: ${model.name}`);
  const peak = 'weekday("Asia/Shanghai") >= 1 && weekday("Asia/Shanghai") <= 5 && ((hour("Asia/Shanghai") >= 9 && hour("Asia/Shanghai") < 12) || (hour("Asia/Shanghai") >= 14 && hour("Asia/Shanghai") < 18))';
  return { ...item, billing_expr: `${peak} ? ${branches.get("peak")} : ${branches.get("offPeak")}` };
}

function mediaItems(data, product, group) {
  const original = group.original_name || "";
  if (product.id === "codex" && /仅限codex/i.test(original)) return [];
  const media = [...(product.imagePrices || [])];
  for (const extra of data.usd.extraImages?.[product.id] || []) {
    const kind = extra.mediaKind || "image";
    if (media.some(row => row.modelId === extra.modelId && (row.mediaKind || "image") === kind) &&
        !media.some(row => row.modelId === extra.modelId && (row.mediaKind || "image") === kind && row.size === extra.size)) media.push(extra);
  }
  return media.filter(row => (!row.enterpriseOnly || original.includes("企业")) &&
    (!/官方|official/i.test(original) || row.mediaKind === "video")).map(row => {
    const price = finitePrice(data.usd.media[row.modelId]?.[row.size]);
    if (price === null) throw new Error(`SpiderAI USD media price missing: ${row.modelId} ${row.size}`);
    return { name: row.modelId, group_id: `${group.id}:media`, media_type: row.mediaKind === "video" ? "video" : "image", sizes: [{ name: row.size, price }] };
  });
}

function buildPricingPayload(data) {
  const groups = [];
  const rows = [];
  const groupRatio = {};
  for (const group of data.groups.filter(group => group.status !== "inactive")) {
    const rate = finitePrice(data.usd.rates[String(group.id)]);
    if (rate === null || rate === 0) throw new Error(`SpiderAI USD group rate missing: ${group.id}`);
    const product = data.catalog.find(product => product.platform === group.platform);
    if (!product) throw new Error(`SpiderAI product missing: ${group.platform}`);
    const name = data.usd.groupText?.[String(group.id)]?.zh?.name || group.name?.zh || group.original_name;
    groups.push({ id: String(group.id), name, rate });
    groupRatio[name] = rate;
    rows.push(...groupModels(data, product, group).map(model => tokenItem(data, product, model, String(group.id))));
    const media = mediaItems(data, product, group);
    if (media.length) {
      groups.push({ id: `${group.id}:media`, name, rate: 1 });
      rows.push(...media);
    }
  }
  if (!rows.length) throw new Error("SpiderAI active catalogue is empty");
  return { data: rows, groups, group_ratio: groupRatio };
}

const decodePricingResponse = html => buildPricingPayload(parsePricingPage(html));
const rechargeRateNote = "2026-11-21 登录核验：人民币充值 50–5000 元，后端 multiplier=0.149752，每笔加赠 5%，手续费 0。100 元基础到账 $14.98、赠送 $0.75、合计 $15.73。按未舍入系数折算每美元余额成本；比例为静态核验值，不随汇率自动更新。第三方收银台实付未核验。";
const preset = {
  id: "spiderai", name: "SpiderAI", baseUrl: "https://spiderai.fun/#prices", enabled: true,
  mode: "direct", auth: { type: "none" }, priceCurrency: "CREDITS", priceCurrencyVerified: true,
  priceCurrencyNote: "公开页面以 USD / 1M tokens、USD / 张及 USD / 秒标价；分组倍率只应用一次，媒体为独立绝对价。",
  rechargeCurrency: "CNY", rechargeRmb: PAYMENT_RATE, rechargeCredits: 1, rechargeRate: PAYMENT_RATE,
  rechargeRateVerified: true, rechargeRateNote, rechargeAuto: false,
  rechargePlans: [50, 100, 500, 1000, 1500, 2000, 3000, 5000].map(amount => {
    const base = roundMoney(amount * PAYMENT_MULTIPLIER);
    return { kind: "topup", amount, credits: roundMoney(base + roundMoney(base * RECHARGE_BONUS)), currency: "CNY",
      availability: "self_service", verified: true, note: "登录充值页快捷金额，含 5% 赠额；非订阅或阶梯折扣，第三方实付未核验。" };
  }),
  rechargePlansVerified: true, rechargePayments: [], rechargePaymentsVerified: false,
  adapter: { kind: "declarative", endpoint: "/", method: "GET", responseFormat: "price-map", priceMap: PRICE_MAP }
};

const pluginSource = {
  id: "spiderai", host: "spiderai.fun", mode: "direct", responseFormat: "price-map", authType: "none",
  preserveRechargeRateVerification: true,
  matches: ({ hostname }) => hostname === "spiderai.fun",
  prepare: (stationInput, { url }) => {
    const hasRate = ["rechargeRmb", "rechargeCredits", "rechargeRate"].some(key => stationInput[key] != null);
    const defaultRate = !hasRate || (stationInput.rechargeRate === PAYMENT_RATE && stationInput.rechargeRmb === PAYMENT_RATE && stationInput.rechargeCredits === 1);
    return {
      ...stationInput, baseUrl: url.origin, mode: "direct", auth: { type: "none" },
      priceCurrency: "CREDITS", priceCurrencyVerified: true,
      priceCurrencyNote: stationInput.priceCurrencyNote || preset.priceCurrencyNote,
      rechargeAuto: false, rechargeCurrency: stationInput.rechargeCurrency || "CNY",
      ...(!hasRate ? { rechargeRmb: PAYMENT_RATE, rechargeCredits: 1, rechargeRate: PAYMENT_RATE } : {}),
      rechargeRateVerified: stationInput.rechargeRateVerified ?? defaultRate,
      rechargeRateNote: stationInput.rechargeRateNote || (defaultRate ? rechargeRateNote : "用户自定义充值比例"),
      ...(stationInput.rechargePlans == null && defaultRate ? { rechargePlans: preset.rechargePlans, rechargePlansVerified: true } : {}),
      adapter: { ...(stationInput.adapter || {}), ...preset.adapter }
    };
  },
  preset,
  rationale: "匿名首页 HTML 提取当前美元目录；充值需登录，比例和快捷金额已核实，渠道实付未验证。",
  request: requestPolicy(() => "/", { credentials: "omit", decodeResponse: decodePricingResponse })
};

const MODEL_ALIASES = [
  {
    "alias": "deepseek-flash",
    "canonicalId": "deepseek-v4-1-flash"
  },
  {
    "alias": "deepseek-flash-economy",
    "canonicalId": "deepseek-v4-1-flash"
  },
  {
    "alias": "gemini-3-flash",
    "canonicalId": "gemini-3-flash-preview"
  },
  {
    "alias": "gemini-3.1-pro",
    "canonicalId": "gemini-3-1-pro-preview"
  },
  {
    "alias": "grok-4.20-0309-reasoning",
    "canonicalId": "grok-4-20"
  },
  {
    "alias": "grok-4.20-0309-non-reasoning",
    "canonicalId": "grok-4-20"
  },
  {
    "alias": "grok-4.20-multi-agent-0309",
    "canonicalId": "grok-4-20-multi-agent"
  },
  {
    "alias": "kimi-k3.1-pro-highspeed",
    "canonicalId": "kimi-k3-1-pro"
  }
];

export const sitePlugin = { ...pluginSource, modelAliases: MODEL_ALIASES };
