import { DEFAULT_PLUGIN_REGISTRY_URL, normalizeLocalPlugins, normalizeRegistryState } from "../core/declarative-plugin.js";
import { DEFAULT_UPDATE_CHANNEL, DEFAULT_UPDATE_INTERVAL_MINUTES, normalizeUpdateChannel, normalizeUpdateInterval } from "../core/update-check.js";
import { DEFAULT_MAGPIE_SYNC_INTERVAL_MINUTES, MAGPIE_USAGE_DEFAULT_BASE_URL, mergeGatewayUsage, normalizeMagpieBaseUrl, normalizeMagpieSyncInterval, normalizeMagpieSyncState } from "../core/magpie-usage.js";
import { migrateStationAdapter } from "../core/response-formats.js";
import { normalizeRechargePlans, normalizeRechargeTiers } from "./recharge-tiers.js";
import { normalizeRechargePayments } from "./recharge-payments.js";

export const OPENROUTER_URL = "https://openrouter.ai/api/v1/models";
export const OPENROUTER_IMAGES_URL = "https://openrouter.ai/api/v1/images/models";
export const BOC_EXCHANGE_URL = "https://www.boc.cn/sourcedb/whpj/";
export const DEFAULT_EXCHANGE_RATE = 7.3;
export const SYSTEM_BASE_PRICE_PER_1M = 2.0;

export function convertRechargeAmount(amount, fromCurrency, toCurrency, exchangeRate = DEFAULT_EXCHANGE_RATE) {
  const value = Number(amount);
  if (!Number.isFinite(value) || value < 0) return null;
  const configuredRate = Number(exchangeRate);
  const rate = Number.isFinite(configuredRate) && configuredRate > 0 ? configuredRate : DEFAULT_EXCHANGE_RATE;
  const rmb = value * (fromCurrency === "USD" ? rate : 1);
  return toCurrency === "USD" ? rmb / rate : rmb;
}

export const TOKENS_PER_MILLION = 1_000_000;

// 内置快照：还没同步过 magpie 时先用这组数，同步成功后换成网关实测值。
// 数据来自 pi session 2026-10-15 至 2026-11-14 汇总（magpie 网关日志 2026-11-03 才启用，覆盖不足 30 天）。
const BUILTIN_30D_MONTHLY_VOLUME = {
  requests: 54378,
  input: 326.81 * TOKENS_PER_MILLION,
  cacheRead: 4434.31 * TOKENS_PER_MILLION,
  output: 28.98 * TOKENS_PER_MILLION,
  cacheWrite: 1.91 * TOKENS_PER_MILLION,
  cacheWrite1h: 0,
};

export const DEFAULT_MONTHLY_USAGE = {
  ...BUILTIN_30D_MONTHLY_VOLUME,
  peakShare: 7 / 24,
  imageInputTokens: 0,
  imageOutputTokens: 0,
  imageTokens: 0,
  images: 0,
};

// magpie 预设的用量来自 settings.magpieSync（网关实测）；还没同步过就退回内置快照。
export function usagePresetUsage(id, magpieSync = null) {
  if (id === "baseline") return { ...DEFAULT_MONTHLY_USAGE, ...BASELINE_USAGE };
  if (id !== "recent30d") return null;
  return { ...DEFAULT_MONTHLY_USAGE, ...magpieSync?.recent30d?.usage };
}

export function usagePresetOptions(magpieSync = null) {
  const stamp = id => {
    const syncedAt = Number(magpieSync?.[id]?.syncedAt) || 0;
    if (!syncedAt) return "内置快照";
    const date = new Date(syncedAt);
    return `${date.getMonth() + 1} 月 ${date.getDate()} 日同步`;
  };
  return [
    { id: "recent30d", label: `magpie-30天（${stamp("recent30d")}）` },
    { id: "baseline", label: "基础估算（3000 万输入 / 600 万输出）" },
    { id: "custom", label: "自定义" },
  ];
}

