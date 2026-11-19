// magpie 网关用量：把 /v1/magpie/usage 的窗口汇总折算成月用量。
// 只读本机网关，不发任何数据出去。

export const MAGPIE_USAGE_DEFAULT_BASE_URL = "http://127.0.0.1:3425";
export const MAGPIE_USAGE_PATH = "/v1/magpie/usage";

export const MAGPIE_USAGE_WINDOWS = [
  { id: "recent30d", label: "magpie-30天", period: "30d", days: 30 }
];

export const MAGPIE_SYNC_INTERVAL_OPTIONS = [
  { minutes: 0, label: "关闭" },
  { minutes: 360, label: "6 小时" },
  { minutes: 1440, label: "24 小时" }
];

export const DEFAULT_MAGPIE_SYNC_INTERVAL_MINUTES = 360;
export const MAGPIE_USAGE_TIMEOUT_MS = 15000;

export function normalizeMagpieSyncInterval(value) {
  const minutes = Number(value);
  return MAGPIE_SYNC_INTERVAL_OPTIONS.some(option => option.minutes === minutes) ? minutes : DEFAULT_MAGPIE_SYNC_INTERVAL_MINUTES;
}

// 只接受本机回环地址：网关是本地服务，不该把请求发到别处。
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function normalizeMagpieBaseUrl(value) {
  const text = String(value ?? "").trim();
  if (!text) return MAGPIE_USAGE_DEFAULT_BASE_URL;
  try {
    const url = new URL(text);
    if (url.protocol !== "http:" && url.protocol !== "https:") return MAGPIE_USAGE_DEFAULT_BASE_URL;
    if (!LOOPBACK_HOSTS.has(url.hostname)) return MAGPIE_USAGE_DEFAULT_BASE_URL;
    return url.origin;
  } catch {
    return MAGPIE_USAGE_DEFAULT_BASE_URL;
  }
}

export function magpieUsageUrl(baseUrl, period) {
  return `${normalizeMagpieBaseUrl(baseUrl)}${MAGPIE_USAGE_PATH}?period=${encodeURIComponent(period)}`;
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

// 网关返回最近 30 天的请求数和 token 总量。
export function monthlyUsageFromGateway(payload, days = 30) {
  const windowDays = Number(days) > 0 ? Number(days) : 30;
  const factor = 30 / windowDays;
  return {
    requests: Math.round(toNumber(payload?.calls) * factor),
    input: toNumber(payload?.input) * factor,
    cacheRead: toNumber(payload?.cache_read) * factor,
    cacheWrite: toNumber(payload?.cache_write) * factor,
    output: toNumber(payload?.output) * factor
  };
}

// 网关只报请求数与 token，高峰占比和图像用量沿用设置里已有的值。
export function mergeGatewayUsage(current, measured) {
  return {
    ...current,
    requests: measured.requests,
    input: measured.input,
    cacheRead: measured.cacheRead,
    cacheWrite: measured.cacheWrite,
    output: measured.output
  };
}

// 网关没跑起来时浏览器会抛 TypeError: Failed to fetch，换成能看懂的说法。
function describeFetchError(error) {
  const message = String(error?.message || error || "");
  if (/failed to fetch|networkerror|econnrefused|err_connection_refused/i.test(message)) return "连不上本机 magpie 网关，确认 magpie 正在运行";
  if (/abort|timeout|timed out/i.test(message)) return "magpie 网关响应超时";
  return message || "未知错误";
}

export async function fetchMagpieUsage({ baseUrl = MAGPIE_USAGE_DEFAULT_BASE_URL, period = "30d", days = 30, fetchImpl = globalThis.fetch, timeoutMs = MAGPIE_USAGE_TIMEOUT_MS } = {}) {
  const url = magpieUsageUrl(baseUrl, period);
  let response;
  try {
    const signal = typeof AbortSignal?.timeout === "function" ? AbortSignal.timeout(timeoutMs) : undefined;
    response = await fetchImpl(url, { method: "GET", headers: { Accept: "application/json" }, signal });
  } catch (error) {
    throw new Error(describeFetchError(error));
  }
  if (!response?.ok) throw new Error(`magpie 网关返回 ${response?.status ?? "无响应"}`);
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error("magpie 网关返回的不是 JSON");
  }
  if (!payload || typeof payload !== "object") throw new Error("magpie 网关返回的内容为空");
  return {
    usage: monthlyUsageFromGateway(payload, days),
    window: { period, days: Number(days) > 0 ? Number(days) : 30, from: payload.since ?? null, to: payload.until ?? null }
  };
}

// 存进 settings.magpieSync 的结构：每个窗口一份用量快照加时间戳，失败只记错误不覆盖已有数字。
export function normalizeMagpieSyncState(value) {
  if (!value || typeof value !== "object") return null;
  const state = { error: String(value.error || ""), attemptedAt: toNumber(value.attemptedAt) };
  for (const { id } of MAGPIE_USAGE_WINDOWS) {
    const entry = value[id];
    if (!entry || typeof entry !== "object" || !entry.usage) continue;
    state[id] = {
      usage: {
        requests: Math.round(toNumber(entry.usage.requests)),
        input: toNumber(entry.usage.input),
        cacheRead: toNumber(entry.usage.cacheRead),
        cacheWrite: toNumber(entry.usage.cacheWrite),
        output: toNumber(entry.usage.output)
      },
      syncedAt: toNumber(entry.syncedAt),
      window: entry.window && typeof entry.window === "object" ? { from: entry.window.from ?? null, to: entry.window.to ?? null } : null
    };
  }
  return Object.keys(state).some(key => key !== "error" && key !== "attemptedAt") ? state : null;
}

export function magpieSyncLabel(state) {
  if (!state?.recent30d?.syncedAt) return state?.error ? `上次同步失败：${state.error}` : "还没同步过";
  const latest = toNumber(state.recent30d.syncedAt);
  const when = new Date(latest);
  const stamp = Number.isFinite(latest) && latest > 0 ? `${when.toLocaleDateString("zh-CN")} ${when.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}` : "";
  return state?.error ? `${stamp} 同步成功，本次提示：${state.error}` : `${stamp} 已同步`;
}
