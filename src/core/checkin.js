// 站点签到模块：按域名匹配预设，复用浏览器登录态（Cookie / Bearer）直接调用签到 API。
// 站点适配由插件仓库的签到插件（JSON 规格）提供，这里只保留通用请求与校验逻辑。

import { stationContext } from "./provider-registry.js";
// 签到引擎：站点适配来自插件（仓库分发的 JSON 规格），这里只放通用请求与校验逻辑。
export function checkinPresetFromSpec(spec = {}) {
  const checkin = spec.checkin;
  if (!checkin || typeof checkin !== "object") return null;
  const hosts = Array.isArray(spec.hosts) ? spec.hosts.filter(Boolean).map(host => String(host).trim().toLowerCase()) : [];
  if (!hosts.length) return null;
  return { ...checkin, id: String(spec.id || ""), name: spec.name || spec.id, matchHosts: hosts };
}

export function checkinPresetsFromSpecs(specs = []) {
  return (Array.isArray(specs) ? specs : []).map(checkinPresetFromSpec).filter(preset => preset && preset.id);
}

export function matchCheckinPreset(station = {}, presets = []) {
  const hostname = stationContext(station).hostname;
  if (!hostname) return null;
  return (Array.isArray(presets) ? presets : []).find(preset => (preset.matchHosts || []).some(host => hostname === host || hostname.endsWith(`.${host}`))) || null;
}

function extractData(payload) {
  // 站点响应统一为 { code?, data?, error? } 或直接返回对象
  if (payload && typeof payload === "object") {
    if (payload.data && typeof payload.data === "object") return payload.data;
    return payload;
}
  return null;
}

const NEEDS_LOGIN_STATUSES = new Set([401, 403]);
const NEEDS_LOGIN_PATTERN = /not\s+(?:logged|signed)\s*in|unauthori[sz]ed|login\s+required|未登录|请先登录|登录已过期|登录失效/i;

function needsLoginError(message, status) {
  const error = new Error(message || "需要先登录站点");
  error.code = "CHECKIN_NEEDS_LOGIN";
  error.status = Number(status) || 0;
  return error;
}

async function fetchJson(url, options = {}, fetchImpl = fetch) {
  const response = await fetchImpl(url, options);
  let payload = null;
  if (Object.prototype.hasOwnProperty.call(response || {}, "body") && typeof response?.json !== "function") {
    payload = response.body;
  } else {
    const contentType = response?.headers?.get?.("content-type") || "";
    try {
      payload = contentType.includes("application/json") ? await response.json() : JSON.parse(await response.text());
    } catch {
      payload = response?.ok ? {} : null;
    }
  }
  if (!response?.ok) {
    const status = Number(response?.status) || 0;
    const message = payload?.error?.message || (typeof payload?.error === "string" ? payload.error : "") || payload?.message || `HTTP ${status}`;
    if (NEEDS_LOGIN_STATUSES.has(status)) throw needsLoginError(message, status);
    const error = new Error(message);
    error.status = status;
    throw error;
  }
  return payload;
}

function assertBusinessSuccess(payload) {
  const data = extractData(payload);
  if (!data || typeof data !== "object") return data;
  let message = "";
  const code = Number(data.code ?? payload?.code);
  if (NEEDS_LOGIN_STATUSES.has(code)) throw needsLoginError(data.message || payload?.message, code);
  if (data.error) message = typeof data.error === "string" ? data.error : data.error.message || "签到请求被站点拒绝";
  else if (data.success === false || data.ok === false) message = data.message || "签到请求被站点拒绝";
  else if (/already\s+claimed|already\s+checked|今日已签到|已签到/i.test(String(data.message || ""))) message = data.message;
  else if (NEEDS_LOGIN_PATTERN.test(String(data.message || ""))) throw needsLoginError(data.message);
  if (!message) return data;
  const error = new Error(String(message));
  error.code = "CHECKIN_REJECTED";
  throw error;
}

function buildHeaders(preset, token) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

