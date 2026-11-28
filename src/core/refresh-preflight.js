export const REFRESH_PREFLIGHT_TTL_MS = 5 * 60 * 1000;
export const REFRESH_CONFIRMATION_REQUIRED_CODE = "REFRESH_CONFIRMATION_REQUIRED";
export const REFRESH_CONFIRMATION_REQUIRED_MESSAGE = "刷新预检已失效或尚未确认，请重新执行刷新预检";

const sensitiveQueryKey = /token|key|secret|password|auth|credential|session|cookie|jwt|signature|access|refresh/i;

export function sanitizePreflightUrl(value, base) {
  try {
    const url = new URL(String(value || ""), base);
    url.username = "";
    url.password = "";
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) if (sensitiveQueryKey.test(key)) url.searchParams.delete(key);
    return url.toString();
  } catch {
    return "";
  }
}


export function requiresPageSessionPreflight(station, provider) {
  if (!station?.enabled || station.mode !== "page") return false;
  // 插件没注册上时不能放过：page 模式一定得靠页面，跳过预检只会把
  // 「插件状态不对」伪装成「无需登录」，等采集时才炸。
  if (!provider) return Boolean(station.pluginId);
  const request = provider.request || {};
  return Boolean(request.pageAuth || request.credentials === "include");
}


const PREFLIGHT_REASON_LIMIT = 120;

// 预检失败必须把现场带出来：只给通用文案的话，面板上每个站点都是同一句话，等于没检查。
export function pageSessionStatusReason(status, detail = "") {
  const base = status === "ready" ? "页面会话检查通过"
    : status === "needsLogin" ? "未找到有效登录会话，请在打开的页面手动登录"
      : "无法确认登录状态，请检查页面后再手动确认";
  const extra = String(detail || "").replace(/\s+/g, " ").trim();
  if (!extra) return base;
  return `${base}（${extra.length > PREFLIGHT_REASON_LIMIT ? `${extra.slice(0, PREFLIGHT_REASON_LIMIT)}…` : extra}）`;
}
function stableSerialize(value) {
  if (value === null || value === undefined) return String(value);
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  if (typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function fingerprint(value) {
  let hash = 2166136261;
  for (const character of stableSerialize(value)) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function stationSignature(station) {
  const adapter = station.adapter || {};
  return [
    station.id,
    station.name,
    station.category,
    sanitizePreflightUrl(station.baseUrl),
    station.mode,
    station.auth?.type || "none",
    adapter.kind,
    sanitizePreflightUrl(adapter.endpoint || station.baseUrl, station.baseUrl),
    adapter.method || "GET",
    adapter.responseFormat || "auto",
    adapter.pageUrl ? sanitizePreflightUrl(adapter.pageUrl) : "",
    fingerprint(adapter.body || ""),
    fingerprint(adapter.rawJson || ""),
    station.priceCurrency,
    station.priceCurrencyVerified,
    station.rechargeRate,
    station.rechargeRateVerified,
    station.rechargeAuto,
    station.basePricePerMillion
  ];
}

export function refreshStationSignature(stations, comparisonMode = "paid") {
  const mode = comparisonMode === "public" ? "public" : "paid";
  return JSON.stringify({
    comparisonMode: mode,
    stations: (stations || []).filter(station => station.enabled === true).map(stationSignature)
      .sort((left, right) => String(left[0]).localeCompare(String(right[0])))
  });
}

export function assertRefreshConfirmation(preflight, confirmation, stations, comparisonMode = "paid", now = Date.now()) {
  if (typeof comparisonMode === "number") {
    now = comparisonMode;
    comparisonMode = "paid";
  }
  if (comparisonMode !== "public" && comparisonMode !== "paid") comparisonMode = "paid";
  if (confirmation?.confirmed !== true || typeof confirmation.preflightToken !== "string" || !confirmation.preflightToken || !preflight
    || preflight.comparisonMode !== comparisonMode
    || confirmation.preflightToken !== preflight.token
    || !Number.isFinite(preflight.expiresAt)
    || preflight.expiresAt <= now
    || typeof preflight.stationSignature !== "string"
    || preflight.stationSignature !== refreshStationSignature(stations, comparisonMode)) {
    const error = new Error(REFRESH_CONFIRMATION_REQUIRED_MESSAGE);
    error.code = REFRESH_CONFIRMATION_REQUIRED_CODE;
    throw error;
  }
  return true;
}
