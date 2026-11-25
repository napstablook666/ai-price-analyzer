// 无头续期：整个续期过程跑在 service worker 里，不创建任何标签页。
// 四种 kind 的判定顺序见 docs/plugin-development.md：
//   cookie        站点只给 HttpOnly cookie，refresh 接口校验 Origin；借 declarativeNetRequest
//                 补 Origin/Cookie，POST 换 access token。New-API 家族的
//                 POST /api/user/auth/refresh 就是这一类，只认 cookie 不认登录方式。
//   refresh-token 仓里有 refreshToken，POST 换新 access/refresh token。
//   session-probe 站点没有换 token 的接口，只能带 cookie 探活，只判存亡不换 token。
//   manual-token  用户在面板粘贴的长效令牌，expiresAt 记 null，永不过期。
import { getStationCredential, setStationCredential, setStationRenewal } from "../shared/credentials.js";
import { applyKeepaliveResult } from "./auth-keepalive.js";
export const RENEWAL_KINDS = Object.freeze(["cookie", "refresh-token", "session-probe", "manual-token"]);

// 与 service-worker.js 的 COOKIE_AUTH_RULE_BASE 同道号段，避免与采集中途的规则撞号。
const COOKIE_AUTH_RULE_BASE = 9300;
const DEFAULT_COOKIE_TTL_MS = 4 * 60 * 1000;
const DEFAULT_PROBE_TTL_MS = 6 * 60 * 60 * 1000;
const EXPIRY_MARGIN_MS = 60 * 1000;
const MIN_TTL_MS = 60 * 1000;

export function readRenewalPath(value, path) {
  const keys = String(path || "").split(".").filter(Boolean);
  if (!keys.length) return undefined;
  return keys.reduce((current, key) => (current && typeof current === "object" ? current[key] : undefined), value);
}

export function cookieAuthRuleId(stationId) {
  let hash = 0;
  for (const character of String(stationId)) hash = (hash * 31 + character.codePointAt(0)) % 10000;
  return COOKIE_AUTH_RULE_BASE + hash;
}

// 探活请求头里的 {{token}} / {{identity}} 由仓里对应的字段替换：
// New-API 那类站要 New-Api-User 才认会话，headless 拼不出它就探不了活。
export function resolveProbeHeaders(headers, base) {
  const source = headers && typeof headers === "object" ? headers : {};
  const resolved = {};
  for (const [name, template] of Object.entries(source)) {
    const value = String(template || "")
      .replaceAll("{{token}}", String(base?.token || ""))
      .replaceAll("{{identity}}", String(base?.identity || ""));
    if (value.trim()) resolved[name] = value;
  }
  return resolved;
}

export function normalizeRenewal(renewal) {
  const raw = renewal && typeof renewal === "object" ? renewal : {};
  const probeTtlMs = Number(raw.probeTtlMs);
  const probeHeaders = Object.fromEntries(
    Object.entries(raw.probeHeaders && typeof raw.probeHeaders === "object" ? raw.probeHeaders : {})
      .map(([name, value]) => [String(name), String(value || "")])
      .filter(([name, value]) => name && value)
  );
  return {
    kind: RENEWAL_KINDS.includes(raw.kind) ? raw.kind : "",
    refreshPath: String(raw.refreshPath || ""),
    probePath: String(raw.probePath || ""),
    probeHeaders,
    cookieName: String(raw.cookieName || ""),
    accessTokenPath: String(raw.accessTokenPath || "data.access_token"),
    expiresAtPath: String(raw.expiresAtPath || ""),
    refreshTokenPath: String(raw.refreshTokenPath || ""),
    expiresInPath: String(raw.expiresInPath || ""),
    probeTtlMs: Number.isFinite(probeTtlMs) && probeTtlMs > 0 ? probeTtlMs : DEFAULT_PROBE_TTL_MS,
    missingMessage: String(raw.missingMessage || "未找到站点登录凭据，请先在当前 Chrome 配置文件登录后重试"),
    failureMessage: String(raw.failureMessage || "站点登录态续期失败，请重新登录")
  };
}