const BASELINE_USAGE = { requests: 0, input: 30 * TOKENS_PER_MILLION, cacheRead: 0, output: 6_000_000, cacheWrite: 0, cacheWrite1h: 0, imageInputTokens: 0, imageOutputTokens: 0, imageTokens: 0, images: 0 };
// 判定口径只看这几个字段，高峰占比与图像用量不参与。
const USAGE_MATCH_FIELDS = ["requests", "input", "cacheRead", "cacheWrite", "cacheWrite1h", "output"];
// 退役预设只用于迁移，不再出现在可选口径中。
const LEGACY_USAGE_PROFILES = [
  { requests: 32567, input: 196.25 * TOKENS_PER_MILLION, cacheRead: 2077.49 * TOKENS_PER_MILLION, output: 20.03 * TOKENS_PER_MILLION, cacheWrite: 0.79 * TOKENS_PER_MILLION },
  { requests: 7900, input: 66.5 * TOKENS_PER_MILLION, cacheRead: 550.7 * TOKENS_PER_MILLION, output: 5.5 * TOKENS_PER_MILLION, cacheWrite: 0, imageTokens: 0, images: 0 },
  { requests: 44400, input: 372.6 * TOKENS_PER_MILLION, cacheRead: 2865.3 * TOKENS_PER_MILLION, output: 29.7 * TOKENS_PER_MILLION, cacheWrite: 0, imageTokens: 0, images: 0 },
  { requests: 45494, input: 382.95 * TOKENS_PER_MILLION, cacheRead: 2946.28 * TOKENS_PER_MILLION, output: 30.74 * TOKENS_PER_MILLION, cacheWrite: 0, imageTokens: 0, images: 0 },
  { requests: 0, input: TOKENS_PER_MILLION, cacheRead: 0, output: 200_000, cacheWrite: 0, imageTokens: 0, images: 0 }
];

function isLegacyUsage(usage) {
  return LEGACY_USAGE_PROFILES.some(profile => usageMatchesPreset(usage, profile));
}

// 设置页的输入框把 token 折成百万、保留 4 位小数，读回来就丢了尾巴。
// 判定预设时按同一精度比，否则同步一次就会被判成「自定义」。
const USAGE_DISPLAY_DIGITS = 1e4;
function usageMatchValue(field, value) {
  const raw = Number(value) || 0;
  if (field === "requests") return Math.round(raw);
  return Math.round((raw / TOKENS_PER_MILLION) * USAGE_DISPLAY_DIGITS) / USAGE_DISPLAY_DIGITS * TOKENS_PER_MILLION;
}

function usageMatchesPreset(usage, preset) {
  return USAGE_MATCH_FIELDS.every(field => usageMatchValue(field, preset?.[field]) === usageMatchValue(field, usage?.[field]));
}

export function usagePresetId(usage, magpieSync = null) {
  if (usageMatchesPreset(usage, usagePresetUsage("recent30d", magpieSync))) return "recent30d";
  if (usageMatchesPreset(usage, BASELINE_USAGE)) return "baseline";
  return "custom";
}

const LOCAL_HTTP_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
export function isSecureRemoteUrl(value) {
  try {
    const url = new URL(String(value));
    return url.protocol === "https:" || (url.protocol === "http:" && LOCAL_HTTP_HOSTS.has(url.hostname));
  } catch {
    return false;
  }
}
export function currentSiteOrigin(value) {
  try {
    const url = new URL(String(value || ""));
    return isSecureRemoteUrl(url) ? url.origin : "";
  } catch {
    return "";
  }
}

export { normalizeRechargeTiers };

export const BILLING_PROFILE_SOURCES = ["auto", "measured", "manual"];

// 站点用量画像：只喂按次计费模型的折算与平衡点，不参与按量模型的月成本。
export function normalizeBillingProfile(input) {
  const tokensPerRequest = Number(input?.tokensPerRequest);
  if (!Number.isFinite(tokensPerRequest) || tokensPerRequest <= 0) return { tokensPerRequest: 0, source: "auto" };
  const source = BILLING_PROFILE_SOURCES.includes(input?.source) ? input.source : "manual";
  return { tokensPerRequest, source: source === "auto" ? "manual" : source };
}
export const DEFAULT_MATCHING_RULES = [
  { id: "exact", name: "精确名称", enabled: true },
  { id: "suffix", name: "后缀/供应商", enabled: false },
  { id: "ignore_version", name: "忽略版本号", enabled: false },
  { id: "fuzzy", name: "模糊匹配", enabled: false }
];


