// 无头续期：整个续期过程跑在 service worker 里，不创建任何标签页。
// 四种 kind 的判定顺序见 docs/plugin-development.md：
//   cookie        站点只给 HttpOnly cookie，refresh 接口校验 Origin；借 declarativeNetRequest
//                 补 Origin/Cookie，POST 换 access token。New-API 家族的
//                 POST /api/user/auth/refresh 就是这一类，只认 cookie 不认登录方式。
//   refresh-token 仓里有 refreshToken，POST 换新 access/refresh token。
//   session-probe 站点没有换 token 的接口，只能带 cookie 探活，只判存亡不换 token。
//   manual-token  用户在面板粘贴的长效令牌，expiresAt 记 null，永不过期。
import { getStationCredential, setStationCredential, setStationRenewal } from "../shared/credentials.js";
import { applyKeepaliveResult, KEEPALIVE_DEFAULTS } from "./auth-keepalive.js";
export const RENEWAL_KINDS = Object.freeze(["cookie", "refresh-token", "session-probe", "manual-token"]);

// 与 service-worker.js 的 COOKIE_AUTH_RULE_BASE 同道号段，避免与采集中途的规则撞号。
const COOKIE_AUTH_RULE_BASE = 9300;
// 响应里没说过期时间时的兜底。cookie 这条路同样不能低于 MIN_TTL_MS：4 分钟比保活的
// margin（10 分钟）还短，排期会被钳成「每分钟醒一次」。refresh-token 按 30 分钟算。
export const DEFAULT_COOKIE_TTL_MS = 11 * 60 * 1000;
const DEFAULT_REFRESH_TTL_MS = 30 * 60 * 1000;
const DEFAULT_PROBE_TTL_MS = 6 * 60 * 60 * 1000;
const EXPIRY_MARGIN_MS = 60 * 1000;
// 存进仓的过期时间下限 = 保活 margin(10min) + minDelay(1min) 再多一点。比这更短的话
// 「expiresAt - margin」落在 now 附近，散列窗口宽度塌成 1，站点会被排成每分钟续一次。
const MIN_TTL_MS = 11 * 60 * 1000;
// 令牌剩余寿命小于保活的 margin 就该真续一次：排期本来就在「到期前 margin」叫醒，
// 执行器还要求「已经过期才续」的话，那一拍只会拿缓存，接着每分钟再来一次。
const RENEW_EARLY_MS = KEEPALIVE_DEFAULTS.marginMs;

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

// 面板上「粘令牌」这一步对各站不是同一个东西：长效令牌站要的是它的会话令牌，
// New-API 那类站的探活头（New-Api-User）要的是面板 uid。存错位置不是「没生效」，
// 是采集全 401，所以存档语义按站型分。
// 非手动令牌站不在这里标 ok：填错了得靠真打一次接口才知道，交给续期结果写仓。
export function tokenSavePatch(renewal, token) {
  const config = normalizeRenewal(renewal);
  const value = String(token || "").trim();
  if (config.kind === "manual-token") return { token: value, status: "ok", expiresAt: null };
  const fields = probeFieldNames(config);
  // 只认 uid 的站才写 identity；两个字段都引用的站猜不出来，按 token 存，别乱动 identity。
  if (fields.size === 1 && fields.has("identity")) return { identity: value };
  return { token: value };
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
    // 续期请求 body 里放刷新令牌的键名：New-API / sub2api 面板都叫 refresh_token，
    // 但这是站点约定的，不该在代码里写死。
    requestTokenKey: String(raw.requestTokenKey || "refresh_token"),
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
// 仓里统一存毫秒，并留一分钟余量；余量吃掉全部寿命时抬到 MIN_TTL_MS，避免刚写完就判过期。
function clampExpiry(expiresAt, now, fallbackTtlMs = DEFAULT_COOKIE_TTL_MS) {
  if (!Number.isFinite(expiresAt)) return now + fallbackTtlMs;
  return Math.max(expiresAt - EXPIRY_MARGIN_MS, now + MIN_TTL_MS);
}

function expiryFromAbsolute(seconds, now, fallbackTtlMs) {
  const value = Number(seconds);
  return clampExpiry(Number.isFinite(value) && value > 0 ? value * 1000 : NaN, now, fallbackTtlMs);
}

function expiryFromDuration(seconds, now, fallbackTtlMs) {
  const value = Number(seconds);
  return clampExpiry(Number.isFinite(value) && value > 0 ? now + value * 1000 : NaN, now, fallbackTtlMs);
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
  // 仓里还没有 refresh 令牌（页面没访问过、或在别处登的）：这不是「登录过期」，是
  // 「还没有可续期的凭据」。按跳过处理，别把站标成 needsLogin，等页面把令牌交上来。
  if (!base.refreshToken) return { status: "unknown", skipped: true, error: config.missingMessage };
  const origin = new URL(station.baseUrl).origin;
  const url = new URL(config.refreshPath, origin).toString();
  return withHeaderRule(ctx.chromeApi, station, origin, url, current => [
    { header: "origin", operation: "set", value: current },
    { header: "referer", operation: "set", value: `${current}/` }
  ], async () => {
    const response = await ctx.request(url, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ [config.requestTokenKey]: base.refreshToken })
    });
    if (isUnauthorized(response)) return { status: "needsLogin", unauthorized: true, error: config.failureMessage };
    if (!response.ok) return { status: "needsLogin", error: config.failureMessage };
    const payload = await response.json();
    const token = String(readRenewalPath(payload, config.accessTokenPath) || "").trim();
    if (!token) return { status: "needsLogin", error: config.failureMessage };
    return {
      token,
      refreshToken: String(readRenewalPath(payload, config.refreshTokenPath) || base.refreshToken),
      // 站点没给过期时间就按兜底 TTL 算：宁可早醒一次，不要落进分钟级回环。
      expiresAt: config.expiresInPath
        ? expiryFromDuration(readRenewalPath(payload, config.expiresInPath), ctx.now, DEFAULT_REFRESH_TTL_MS)
        : expiryFromAbsolute(readRenewalPath(payload, config.expiresAtPath || config.expiresInPath), ctx.now, DEFAULT_REFRESH_TTL_MS),
      status: "ok"
    };
  });
}

