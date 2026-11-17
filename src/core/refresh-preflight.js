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

function loginSignal(value) {
  if (typeof value !== "string") return false;
  return /unauthori[sz]ed|not[ -]?authenticated|session.{0,16}(expired|invalid)|please.{0,16}log[ -]?in|login.{0,16}(required|expired)|未登录|未找到.{0,20}(登录|凭据)|登录凭据|请先登录|请登录|登录已过期|会话已失效|认证失败|重新登录/i.test(value);
}

function loginPageSignal(value) {
  if (typeof value !== "string") return false;
  return /<form\b[^>]*(?:login|signin)/i.test(value)
    || /<form\b[\s\S]{0,800}(?:type=["']password["']|name=["']password["'])/i.test(value)
    || /<input\b[^>]*(?:type=["']password["']|name=["']password["'])[^>]*>/i.test(value)
    || /(?:href|action)=["'][^"']*\/(?:login|signin)(?:[/?#"']|$)/i.test(value)
    || /"(?:url|redirect|redirect_url)"\s*:\s*"[^"]*\/(?:login|signin)(?:[/?#"]|$)/i.test(value);
}

function responseSignalsLogin(body) {
  if (loginSignal(body) || loginPageSignal(body)) return true;
  if (!body || typeof body !== "object") return false;
  let serialized;
  try { serialized = JSON.stringify(body); } catch { return false; }
  return loginSignal(serialized) || loginPageSignal(serialized);
}

export function requiresPageSessionPreflight(station, provider) {
  if (!station?.enabled || station.mode !== "page") return false;
  const request = provider?.request || {};
  return Boolean(request.pageAuth || request.credentials === "include");
}

export function classifyPageSessionResponse(response) {
  const status = Number(response?.status);
  if (status === 401 || status === 403 || responseSignalsLogin(response?.body)) return "needsLogin";
  if (response?.ok === true && status >= 200 && status < 300) return "ready";
  return "uncertain";
}

export function classifyPageSessionError(error) {
  return loginSignal(error?.message || String(error)) ? "needsLogin" : "uncertain";
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