export const DEFAULT_MODEL_ASSISTANT = {
  enabled: false,
  provider: "openai-compatible",
  baseUrl: "",
  model: "",
  temperature: 0.1
};

const DEFAULT_SETTINGS = {
  defaultCurrency: "CNY",
  exchangeRate: DEFAULT_EXCHANGE_RATE,
  recommendationProfile: "price",
  evidenceThreshold: 60,
  usage: { ...DEFAULT_MONTHLY_USAGE },
  matchingRules: DEFAULT_MATCHING_RULES,
  modelMatchOverrides: [],
  modelAssistant: DEFAULT_MODEL_ASSISTANT,
  showUnmatched: true,
  comparisonMode: "paid",
  devMode: false,
  pluginInstallMigrated: false,
  localPlugins: [],
  pluginRegistry: { url: DEFAULT_PLUGIN_REGISTRY_URL, fetchedAt: 0, error: "", entries: [], installed: {} },
  updateAutoCheck: true,
  updateIntervalMinutes: DEFAULT_UPDATE_INTERVAL_MINUTES,
  updateChannel: DEFAULT_UPDATE_CHANNEL,
  magpieBaseUrl: MAGPIE_USAGE_DEFAULT_BASE_URL,
  magpieSyncIntervalMinutes: DEFAULT_MAGPIE_SYNC_INTERVAL_MINUTES,
  magpieSync: null,
};

export const STATION_CATEGORY_LABELS = {
  benchmark: "基准",
  paid: "付费中转站",
  public: "公益中转站"
};
export const STATION_CATEGORIES = Object.keys(STATION_CATEGORY_LABELS);

export const DEFAULT_STATION = {
  id: "",
  category: "paid",
  name: "",
  baseUrl: "",
  enabled: true,
  mode: "direct",
  rechargeRmb: 1,
  rechargeCurrency: "CNY",
  rechargeCredits: 1,
  rechargeRate: 1,
  rechargeRateVerified: true,
  // 站点公开 /api/status 时优先用它的现价，关掉就只认上面手填的比例。
  rechargeAuto: true,
  rechargeRateNote: "",
  priceCurrency: "CREDITS",
  priceCurrencyVerified: true,
  priceCurrencyNote: "",
  basePricePerMillion: SYSTEM_BASE_PRICE_PER_1M,
  rechargeTiers: [],
  rechargeTiersVerified: false,
  rechargePlans: [],
  rechargePlansVerified: false,
  rechargePayments: [],
  rechargePaymentsVerified: false,
  billingProfile: { tokensPerRequest: 0, source: "auto" },
  auth: { type: "none", token: "", username: "", password: "" },
  adapter: { kind: "custom", endpoint: "", method: "GET", responseFormat: "auto", rawJson: "" },
  tags: []
};

function cloneDefaultSettings() {
  return structuredClone(DEFAULT_SETTINGS);
}

export function cloneDefaultStation() {
  return structuredClone(DEFAULT_STATION);
}

function normalizeModelAssistant(input = {}) {
  const raw = input && typeof input === "object" ? input : {};
  const { apiKey: _apiKey, hasApiKey: _hasApiKey, ...rest } = raw;
  const config = { ...DEFAULT_MODEL_ASSISTANT, ...rest };
  config.enabled = Boolean(config.enabled);
  config.provider = "openai-compatible";
  config.baseUrl = String(config.baseUrl || "").trim();
  if (config.baseUrl && !isSecureRemoteUrl(config.baseUrl)) config.baseUrl = "";
  config.model = String(config.model || "").trim();
  const temperature = Number(config.temperature);
  config.temperature = Math.min(1, Math.max(0, Number.isFinite(temperature) ? temperature : DEFAULT_MODEL_ASSISTANT.temperature));
  return config;
}

