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
  return /unauthori[sz]ed|not[ -]?authenticated|session.{0,16}(expired|invalid)|please.{0,16}log[ -]?in|login.{0,16}(required|expired)|未登录|请先登录|请登录|登录已过期|会话已失效|认证失败|重新登录/i.test(value);
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

export function refreshStationSignature(stations) {
  return JSON.stringify((stations || []).filter(station => station.enabled).map(station => [
    station.id,
    sanitizePreflightUrl(station.baseUrl),
    station.mode,
    sanitizePreflightUrl(station.adapter?.endpoint || station.baseUrl, station.baseUrl),
    station.adapter?.method || "GET",
    station.priceCurrency,
    station.priceCurrencyVerified,
    station.rechargeRate,
    station.rechargeRateVerified
  ]).sort((left, right) => String(left[0]).localeCompare(String(right[0]))));
}

export function assertRefreshConfirmation(preflight, confirmation, stations, now = Date.now()) {
  if (confirmation?.confirmed !== true || typeof confirmation.preflightToken !== "string" || !confirmation.preflightToken || !preflight
    || confirmation.preflightToken !== preflight.token
    || !Number.isFinite(preflight.expiresAt)
    || preflight.expiresAt <= now
    || typeof preflight.stationSignature !== "string"
    || preflight.stationSignature !== refreshStationSignature(stations)) {
    const error = new Error(REFRESH_CONFIRMATION_REQUIRED_MESSAGE);
    error.code = REFRESH_CONFIRMATION_REQUIRED_CODE;
    throw error;
  }
  return true;
}
