// 站点签到模块：按域名匹配预设，复用浏览器登录态（Cookie / Bearer）直接调用签到 API。
// 新增站点适配：在 CHECKIN_PRESETS 里加一条即可，无需改其他代码。

export const CHECKIN_PRESETS = [
  {
    id: "vyceai",
    matchHosts: ["vyceai.com"],
    name: "Vyce AI",
    // 状态与签到接口（bt="" 时为当前 origin 相对路径）
    statusPath: "/user/daily-reward",
    claimPath: "/user/daily-reward/claim",
    claimMethod: "POST",
    // 鉴权：请求同时携带 Authorization: Bearer <token> 与 Cookie（session=<token>）
    tokenStorageKey: "vyce_session",
    tokenCookieName: "session",
    // 响应字段映射（GET status 返回）：canClaim / streak / streakBonusPercent / rewardAmount / totalClaimed / tier
    // POST claim 返回：amount / streak
    fields: { canClaim: "canClaim", streak: "streak", rewardAmount: "rewardAmount", bonusPercent: "streakBonusPercent", totalClaimed: "totalClaimed", lastClaim: "lastClaim" },
    // 签到冷却周期（小时）：超过该周期且 canClaim 时可自动签到
    cooldownHours: 24
  }
];

export function matchCheckinPreset(station = {}) {
  let hostname = "";
  try {
    hostname = new URL(String(station.baseUrl || "")).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
  return CHECKIN_PRESETS.find(preset => preset.matchHosts.some(host => hostname === host || hostname.endsWith(`.${host}`))) || null;
}

function extractData(payload) {
  // 站点响应统一为 { code?, data?, error? } 或直接返回对象
  if (payload && typeof payload === "object") {
    if (payload.data && typeof payload.data === "object") return payload.data;
    return payload;
  }
  return null;
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
    const message = payload?.error?.message || (typeof payload?.error === "string" ? payload.error : "") || payload?.message || `HTTP ${response?.status || 0}`;
    const error = new Error(message);
    error.status = response?.status;
    throw error;
  }
  return payload;
}

function assertBusinessSuccess(payload) {
  const data = extractData(payload);
  if (!data || typeof data !== "object") return data;
  let message = "";
  if (data.error) message = typeof data.error === "string" ? data.error : data.error.message || "签到请求被站点拒绝";
  else if (data.success === false || data.ok === false) message = data.message || "签到请求被站点拒绝";
  else if (/already\s+claimed|already\s+checked|今日已签到|已签到/i.test(String(data.message || ""))) message = data.message;
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

// 通过已打开的 vyceai 标签页注入脚本读取登录态（localStorage token + cookie）。
// 无已开标签页时返回 null。
// 通过已打开的站点标签页注入脚本读取登录态（localStorage token + cookie）。
// 无已开标签页时返回 null。
async function readTokenFromPage(origin, preset) {
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
        try { token = localStorage.getItem(storageKey); } catch {}
        if (!token) {
          try {
            const match = document.cookie.match(new RegExp(`${cookieName}=([^;]+)`));
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
async function resolveToken(preset, station) {
  const origin = new URL(station.baseUrl).origin;
  // 1. 已存的手动 token（扩展设置里填写）
  const manual = String(station.checkin?.token || "").trim();
  if (manual) return manual;
  // 2. 从已打开的 vyceai 页面读取 localStorage["vyce_session"] / cookie "session"
  const fromPage = await readTokenFromPage(origin, preset);
  if (fromPage) return fromPage;
  return "";
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
    autoEnabled: Boolean(raw.autoEnabled)
  };
}

// 执行一次签到（或仅查状态）。返回签到结果 + 最新状态。
export async function performCheckin({ station, claim = true, preset = null, token = "", fetchImpl = fetch } = {}) {
  const sitePreset = preset || matchCheckinPreset(station);
  if (!sitePreset) throw new Error("该站点暂无签到适配");
  const origin = new URL(station.baseUrl).origin;
  const resolvedToken = token || await resolveToken(sitePreset, station);
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
}