// 探活头认哪几个仓字段：「哪个字段不能缺」和「粘进来的值该存哪一格」是同一个问题，
// 两边都从这里读，别各写一套。
export function probeFieldNames(config) {
  const fields = new Set();
  for (const template of Object.values(config?.probeHeaders || {})) {
    if (String(template).includes("{{identity}}")) fields.add("identity");
    if (String(template).includes("{{token}}")) fields.add("token");
  }
  return fields;
}

// 探活头里引用的字段还没进仓（比如还没跑过一次页面采集，uid 没报到 service worker），
// 这时候打过去只会拿到 401，把好好的登录态标成 needsLogin。宁可先不知道。
function unresolvedProbeField(config, base) {
  const fields = probeFieldNames(config);
  if (fields.has("identity") && !base.identity) return "identity";
  if (fields.has("token") && !base.token) return "token";
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
  if (cookieAuth?.refreshPath) {
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
  // 页面续期声明也能无头跑：接口、body 键名、响应字段插件里都写全了，缺的只是
  // 「人得站在页面上」。cookieOnly 的站换令牌只认页面 cookie，那种仍走开标签页。
  const pageRefresh = request.pageAuth?.refresh;
  if (!pageRefresh?.endpoint || pageRefresh.cookieOnly === true) return null;
  // 页面的响应字段都挂在 responsePath 底下（data.access_token），三个键都要拼上前缀，
  // 少拼一个就读不到值，续上来的令牌会被当成「没有过期时间」。
  const pathOf = key => [
    ...String(pageRefresh.responsePath || "data").split("."),
    ...String(key || "").split(".").filter(Boolean)
  ].filter(Boolean).join(".");
  return normalizeRenewal({
    kind: "refresh-token",
    refreshPath: pageRefresh.endpoint,
    requestTokenKey: pageRefresh.requestTokenKey,
    accessTokenPath: pathOf(pageRefresh.accessTokenKey),
    refreshTokenPath: pathOf(pageRefresh.refreshTokenKey),
    // 没声明过期字段的站（all-in-one）留空，续期时按兜底 TTL 算。
    expiresInPath: pageRefresh.expiresInKey ? pathOf(pageRefresh.expiresInKey) : "",
    missingMessage: pageRefresh.missingMessage,
    failureMessage: pageRefresh.failureMessage
  });
}

export async function applyPageRenewal(payload, deps = {}) {
  const data = payload && typeof payload === "object" ? payload : {};
  const stationId = String(data.stationId || "");
  const accessToken = String(data.accessToken || "").trim();
  const identity = String(data.identity || "").trim();
  const seededRefreshToken = String(data.refreshToken || "").trim();
  // 三种报法都合法：access 令牌（真续过期了）、identity（New-API 那类站的 uid，
  // 不参与过期，拿到它就能无头探活）、只报 refresh 令牌（页面第一次把续期凭据交给仓）。
  if (!stationId || (!accessToken && !identity && !seededRefreshToken)) return null;
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
      // 只报 refresh 令牌时别把仓里已有的 uid 冲成空。
      ...(identity ? { identity } : {}),
      username: String(stored.username || ""),
      password: String(stored.password || "")
    }, chromeApi);
    // 补齐续期凭据就走，不碰状态：拿到 uid 或 refresh 令牌都不代表这次会话还活着，
    // 状态留给下一次续期 / 探活去判。
    if (seededRefreshToken) await saveRenewal(stationId, { refreshToken: seededRefreshToken }, chromeApi);
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
      // 这一轮没拿到新令牌不等于仓里那把作废了：cookie / 探活这条路本来就不回 refresh 令牌，
      // 写成空串会把页面交上来的续期凭据冲掉，之后就只能等页面再来一次。
      refreshToken: result.refreshToken ?? base.refreshToken,
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

  // cookie / refresh-token：仓里 token 离到期还早（大于保活 margin）就直接用，不再打一次接口。
  // 已经进 margin 窗口的要真续：排期就是在这一拍叫醒的。
  if (base.token && base.expiresAt && base.expiresAt - now > RENEW_EARLY_MS) {
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
