export const OPENROUTER_URL = "https://openrouter.ai/api/v1/models";
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

// 实测月用量：s2api 2026-09-06 至 2026-10-07（32 天）日趋势汇总，按 30 天折算。
const MEASURED_MONTHLY_VOLUME = {
  requests: 45494,
  input: 382.95 * TOKENS_PER_MILLION,
  cacheRead: 2946.28 * TOKENS_PER_MILLION,
  output: 30.74 * TOKENS_PER_MILLION,
  cacheWrite: 0
};

export const DEFAULT_MONTHLY_USAGE = {
  ...MEASURED_MONTHLY_VOLUME,
  peakShare: 7 / 24,
  imageTokens: 0,
  images: 0
};

export const USAGE_PRESETS = [
  { id: "measured", label: "实测月用量", usage: MEASURED_MONTHLY_VOLUME },
  {
    id: "baseline",
    label: "基础估算（3000 万输入 / 600 万输出）",
    usage: { requests: 0, input: 30 * TOKENS_PER_MILLION, cacheRead: 0, output: 6_000_000, cacheWrite: 0, imageTokens: 0, images: 0 }
  }
];


// 兼容旧版本保存的日用量和基础预设，避免已有设置继续覆盖实测月用量。
const LEGACY_USAGE_PROFILES = [
  { requests: 7900, input: 66.5 * TOKENS_PER_MILLION, cacheRead: 550.7 * TOKENS_PER_MILLION, output: 5.5 * TOKENS_PER_MILLION, cacheWrite: 0, imageTokens: 0, images: 0 },
  { requests: 44400, input: 372.6 * TOKENS_PER_MILLION, cacheRead: 2865.3 * TOKENS_PER_MILLION, output: 29.7 * TOKENS_PER_MILLION, cacheWrite: 0, imageTokens: 0, images: 0 },
  { requests: 0, input: TOKENS_PER_MILLION, cacheRead: 0, output: 200_000, cacheWrite: 0, imageTokens: 0, images: 0 }
];

function isLegacyUsage(usage) {
  return LEGACY_USAGE_PROFILES.some(profile => Object.entries(profile).every(([field, value]) => Number(usage?.[field] ?? 0) === Number(value)));
}