function normalizeModelMatchOverrides(input) {
  const overrides = new Map();
  for (const raw of Array.isArray(input) ? input : []) {
    const stationId = String(raw?.stationId || "").trim();
    const modelName = String(raw?.modelName || "").trim();
    const officialModelId = String(raw?.officialModelId || "").trim();
    const normalizedModelName = modelName.toLowerCase().replace(/^(?:\[[^\]]*\]\s*)+/, "").replace(/-expires-on-\d{4}(?:-\d{2}-\d{2})?$/, "");
    if (stationId && normalizedModelName && officialModelId) overrides.set(JSON.stringify([stationId, normalizedModelName]), { stationId, modelName, officialModelId });
  }
  return [...overrides.values()];
}


export function normalizeSettings(input = {}) {
  const base = cloneDefaultSettings();
  const rawUsage = input.usage && typeof input.usage === "object" ? input.usage : {};
  const magpieSync = normalizeMagpieSyncState(input.magpieSync);
  let usage = { ...base.usage, ...rawUsage };
  const useMagpie = !USAGE_MATCH_FIELDS.some(field => Object.prototype.hasOwnProperty.call(rawUsage, field))
    || usageMatchesPreset(usage, BUILTIN_30D_MONTHLY_VOLUME)
    || isLegacyUsage(usage)
    || (input.magpieSync?.recent7d?.usage && usageMatchesPreset(usage, input.magpieSync.recent7d.usage));
  if (useMagpie) usage = mergeGatewayUsage(usage, usagePresetUsage("recent30d", magpieSync));
  const settings = {
    ...base,
    ...input,
    usage,
    matchingRules: Array.isArray(input.matchingRules) ? input.matchingRules.map((rule) => ({ ...rule })) : base.matchingRules.map((rule) => ({ ...rule })),
    modelMatchOverrides: normalizeModelMatchOverrides(input.modelMatchOverrides),
    modelAssistant: normalizeModelAssistant(input.modelAssistant),
// recommendationProfile 已废弃，仅保留旧值校验以便清理历史设置。
    recommendationProfile: ["balanced", "price", "reliability"].includes(input.recommendationProfile) ? input.recommendationProfile : "price",
    evidenceThreshold: Number.isFinite(Number(input.evidenceThreshold)) ? Math.max(0, Math.min(100, Math.round(Number(input.evidenceThreshold)))) : 60,
  devMode: input.devMode === true,
    pluginInstallMigrated: input.pluginInstallMigrated === true,
    localPlugins: normalizeLocalPlugins(input.localPlugins).specs,
    pluginRegistry: normalizeRegistryState(input.pluginRegistry),
    updateAutoCheck: input.updateAutoCheck !== false,
    updateIntervalMinutes: normalizeUpdateInterval(input.updateIntervalMinutes),
    updateChannel: normalizeUpdateChannel(input.updateChannel),
    magpieBaseUrl: normalizeMagpieBaseUrl(input.magpieBaseUrl),
    magpieSyncIntervalMinutes: normalizeMagpieSyncInterval(input.magpieSyncIntervalMinutes),
    magpieSync,
  };
  if (!Object.prototype.hasOwnProperty.call(rawUsage, "imageOutputTokens") && Object.prototype.hasOwnProperty.call(rawUsage, "imageTokens")) settings.usage.imageOutputTokens = rawUsage.imageTokens;
  settings.usage.imageTokens = settings.usage.imageOutputTokens;
  delete settings.refreshIntervalMinutes;
  for (const legacyKey of ["llm", "jev", "providerProfiles", "activeProviders", "checkinState", "checkinLoginWatch", "checkinAutomation", "checkinResults"]) delete settings[legacyKey];
  for (const field of ["input", "cacheRead", "cacheWrite", "cacheWrite1h", "output", "requests", "imageInputTokens", "imageOutputTokens", "imageTokens", "images", "peakShare"]) {
    const value = Number(settings.usage[field]);
    settings.usage[field] = Number.isFinite(value) && value >= 0 ? value : base.usage[field];
  }
  settings.usage.peakShare = Math.min(1, Math.max(0, Number(settings.usage.peakShare) || base.usage.peakShare));
  settings.defaultCurrency = settings.defaultCurrency === "USD" ? "USD" : "CNY";
  settings.exchangeRate = Number.isFinite(Number(settings.exchangeRate)) && Number(settings.exchangeRate) > 0 ? Number(settings.exchangeRate) : DEFAULT_EXCHANGE_RATE;
  settings.showUnmatched = Boolean(settings.showUnmatched);
  settings.comparisonMode = settings.comparisonMode === "public" ? "public" : "paid";
  return settings;
}