// 站点给的是秒。expires_at 是绝对时间戳，expires_in 是时长，两者不能混。
// 仓里统一存毫秒，并留一分钟余量；余量吃掉全部寿命时兜底一分钟，避免刚写完就判过期。
function clampExpiry(expiresAt, now) {
  if (!Number.isFinite(expiresAt)) return now + DEFAULT_COOKIE_TTL_MS;
  return Math.max(expiresAt - EXPIRY_MARGIN_MS, now + MIN_TTL_MS);
}

function expiryFromAbsolute(seconds, now) {
  const value = Number(seconds);
  return clampExpiry(Number.isFinite(value) && value > 0 ? value * 1000 : NaN, now);
}

function expiryFromDuration(seconds, now) {
  const value = Number(seconds);
  return clampExpiry(Number.isFinite(value) && value > 0 ? now + value * 1000 : NaN, now);
}

function hostPathFilter(origin, requestUrl) {
  return `||${new URL(origin).hostname}${new URL(requestUrl).pathname}`;
}

async function withHeaderRule(chromeApi, station, origin, requestUrl, headers, run) {
  const ruleId = cookieAuthRuleId(station.id);
  await chromeApi.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [ruleId],
    addRules: [{
      id: ruleId,
      priority: 1,
      action: { type: "modifyHeaders", requestHeaders: headers(origin) },
      condition: { urlFilter: hostPathFilter(origin, requestUrl), resourceTypes: ["xmlhttprequest"] }
    }]
  });
  try {
    return await run();
  } finally {
    await Promise.resolve(chromeApi.declarativeNetRequest.updateSessionRules({ removeRuleIds: [ruleId] })).catch(() => {});
  }
}

function isUnauthorized(response) {
  return response.status === 401 || response.status === 403;
}

async function renewWithCookie(station, config, ctx) {
  const origin = new URL(station.baseUrl).origin;
  const refreshUrl = new URL(config.refreshPath, origin).toString();
  const cookie = await ctx.chromeApi.cookies.get({ url: refreshUrl, name: config.cookieName }).catch(() => null);
  if (!cookie?.value) return { status: "needsLogin", error: config.missingMessage };
  return withHeaderRule(ctx.chromeApi, station, origin, refreshUrl, () => [
    { header: "origin", operation: "set", value: origin },
    { header: "cookie", operation: "set", value: `${config.cookieName}=${cookie.value}` }
  ], async () => {
    const response = await ctx.request(refreshUrl, { method: "POST", headers: { Accept: "application/json" } });
    if (isUnauthorized(response)) return { status: "needsLogin", unauthorized: true, error: config.failureMessage };
    if (!response.ok) return { status: "needsLogin", error: config.failureMessage };
    const payload = await response.json();
    const token = String(readRenewalPath(payload, config.accessTokenPath) || "").trim();
    if (!token) return { status: "needsLogin", error: config.failureMessage };
    return { token, expiresAt: expiryFromAbsolute(readRenewalPath(payload, config.expiresAtPath), ctx.now), status: "ok" };
  });
}

async function renewWithRefreshToken(station, config, base, ctx) {
  if (!base.refreshToken) return { status: "needsLogin", error: config.missingMessage };
  const origin = new URL(station.baseUrl).origin;
  const url = new URL(config.refreshPath, origin).toString();
  return withHeaderRule(ctx.chromeApi, station, origin, url, current => [
    { header: "origin", operation: "set", value: current },
    { header: "referer", operation: "set", value: `${current}/` }
  ], async () => {
    const response = await ctx.request(url, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: base.refreshToken })
    });
    if (isUnauthorized(response)) return { status: "needsLogin", unauthorized: true, error: config.failureMessage };
    if (!response.ok) return { status: "needsLogin", error: config.failureMessage };
    const payload = await response.json();
    const token = String(readRenewalPath(payload, config.accessTokenPath) || "").trim();
    if (!token) return { status: "needsLogin", error: config.failureMessage };
    return {
      token,
      refreshToken: String(readRenewalPath(payload, config.refreshTokenPath) || base.refreshToken),
      expiresAt: config.expiresInPath
        ? expiryFromDuration(readRenewalPath(payload, config.expiresInPath), ctx.now)
        : expiryFromAbsolute(readRenewalPath(payload, config.expiresAtPath || config.expiresInPath), ctx.now),
      status: "ok"
    };
  });
}