export function usagePresetId(usage) {
  return USAGE_PRESETS.find(preset => Object.entries(preset.usage).every(([field, value]) => Number(value) === Number(usage[field])))?.id || "custom";
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
export const DEFAULT_MATCHING_RULES = [
  { id: "exact", name: "精确名称", enabled: true },
  { id: "suffix", name: "后缀/供应商", enabled: false },
  { id: "ignore_version", name: "忽略版本号", enabled: false },
  { id: "fuzzy", name: "模糊匹配", enabled: false }
];

export const DEFAULT_LLM_CONFIG = {
  enabled: false,
  provider: "openai-compatible",
  baseUrl: "",
  model: "",
  temperature: 0.1,
  systemPrompt: ""
};

export const DEFAULT_JEV_CONFIG = {
  enabled: false,
  baseUrl: "",
  modelId: "",
  modelName: "",
  version: "",
  endpoint: "",
  responseFormat: "auto",
  notes: ""
};

export const DEFAULT_PROVIDER_PROFILES = { llm: [], jev: [] };
export const DEFAULT_ACTIVE_PROVIDERS = { llm: "", jev: "" };

export const DEFAULT_SETTINGS = {
  defaultCurrency: "CNY",
  exchangeRate: DEFAULT_EXCHANGE_RATE,
  recommendationProfile: "price",
  usage: { ...DEFAULT_MONTHLY_USAGE },
  matchingRules: DEFAULT_MATCHING_RULES,
  modelMatchOverrides: [],
  showUnmatched: true,
  showStale: true,
  llm: DEFAULT_LLM_CONFIG,
  jev: DEFAULT_JEV_CONFIG,
  providerProfiles: DEFAULT_PROVIDER_PROFILES,
  activeProviders: DEFAULT_ACTIVE_PROVIDERS,
};

export const DEFAULT_STATION = {
  id: "",
  name: "",
  baseUrl: "",
  enabled: true,
  mode: "direct",
  rechargeRmb: 1,
  rechargeCurrency: "CNY",
  rechargeCredits: 1,
  rechargeRate: 1,
  basePricePerMillion: SYSTEM_BASE_PRICE_PER_1M,
  auth: { type: "none", token: "", username: "", password: "" },
  adapter: { kind: "custom", endpoint: "", method: "GET", responseFormat: "auto", rawJson: "" },
  checkin: { token: "", autoEnabled: false },
  tags: []
};

export function cloneDefaultSettings() {
  return structuredClone(DEFAULT_SETTINGS);
}

export function cloneDefaultStation() {
  return structuredClone(DEFAULT_STATION);
}

function normalizeModelConfig(kind, input = {}) {
  const defaults = kind === "jev" ? DEFAULT_JEV_CONFIG : DEFAULT_LLM_CONFIG;
  const { hasApiKey: _hasApiKey, apiKey: _apiKey, id: _id, name: _name, ...raw } = input && typeof input === "object" ? input : {};
  const config = { ...defaults, ...raw };
  config.enabled = Boolean(config.enabled);
  config.baseUrl = String(config.baseUrl || "").trim();
  if (config.baseUrl && !isSecureRemoteUrl(config.baseUrl)) config.baseUrl = "";
  if (kind === "jev") {
    config.modelId = String(config.modelId || "").trim();
    config.modelName = String(config.modelName || "").trim();
    config.version = String(config.version || "").trim();
    config.endpoint = String(config.endpoint || "").trim();
    config.responseFormat = ["auto", "pqh", "sora"].includes(config.responseFormat) ? config.responseFormat : "auto";
    config.notes = String(config.notes || "").trim();
  } else {
    config.provider = "openai-compatible";
    config.model = String(config.model || "").trim();
    config.temperature = Math.min(1, Math.max(0, Number.isFinite(Number(config.temperature)) ? Number(config.temperature) : 0.1));
    config.systemPrompt = String(config.systemPrompt || "").trim();
  }
  return config;
}
function normalizeProviderProfiles(kind, input) {
  if (!Array.isArray(input)) return [];
  return input.map((raw, index) => {
    const source = raw && typeof raw === "object" ? raw : {};
    const config = normalizeModelConfig(kind, source);
    return {
      id: String(source.id || `${kind}-${index + 1}`).trim(),
      name: String(source.name || `${kind === "jev" ? "JEV" : "LLM"} ${index + 1}`).trim(),
      ...config
    };
  }).filter(profile => profile.id);
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
  const peakShare = Number(rawUsage.peakShare);
  const usage = isLegacyUsage(rawUsage)
    ? { ...base.usage, ...(Number.isFinite(peakShare) ? { peakShare } : {}) }
    : { ...base.usage, ...rawUsage };
  const settings = {
    ...base,
    ...input,
    usage,
    matchingRules: Array.isArray(input.matchingRules) ? input.matchingRules.map((rule) => ({ ...rule })) : base.matchingRules.map((rule) => ({ ...rule })),
    modelMatchOverrides: normalizeModelMatchOverrides(input.modelMatchOverrides),
    recommendationProfile: ["balanced", "price", "reliability"].includes(input.recommendationProfile) ? input.recommendationProfile : "price",
    llm: normalizeModelConfig("llm", input.llm),
    jev: normalizeModelConfig("jev", input.jev)
  };
  delete settings.refreshIntervalMinutes;
  for (const field of ["input", "cacheRead", "cacheWrite", "output", "requests", "imageTokens", "images", "peakShare"]) {
    const value = Number(settings.usage[field]);
    settings.usage[field] = Number.isFinite(value) && value >= 0 ? value : base.usage[field];
  }
  settings.usage.peakShare = Math.min(1, Math.max(0, Number(settings.usage.peakShare) || base.usage.peakShare));
  settings.defaultCurrency = settings.defaultCurrency === "USD" ? "USD" : "CNY";
  settings.exchangeRate = Number.isFinite(Number(settings.exchangeRate)) && Number(settings.exchangeRate) > 0 ? Number(settings.exchangeRate) : DEFAULT_EXCHANGE_RATE;
  settings.showUnmatched = Boolean(settings.showUnmatched);
  settings.showStale = Boolean(settings.showStale);
  const profileInput = input.providerProfiles && typeof input.providerProfiles === "object" ? input.providerProfiles : {};
  const providerProfiles = {
    llm: normalizeProviderProfiles("llm", profileInput.llm),
    jev: normalizeProviderProfiles("jev", profileInput.jev)
  };
  const activeInput = input.activeProviders && typeof input.activeProviders === "object" ? input.activeProviders : {};
  settings.providerProfiles = providerProfiles;
  settings.activeProviders = {
    llm: providerProfiles.llm.some(profile => profile.id === String(activeInput.llm || "")) ? String(activeInput.llm) : providerProfiles.llm[0]?.id || "",
    jev: providerProfiles.jev.some(profile => profile.id === String(activeInput.jev || "")) ? String(activeInput.jev) : providerProfiles.jev[0]?.id || ""
  };
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
  station.baseUrl = normalizeUrl(station.baseUrl);
  station.mode = station.mode === "page" ? "page" : "direct";
  station.adapter = { ...DEFAULT_STATION.adapter, ...(input.adapter || {}) };
  station.auth = { ...DEFAULT_STATION.auth, ...(input.auth || {}) };
  station.checkin = { token: String(input.checkin?.token || "").trim(), autoEnabled: Boolean(input.checkin?.autoEnabled) };
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
  const basePricePerMillion = Number(station.basePricePerMillion);
  station.basePricePerMillion = Number.isFinite(basePricePerMillion) && basePricePerMillion >= 0 ? basePricePerMillion : SYSTEM_BASE_PRICE_PER_1M;
  return station;
}