// 通过已打开的站点标签页注入脚本读取登录态（localStorage token + cookie）。
// 无已开标签页时返回 null。
export async function readPageToken(origin, preset) {
  // 测试环境或没有 chrome API 时当作没有可读页面。
  if (typeof chrome === "undefined" || typeof chrome?.tabs?.query !== "function") return null;
  const tabs = await chrome.tabs.query({});
  const tab = tabs.find(item => {
    try { return new URL(item.url || "").origin === origin; } catch { return false; }
  });
  if (!tab?.id) return null;
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "MAIN",
      func: (storageKey, cookieName) => {
        let token = null;
        try { token = storageKey ? localStorage.getItem(storageKey) : null; } catch {}
        if (!token) {
          try {
            const match = cookieName ? document.cookie.match(new RegExp(`${cookieName}=([^;]+)`)) : null;
            token = match ? match[1] : null;
          } catch {}
        }
        return token;
      },
      args: [preset.tokenStorageKey, preset.tokenCookieName]
    });
    return typeof result?.result === "string" ? result.result : null;
  } catch {
    return null;
  }
}

async function resolveToken(preset, station, { sessionToken = "" } = {}) {
  const origin = new URL(station.baseUrl).origin;
  // 1. 已存的手动 token（扩展设置里填写）
  const manual = String(station.checkin?.token || "").trim();
  if (manual) return manual;
  // 2. 从已打开的站点页面读取 localStorage token / cookie
  const fromPage = await readPageToken(origin, preset);
  if (fromPage) return fromPage;
  // 3. 之前捕获的登录态快照
  return String(sessionToken || "").trim();
}
const SAME_SITE_VALUES = new Set(["no_restriction", "lax", "strict", "unspecified"]);

function normalizeCookie(raw = {}) {
  const name = String(raw?.name || "").trim();
  const value = String(raw?.value ?? "");
  if (!name || !value) return null;
  return {
    name,
    value,
    domain: String(raw.domain || "").trim().toLowerCase(),
    path: String(raw.path || "/"),
    secure: Boolean(raw.secure),
    httpOnly: Boolean(raw.httpOnly),
    sameSite: SAME_SITE_VALUES.has(raw.sameSite) ? raw.sameSite : "lax",
    expirationDate: Number(raw.expirationDate) > 0 ? Number(raw.expirationDate) : null
  };
}

// 登录态快照：token + 站点会话 cookie，用来在浏览器丢了登录态时补回去。
export function normalizeCheckinSession(raw = {}) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const token = String(raw.token || "").trim();
  const cookies = (Array.isArray(raw.cookies) ? raw.cookies : []).map(normalizeCookie).filter(Boolean).slice(0, 12);
  if (!token && !cookies.length) return null;
  return {
    token,
    cookies,
    origin: String(raw.origin || ""),
    capturedAt: Number(raw.capturedAt) || 0
  };
}