// 探活头里引用的字段还没进仓（比如还没跑过一次页面采集，uid 没报到 service worker），
// 这时候打过去只会拿到 401，把好好的登录态标成 needsLogin。宁可先不知道。
function unresolvedProbeField(config, base) {
  const templates = Object.values(config.probeHeaders || {});
  if (templates.some(value => value.includes("{{identity}}")) && !base.identity) return "identity";
  if (templates.some(value => value.includes("{{token}}")) && !base.token) return "token";
  return "";
}

async function probeSession(station, config, base, ctx) {
  const missing = unresolvedProbeField(config, base);
  if (missing) return { ...base, status: base.status === "needsLogin" ? "needsLogin" : "unknown", skipped: missing };
  const origin = new URL(station.baseUrl).origin;
  const url = new URL(config.probePath, origin).toString();
  const headers = { Accept: "application/json", ...resolveProbeHeaders(config.probeHeaders, base) };
  let response;
  try {
    response = await ctx.request(url, { method: "GET", credentials: "include", headers });
  } catch {
    return { ...base, status: "needsLogin", error: config.failureMessage };
  }
  if (response.ok) return { ...base, status: "ok", expiresAt: ctx.now + config.probeTtlMs };
  if (isUnauthorized(response)) return { ...base, status: "needsLogin", error: config.missingMessage };
  return { ...base, status: "needsLogin", error: config.failureMessage };
}

// 页面侧续期成功后把新令牌报上来，这里落仓。页面关掉、worker 被回收都不影响。
// stationId 由 service worker 注入 pageAuth 时带上；空 id 一律不写，避免污染别的站。
// 插件声明 → 无头续期配置。插件自己写了 renewal 就用它（session-probe /
// refresh-token / manual-token）；没写就看有没有 cookie 换 token 的配置；
// 两样都没有就不排无头任务，交回原来的页面路径。
// 放在这里而不是 service-worker 里，是为了让「只加一个插件目录」能被测试直接
// 从插件声明跑到续期落仓，不用另造一份映射逻辑。
export function renewalFromProvider(provider) {
  const request = provider?.request || {};
  if (request.renewal) return normalizeRenewal(request.renewal);
  const cookieAuth = request.cookieAuth;
  if (!cookieAuth?.refreshPath) return null;
  return {
    kind: "cookie",
    cookieName: cookieAuth.cookieName,
    refreshPath: cookieAuth.refreshPath,
    accessTokenPath: cookieAuth.accessTokenPath,
    expiresAtPath: cookieAuth.expiresAtPath,
    missingMessage: cookieAuth.missingMessage,
    failureMessage: cookieAuth.failureMessage
  };
}

export async function applyPageRenewal(payload, deps = {}) {
  const data = payload && typeof payload === "object" ? payload : {};
  const stationId = String(data.stationId || "");
  const accessToken = String(data.accessToken || "").trim();
  const identity = String(data.identity || "").trim();
  // 只报 identity 也合法：New-API 那类站的 uid 不参与过期，
  // 拿到它之后 service worker 才能无头探活，不必为判一次存亡再开标签页。
  if (!stationId || (!accessToken && !identity)) return null;
  const chromeApi = deps.chrome || globalThis.chrome;
  const saveCredential = deps.setCredential || setStationCredential;
  const readCredential = deps.getCredential || getStationCredential;
  const saveRenewal = deps.setRenewal || setStationRenewal;
  const now = Number(deps.now ? deps.now() : Date.now());
  // 两条路都先把仓里那一条读出来：只报 identity 时不能把 token 冲成空，
  // 换到新 token 时也不能把用户名密码冲成空（basic 站靠它们采集）。
  const stored = deps.credential || (await readCredential(stationId, chromeApi)) || {};

  if (!accessToken) {
    await saveCredential(stationId, {
      token: String(stored.token || ""),
      identity,
      username: String(stored.username || ""),
      password: String(stored.password || "")
    }, chromeApi);
    // uid 到手不代表会话还活着，状态留给下一次探活去判。
    return { stationId, identity };
  }

  await saveCredential(stationId, {
    token: accessToken,
    ...(identity ? { identity } : {}),
    username: String(stored.username || ""),
    password: String(stored.password || "")
  }, chromeApi);
  const expiresAt = Number(data.expiresAt);
  const patch = {
    expiresAt: Number.isFinite(expiresAt) && expiresAt > 0 ? expiresAt : null,
    lastRenewedAt: now,
    renewFailures: 0,
    status: "ok"
  };
  // 页面这条路只回 access 令牌；没带 refresh 令牌就别把仓里已有的覆盖成空。
  const nextRefreshToken = String(data.refreshToken || "").trim();
  if (nextRefreshToken) patch.refreshToken = nextRefreshToken;
  await saveRenewal(stationId, patch, chromeApi);
  return { stationId, expiresAt: Number.isFinite(expiresAt) && expiresAt > 0 ? expiresAt : null };
}