export function normalizeUrl(value) {
  const url = new URL(String(value || ""));
  if (!isSecureRemoteUrl(url)) throw new Error("远程地址必须使用 HTTPS；仅允许 localhost 使用 HTTP");
  url.hash = "";
  url.search = "";
  return url.toString().replace(/\/$/, "");
}

export function normalizeStation(input = {}) {
  const station = { ...cloneDefaultStation(), ...input };
  station.id = station.id || crypto.randomUUID();
  station.name = String(station.name || new URL(station.baseUrl).hostname);
  station.pluginId = String(station.pluginId || "").trim();
  station.baseUrl = normalizeUrl(station.baseUrl);
  station.mode = station.mode === "page" ? "page" : "direct";
  station.category = STATION_CATEGORIES.includes(input.category) ? input.category : "paid";
  // 退役的 responseFormat 旧值在这里就地换成等价声明，存储里不再留旧值。
  station.adapter = migrateStationAdapter({ ...DEFAULT_STATION.adapter, ...(input.adapter || {}) });
  station.auth = { ...DEFAULT_STATION.auth, ...(input.auth || {}) };
  // 签到功能已下线：老设置里的站点级签到字段在这里清掉，不再写回存储。
  delete station.checkin;
  const hasRatioInputs = Object.prototype.hasOwnProperty.call(input, "rechargeRmb") || Object.prototype.hasOwnProperty.call(input, "rechargeCredits");
  const rechargeRmb = Number(input.rechargeRmb);
  const rechargeCredits = Number(input.rechargeCredits);
  const legacyRate = Number(input.rechargeRate);
  const rechargeRate = hasRatioInputs && rechargeRmb > 0 && rechargeCredits > 0
    ? rechargeRmb / rechargeCredits
    : Number.isFinite(legacyRate) && legacyRate >= 0 ? legacyRate : 1;
  station.rechargeRmb = Number.isFinite(rechargeRmb) && rechargeRmb >= 0 ? rechargeRmb : rechargeRate;
  station.rechargeCredits = Number.isFinite(rechargeCredits) && rechargeCredits > 0 ? rechargeCredits : 1;
  station.rechargeRate = rechargeRate;
  station.rechargeCurrency = input.rechargeCurrency === "USD" ? "USD" : "CNY";
  station.priceCurrency = ["CNY", "USD", "CREDITS", "UNKNOWN"].includes(input.priceCurrency) ? input.priceCurrency : "CREDITS";
  station.priceCurrencyVerified = station.priceCurrency !== "UNKNOWN" && input.priceCurrencyVerified !== false;
  station.priceCurrencyNote = String(input.priceCurrencyNote || "").trim();
  // 手填比例只有显式标了「已核实」才拿来乘价格，没标就先按 1:1 估算。
  station.rechargeRateVerified = input.rechargeRateVerified === true;
  station.rechargeAuto = input.rechargeAuto !== false;
  station.rechargeRateNote = String(input.rechargeRateNote || "").trim();
  const basePricePerMillion = Number(station.basePricePerMillion);
  station.basePricePerMillion = Number.isFinite(basePricePerMillion) && basePricePerMillion >= 0 ? basePricePerMillion : SYSTEM_BASE_PRICE_PER_1M;
  station.rechargeTiers = normalizeRechargeTiers(input.rechargeTiers);
  station.rechargeTiersVerified = station.rechargeTiers.length > 0 && input.rechargeTiersVerified !== false;
  station.rechargePlans = normalizeRechargePlans(input.rechargePlans);
  station.rechargePlansVerified = station.rechargePlans.length > 0 && input.rechargePlansVerified !== false;
  station.rechargePayments = normalizeRechargePayments(input.rechargePayments);
  station.rechargePaymentsVerified = station.rechargePayments.length > 0 && input.rechargePaymentsVerified !== false;
  station.billingProfile = normalizeBillingProfile(input.billingProfile);
  return station;
}