export function normalizeCheckinRecord(raw = {}) {
  return {
    lastCheckedAt: Number(raw.lastCheckedAt) || 0,
    lastClaimedAt: Number(raw.lastClaimedAt) || 0,
    lastClaimDate: String(raw.lastClaimDate || ""),
    lastResult: raw.lastResult || "",
    lastStatus: raw.lastStatus || "idle",
    streak: Number.isFinite(Number(raw.streak)) ? Number(raw.streak) : 0,
    totalClaimed: Number.isFinite(Number(raw.totalClaimed)) ? Number(raw.totalClaimed) : 0,
    rewardAmount: Number.isFinite(Number(raw.rewardAmount)) ? Number(raw.rewardAmount) : null,
    bonusPercent: Number.isFinite(Number(raw.bonusPercent)) ? Number(raw.bonusPercent) : null,
    autoEnabled: Boolean(raw.autoEnabled),
    token: String(raw.token || ""),
    needsLoginAt: Number(raw.needsLoginAt) || 0,
    session: normalizeCheckinSession(raw.session)
  };
}
// 执行一次签到（或仅查状态）。返回签到结果 + 最新状态。
export async function performCheckin({ station, claim = true, preset = null, token = "", fetchImpl = fetch, session = null, restoreCookies = null } = {}) {
  const sitePreset = preset || null;
  if (!sitePreset) throw new Error("该站点暂无签到适配");
  const origin = new URL(station.baseUrl).origin;
  const manualToken = String(token || "").trim();
  const sessionToken = String(session?.token || "").trim();
  const snapshotCookies = Array.isArray(session?.cookies) ? session.cookies : [];
  let restored = false;
  let claimedAny = false;

  const run = async () => {
    const resolvedToken = manualToken || await resolveToken(sitePreset, station, { sessionToken });
    const headers = buildHeaders(sitePreset, resolvedToken);
    const requestJson = (url, options) => fetchJson(url, options, fetchImpl);
    const fields = sitePreset.fields;
    const readStatus = async () => {
      const status = assertBusinessSuccess(await requestJson(`${origin}${sitePreset.statusPath}`, { headers, credentials: "include", cache: "no-store" }));
      if (typeof status?.[fields.canClaim] !== "boolean") throw new Error("签到状态响应无效");
      return status;
    };
    const status = await readStatus();
    const result = {
      ok: true,
      claimed: false,
      lastClaimDate: String(status?.[fields.lastClaim] || ""),
      canClaim: Boolean(status?.[fields.canClaim]),
      streak: Number(status?.[fields.streak]) || 0,
      rewardAmount: Number.isFinite(Number(status?.[fields.rewardAmount])) ? Number(status[fields.rewardAmount]) : null,
      bonusPercent: Number.isFinite(Number(status?.[fields.bonusPercent])) ? Number(status[fields.bonusPercent]) : null,
      totalClaimed: Number(status?.[fields.totalClaimed]) || 0,
      message: ""
    };
    if (!claim || !result.canClaim) {
      result.message = result.canClaim ? "可签到" : "今日已签到";
      return result;
    }
    const claimData = assertBusinessSuccess(await requestJson(`${origin}${sitePreset.claimPath}`, { method: sitePreset.claimMethod, headers, credentials: "include" }));
    claimedAny = true;
    const verifiedStatus = await readStatus();
    if (verifiedStatus?.[fields.canClaim] !== false) {
      const error = new Error("签到请求已返回，但网站状态未确认到账");
      error.code = "CHECKIN_NOT_CONFIRMED";
      throw error;
    }
    result.claimed = true;
    result.canClaim = false;
    result.lastClaimDate = String(verifiedStatus?.[fields.lastClaim] || result.lastClaimDate);
    result.streak = Number(verifiedStatus?.[fields.streak]) || result.streak;
    result.rewardAmount = Number.isFinite(Number(verifiedStatus?.[fields.rewardAmount])) ? Number(verifiedStatus[fields.rewardAmount]) : result.rewardAmount;
    result.bonusPercent = Number.isFinite(Number(verifiedStatus?.[fields.bonusPercent])) ? Number(verifiedStatus[fields.bonusPercent]) : result.bonusPercent;
    result.totalClaimed = Number(verifiedStatus?.[fields.totalClaimed]) || result.totalClaimed;
    result.message = `签到成功，奖励 ${claimData?.amount ?? result.rewardAmount ?? "?"}`;
    if (Number.isFinite(Number(claimData?.streak))) result.streak = Number(claimData.streak);
    return result;
  };

  try {
    return await run();
  } catch (error) {
    // 浏览器里的登录 cookie 丢了：把快照里的 cookie 写回去再试一次。
    // 已经发出过签到请求的不重试，避免重复签到。
    if (error?.code !== "CHECKIN_NEEDS_LOGIN" || restored || claimedAny) throw error;
    if (!snapshotCookies.length || typeof restoreCookies !== "function") throw error;
    restored = true;
    try { await restoreCookies(snapshotCookies); } catch { throw error; }
    return await run();
  }
}