export async function renewStationAuth(station, renewal, deps = {}) {
  const clock = deps.now || Date.now;
  const now = Number(clock());
  const chromeApi = deps.chrome || globalThis.chrome;
  const request = deps.fetch || (typeof globalThis.fetch === "function" ? globalThis.fetch.bind(globalThis) : null);
  const readCredential = deps.getCredential || getStationCredential;
  const saveCredential = deps.setCredential || setStationCredential;
  const saveRenewal = deps.setRenewal || setStationRenewal;
  const config = normalizeRenewal(renewal);
  const stored = deps.credential || (await readCredential(station.id, chromeApi)) || {};

  const base = {
    token: String(stored.token || ""),
    identity: String(stored.identity || ""),
    refreshToken: String(stored.refreshToken || ""),
    expiresAt: Number(stored.expiresAt) > 0 ? Number(stored.expiresAt) : null
  };
  const lastRenewedAt = Number(stored.lastRenewedAt) > 0 ? Number(stored.lastRenewedAt) : null;
  const renewFailures = Number(stored.renewFailures) > 0 ? Number(stored.renewFailures) : 0;

  const persist = async result => {
    // 失败次数与 status 走保活那套同一份规则：一次失败只记 unknown，
    // 连续三次才认定要重新登录。各 kind 各写一套的话，一个 5xx 就能把还能用的站
    // 标成 needsLogin，下一轮采集直接放弃它。
    const skipped = Boolean(result.skipped);
    // 401/403 与「仓里没有凭据」是确定的失败，当次就转 needsLogin，不等三次。
    const definitive = result.unauthorized === true || result.definitive === true || result.error === config.missingMessage;
    const outcome = result.status === "ok"
      ? { status: "ok", renewFailures: 0, lastRenewedAt: now }
      : skipped
        // 探活因为仓里缺字段而跳过，不算一次失败，否则三天后保活就自己退避了。
        ? { status: result.status || "unknown", renewFailures, lastRenewedAt }
        : definitive
          ? { status: "needsLogin", renewFailures: renewFailures + 1, lastRenewedAt }
          : applyKeepaliveResult({ renewFailures }, false, now);
    if (result.token) {
      await saveCredential(station.id, {
        token: result.token,
        identity: String(result.identity ?? base.identity ?? stored.identity ?? ""),
        username: stored.username || "",
        password: stored.password || ""
      }, chromeApi);
    }
    await saveRenewal(station.id, {
      expiresAt: result.expiresAt ?? null,
      refreshToken: result.refreshToken ?? "",
      lastRenewedAt: outcome.lastRenewedAt ?? lastRenewedAt,
      renewFailures: outcome.renewFailures,
      status: outcome.status
    }, chromeApi);
    return result;
  };

  if (config.kind === "manual-token") {
    return persist({ ...base, status: base.token ? "ok" : "needsLogin", definitive: true, expiresAt: null });
  }
  if (!config.kind) return persist({ ...base, status: "needsLogin", error: "缺少 renewal 声明" });

  const ctx = { chromeApi, request, now };

  if (config.kind === "session-probe") return persist(await probeSession(station, config, base, ctx));

  // cookie / refresh-token：仓里 token 还没过期就直接用，不再打一次接口。
  if (base.token && base.expiresAt && base.expiresAt > now) {
    return { ...base, status: "ok", expiresAt: base.expiresAt, cached: true };
  }

  const attempt = () => (config.kind === "cookie"
    ? renewWithCookie(station, config, ctx)
    : renewWithRefreshToken(station, config, base, ctx));

  let result = await attempt();
  // 401 多半是刚过期的边缘态：丢掉仓里旧 token 再来一次，最多一次。
  if (result.unauthorized) result = await attempt();
  return persist({ ...base, ...result, status: result.status || (result.token ? "ok" : "needsLogin") });
}
