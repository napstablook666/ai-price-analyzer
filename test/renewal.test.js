import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  RENEWAL_KINDS,
  cookieAuthRuleId,
  normalizeRenewal,
  readRenewalPath,
  renewalFromProvider,
  renewStationAuth,
  applyPageRenewal
} from "../src/core/renewal.js";
import { getStationCredential, setStationCredential } from "../src/shared/credentials.js";

const NOW = 1800000000000;

// 真实凭据仓替身：只给 storage.local，让 applyPageRenewal 走真凭据模块、不经 deps 注入。
// 之前两个写坏仓的 bug 就是被注入进来的假仓盖住的，所以这里必须用真的。
function fakeStorageChrome() {
  const data = new Map();
  const area = {
    get: async key => {
      const out = {};
      for (const name of Array.isArray(key) ? key : [key]) if (data.has(name)) out[name] = data.get(name);
      return out;
    },
    set: async patch => {
      for (const [name, value] of Object.entries(patch)) data.set(name, value);
    }
  };
  return { storage: { local: area }, tabs: { create: async () => { throw new Error("续期过程不该创建标签页"); } } };
}

// 最小 chrome 替身：只实现续期真正用到的三个面。tabs.create 留成陷阱，
// 谁在续期里开标签页，测试直接红。
function fakeChrome(cookieValue = "session-value") {
  const rules = new Map();
  // D2 要的是「chrome.tabs.create 调用次数为 0」，所以光让 create 抛错不够（会被
  // .catch 吞掉），还要真的数一遍。
  let tabCreates = 0;
  return {
    cookies: { get: async () => (cookieValue ? { value: cookieValue } : null) },
    declarativeNetRequest: {
      updateSessionRules: async ({ removeRuleIds = [], addRules = [] }) => {
        for (const id of removeRuleIds) rules.delete(id);
        for (const rule of addRules) rules.set(rule.id, rule);
      }
    },
    tabs: { create: async () => { tabCreates += 1; throw new Error("续期过程不该创建标签页"); } },
    rules,
    tabCreates: () => tabCreates
  };
}

function fakeFetch(handlers) {
  const calls = [];
  const fn = async (url, options = {}) => {
    calls.push({ url, options });
    const handler = handlers[url] ?? handlers["*"];
    const value = typeof handler === "function" ? handler(calls.length, options) : handler;
    if (!value) throw new Error(`没准备的请求：${url}`);
    return { ok: value.status < 400, status: value.status, json: async () => value.body };
  };
  fn.calls = calls;
  return fn;
}

function fakeStore() {
  const data = new Map();
  return {
    data,
    getCredential: async id => ({ token: "", username: "", password: "", ...(data.get(id) || {}) }),
    setCredential: async (id, credential) => { data.set(id, { ...(data.get(id) || {}), ...credential }); },
    setRenewal: async (id, patch) => {
      data.set(id, { ...(data.get(id) || {}), ...patch });
      return data.get(id);
    }
  };
}

const CLAW = { id: "clawcn", baseUrl: "https://claw-cn.org/pricing" };
const COOKIE_RENEWAL = {
  kind: "cookie",
  cookieName: "new_api_has_session",
  refreshPath: "/api/user/auth/refresh",
  expiresAtPath: "data.access_expires_at"
};
const REFRESH_URL = "https://claw-cn.org/api/user/auth/refresh";

test("cookie 续期在 service worker 里跑完，不开标签页，规则 finally 清干净", async () => {
  const chromeApi = fakeChrome("sess");
  const store = fakeStore();
  const request = fakeFetch({ [REFRESH_URL]: { status: 200, body: { data: { access_token: "at-1", access_expires_at: 1800000600 } } } });

  const result = await renewStationAuth(CLAW, COOKIE_RENEWAL, { chrome: chromeApi, fetch: request, now: () => NOW, ...store });

  assert.equal(result.status, "ok");
  assert.equal(result.token, "at-1");
  assert.equal(chromeApi.rules.size, 0);
  assert.equal(chromeApi.tabCreates(), 0);
  assert.equal(store.data.get("clawcn").token, "at-1");
  assert.ok(store.data.get("clawcn").expiresAt > NOW);
  assert.equal(store.data.get("clawcn").renewFailures, 0);
  assert.equal(store.data.get("clawcn").lastRenewedAt, NOW);
});

test("没有登录 cookie 时直接判 needsLogin，一次请求都不发", async () => {
  const chromeApi = fakeChrome(null);
  const store = fakeStore();
  const request = fakeFetch({ "*": { status: 200, body: {} } });

  const result = await renewStationAuth(CLAW, COOKIE_RENEWAL, { chrome: chromeApi, fetch: request, now: () => NOW, ...store });

  assert.equal(result.status, "needsLogin");
  assert.equal(request.calls.length, 0);
  assert.equal(store.data.get("clawcn").renewFailures, 1);
});

// 5xx 是可能自己好的失败：首败只记 unknown，连续三次才认定要重新登录。
test("cookie 续期连续 3 次 5xx 才转 needsLogin", async () => {
  const chromeApi = fakeChrome("sess");
  const store = fakeStore();
  const request = fakeFetch({ [REFRESH_URL]: { status: 500, body: {} } });
  const run = () => renewStationAuth(CLAW, COOKIE_RENEWAL, { chrome: chromeApi, fetch: request, now: () => NOW, ...store });

  assert.equal((await run()).status, "needsLogin");
  assert.equal(store.data.get("clawcn").status, "unknown");
  assert.equal(store.data.get("clawcn").renewFailures, 1);
  await run();
  assert.equal(store.data.get("clawcn").status, "unknown");
  assert.equal(store.data.get("clawcn").renewFailures, 2);
  await run();
  assert.equal(store.data.get("clawcn").status, "needsLogin");
  assert.equal(store.data.get("clawcn").renewFailures, 3);
});

test("refresh-token 续期带上 origin，401 只重试一次", async () => {
  const chromeApi = fakeChrome();
  const store = fakeStore();
  await store.setCredential("kelaode", { token: "", refreshToken: "rt-old" });
  const rules = [];
  chromeApi.declarativeNetRequest.updateSessionRules = async ({ addRules = [] }) => {
    if (addRules.length) rules.push(addRules[0]);
  };
  const request = fakeFetch({
    "https://kelaode.com/api/v1/auth/refresh": () => ({ status: 401, body: {} })
  });

  const result = await renewStationAuth(
    { id: "kelaode", baseUrl: "https://kelaode.com/" },
    { kind: "refresh-token", refreshPath: "/api/v1/auth/refresh", refreshTokenPath: "data.refresh_token", expiresInPath: "data.expires_in" },
    { chrome: chromeApi, fetch: request, now: () => NOW, ...store }
  );

  assert.equal(result.status, "needsLogin");
  assert.equal(request.calls.length, 2);
  assert.equal(rules[0].condition.urlFilter, "||kelaode.com/api/v1/auth/refresh");
  assert.ok(rules[0].action.requestHeaders.some(header => header.header === "origin" && header.value === "https://kelaode.com"));
  assert.equal(request.calls[0].options.body, JSON.stringify({ refresh_token: "rt-old" }));
});

test("refresh-token 成功时同时换掉 access 与 refresh", async () => {
  const chromeApi = fakeChrome();
  const store = fakeStore();
  await store.setCredential("kelaode", { token: "", refreshToken: "rt-old" });
  const request = fakeFetch({
    "https://kelaode.com/api/v1/auth/refresh": { status: 200, body: { data: { access_token: "at-new", refresh_token: "rt-new", expires_in: 3600 } } }
  });

  const result = await renewStationAuth(
    { id: "kelaode", baseUrl: "https://kelaode.com/" },
    { kind: "refresh-token", refreshPath: "/api/v1/auth/refresh", refreshTokenPath: "data.refresh_token", expiresInPath: "data.expires_in" },
    { chrome: chromeApi, fetch: request, now: () => NOW, ...store }
  );

  assert.equal(result.status, "ok");
  assert.equal(store.data.get("kelaode").token, "at-new");
  assert.equal(store.data.get("kelaode").refreshToken, "rt-new");
  assert.equal(store.data.get("kelaode").expiresAt, NOW + 3600 * 1000 - 60000);
});

test("仓里 token 还没过期就不打接口", async () => {
  const chromeApi = fakeChrome();
  const store = fakeStore();
  const request = fakeFetch({ "*": { status: 500, body: {} } });

  const result = await renewStationAuth(CLAW, COOKIE_RENEWAL, {
    chrome: chromeApi,
    fetch: request,
    now: () => NOW,
    ...store,
    credential: { token: "still-good", expiresAt: NOW + 60000 }
  });

  assert.equal(result.status, "ok");
  assert.equal(result.cached, true);
  assert.equal(request.calls.length, 0);
});

test("session-probe 只判存亡，ok 时按探活 TTL 记过期", async () => {
  const chromeApi = fakeChrome();
  const store = fakeStore();
  const request = fakeFetch({ "https://cun.ai/api/user/self": { status: 200, body: { data: { id: 1 } } } });

  const result = await renewStationAuth(
    { id: "cun", baseUrl: "https://cun.ai/pricing" },
    { kind: "session-probe", probePath: "/api/user/self", probeTtlMs: 7200000 },
    { chrome: chromeApi, fetch: request, now: () => NOW, ...store }
  );

  assert.equal(result.status, "ok");
  assert.equal(result.expiresAt, NOW + 7200000);
  assert.equal(request.calls[0].options.credentials, "include");
  assert.equal(store.data.get("cun").status, "ok");
});

test("session-probe 撞 401 判 needsLogin，不清掉已有 token", async () => {
  const chromeApi = fakeChrome();
  const store = fakeStore();
  await store.setCredential("cun", { token: "keep-me" });
  const request = fakeFetch({ "https://cun.ai/api/user/self": { status: 401, body: {} } });

  const result = await renewStationAuth(
    { id: "cun", baseUrl: "https://cun.ai/pricing" },
    { kind: "session-probe", probePath: "/api/user/self" },
    { chrome: chromeApi, fetch: request, now: () => NOW, ...store }
  );

  assert.equal(result.status, "needsLogin");
  assert.equal(store.data.get("cun").token, "keep-me");
  assert.equal(store.data.get("cun").renewFailures, 1);
});

test("manual-token 不联网，永不过期；没有令牌就判 needsLogin", async () => {
  const chromeApi = fakeChrome();
  const store = fakeStore();
  const request = fakeFetch({ "*": { status: 500, body: {} } });

  const withToken = await renewStationAuth({ id: "self-hosted", baseUrl: "https://relay.example/" },
    { kind: "manual-token" }, { chrome: chromeApi, fetch: request, now: () => NOW, ...store, credential: { token: "sk-long" } });
  const without = await renewStationAuth({ id: "self-hosted-2", baseUrl: "https://relay2.example/" },
    { kind: "manual-token" }, { chrome: chromeApi, fetch: request, now: () => NOW, ...store });

  assert.equal(withToken.status, "ok");
  assert.equal(withToken.expiresAt, null);
  assert.equal(without.status, "needsLogin");
  assert.equal(request.calls.length, 0);
});

test("没有 renewal 声明时判 needsLogin，不联网", async () => {
  const chromeApi = fakeChrome();
  const store = fakeStore();
  const request = fakeFetch({ "*": { status: 200, body: {} } });

  const result = await renewStationAuth(CLAW, {}, { chrome: chromeApi, fetch: request, now: () => NOW, ...store });

  assert.equal(result.status, "needsLogin");
  assert.equal(request.calls.length, 0);
});

// uid 还没进仓时（刚装扩展、还没跑过一次页面采集），探活只会拿到 401。
// 这时候要报 unknown，不能把好好的登录态标成 needsLogin，也不能算一次失败。
test("探活头引用的字段还没进仓就跳过探活，判 unknown 且不计失败", async () => {
  const store = fakeStore();
  store.data.set("yuki", { status: "unknown", renewFailures: 0 });
  const fetch = fakeFetch({ "*": { status: 200, body: {} } });
  const result = await renewStationAuth(
    { id: "yuki", baseUrl: "https://yukiapi.com/" },
    { kind: "session-probe", probePath: "/api/user/self", probeHeaders: { "New-Api-User": "{{identity}}" } },
    { chrome: fakeChrome(), fetch, now: () => NOW, ...store }
  );
  assert.equal(result.status, "unknown");
  assert.equal(result.skipped, "identity");
  assert.equal(fetch.calls.length, 0, "缺字段时不该发请求");
  assert.equal(store.data.get("yuki").renewFailures, 0, "跳过不算失败");
});

test("uid 进仓后探活带上 New-Api-User 头，200 判 ok", async () => {
  const store = fakeStore();
  store.data.set("yuki", { identity: "42", status: "unknown", renewFailures: 0 });
  const fetch = fakeFetch({ "https://yukiapi.com/api/user/self": { status: 200, body: { success: true } } });
  const result = await renewStationAuth(
    { id: "yuki", baseUrl: "https://yukiapi.com/" },
    { kind: "session-probe", probePath: "/api/user/self", probeHeaders: { "New-Api-User": "{{identity}}" } },
    { chrome: fakeChrome(), fetch, now: () => NOW, ...store }
  );
  assert.equal(result.status, "ok");
  assert.equal(fetch.calls[0].options.headers["New-Api-User"], "42");
  assert.equal(fetch.calls[0].options.credentials, "include");
});

// 页面采集时顺手把 uid 报上来，之后就不用再为了判存亡开标签页。
test("页面只报 identity 也落仓，且不清掉已有 token", async () => {
  const store = fakeStore();
  store.data.set("cun", { token: "keep-me", username: "u", password: "p" });
  const saved = await applyPageRenewal(
    { stationId: "cun", identity: "7" },
    { chrome: fakeChrome(), now: () => NOW, ...store }
  );
  assert.equal(saved.identity, "7");
  assert.equal(store.data.get("cun").identity, "7");
  assert.equal(store.data.get("cun").token, "keep-me");
  // uid 到手不代表会话还活着，别顺手把状态写成 ok。
  assert.equal(store.data.get("cun").status ?? "unknown", "unknown");
});

test("identity-only 走真实凭据仓也不清 token（不经 deps 注入）", async () => {
  const chrome = fakeStorageChrome();
  await setStationCredential("cun", { token: "keep-me", username: "u", password: "p" }, chrome);
  await applyPageRenewal({ stationId: "cun", identity: "7" }, { chrome, now: () => NOW });
  const stored = await getStationCredential("cun", chrome);
  assert.equal(stored.token, "keep-me");
  assert.equal(stored.identity, "7");
  assert.equal(stored.username, "u");
  assert.equal(stored.password, "p");
});

test("页面换到新 token 时不清掉已存的用户名密码", async () => {
  const chrome = fakeStorageChrome();
  await setStationCredential("cun", { token: "old", username: "u", password: "p" }, chrome);
  await applyPageRenewal({ stationId: "cun", accessToken: "new", expiresAt: NOW + 60000 }, { chrome, now: () => NOW });
  const stored = await getStationCredential("cun", chrome);
  assert.equal(stored.token, "new");
  assert.equal(stored.username, "u");
  assert.equal(stored.password, "p");
});

test("并发续期时每站的 DNR 规则 id 互不冲突", async () => {
  const active = new Set();
  const chromeApi = {
    cookies: { get: async () => ({ value: "s" }) },
    declarativeNetRequest: {
      updateSessionRules: async ({ removeRuleIds = [], addRules = [] }) => {
        for (const rule of addRules) {
          assert.equal(active.has(rule.id), false, `规则 ${rule.id} 撞号了`);
          active.add(rule.id);
        }
        for (const id of removeRuleIds) active.delete(id);
      }
    },
    tabs: { create: async () => { throw new Error("续期过程不该创建标签页"); } }
  };
  const store = fakeStore();
  const request = fakeFetch({ "*": { status: 200, body: { data: { access_token: "t", access_expires_at: 1800000600 } } } });

  const stations = ["s1", "s2", "s3", "s4"].map(id => ({ id, baseUrl: `https://${id}.example/pricing` }));
  const results = await Promise.all(stations.map(station => renewStationAuth(station, COOKIE_RENEWAL, {
    chrome: chromeApi, fetch: request, now: () => NOW, ...store
  })));

  assert.deepEqual(results.map(result => result.status), ["ok", "ok", "ok", "ok"]);
  assert.equal(new Set(stations.map(station => cookieAuthRuleId(station.id))).size, stations.length);
  assert.equal(active.size, 0);
});

test("normalizeRenewal 收敛非法值，未知 kind 退成空", () => {
  const config = normalizeRenewal({ kind: "telepathy", probeTtlMs: -5, accessTokenPath: "" });
  assert.deepEqual(RENEWAL_KINDS, ["cookie", "refresh-token", "session-probe", "manual-token"]);
  assert.equal(config.kind, "");
  assert.equal(config.probeTtlMs, 6 * 60 * 60 * 1000);
  assert.equal(config.accessTokenPath, "data.access_token");
  assert.match(config.missingMessage, /登录/);
});

test("readRenewalPath 按点号取值，断链返回 undefined", () => {
  assert.equal(readRenewalPath({ data: { access_token: "x" } }, "data.access_token"), "x");
  assert.equal(readRenewalPath({ data: null }, "data.access_token"), undefined);
  assert.equal(readRenewalPath({}, ""), undefined);
});

test("页面回报的续期结果落仓：token 与过期时间一起写，失败计数清零", async () => {
  const store = fakeStore();
  store.data.set("cun", { token: "old", renewFailures: 3, status: "needsLogin" });

  const result = await applyPageRenewal(
    { stationId: "cun", accessToken: "fresh-token", expiresAt: 1800000600000, refreshToken: "rt-9" },
    { now: () => NOW, ...store }
  );

  assert.deepEqual(result, { stationId: "cun", expiresAt: 1800000600000 });
  const saved = store.data.get("cun");
  assert.equal(saved.token, "fresh-token");
  assert.equal(saved.expiresAt, 1800000600000);
  assert.equal(saved.refreshToken, "rt-9");
  assert.equal(saved.renewFailures, 0);
  assert.equal(saved.status, "ok");
  assert.equal(saved.lastRenewedAt, NOW);
});

test("页面回报缺 stationId 或令牌一律不落仓，避免污染别的站", async () => {
  const store = fakeStore();
  store.data.set("cun", { token: "keep" });

  assert.equal(await applyPageRenewal({ accessToken: "x" }, { ...store }), null);
  assert.equal(await applyPageRenewal({ stationId: "cun", accessToken: "   " }, { ...store }), null);
  assert.equal(await applyPageRenewal({ stationId: "cun" }, { ...store }), null);
  assert.equal(await applyPageRenewal(null, { ...store }), null);
  assert.equal(store.data.get("cun").token, "keep");
});

test("页面回报没有过期时间就存 null，不做瞎猜", async () => {
  const store = fakeStore();
  await applyPageRenewal({ stationId: "yuki", accessToken: "t", expiresAt: "not-a-number" }, { now: () => NOW, ...store });
  assert.equal(store.data.get("yuki").expiresAt, null);
  assert.equal(store.data.get("yuki").status, "ok");
});


// ── D4：新增一个需登录站只加插件目录 ──────────────────────────────────────
// fixture 在插件仓的 .fixtures/fake-login/（manifest.json + plugin.js + models.json），
// 跟真插件目录结构一模一样，只是点前缀让 scripts/plugin-build.mjs 的 listPlugins() 跳过，
// 所以它不进 plugins.json、不进 registry-snapshot、不出现在站点列表。
const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PLUGIN_DIR = path.resolve(process.env.PLUGIN_DIR || path.join(APP_ROOT, "..", "plugins"));
const FIXTURE_DIR = path.join(PLUGIN_DIR, ".fixtures", "fake-login");

// 插件源码写的是 @app/... 这类扩展核心导入，构建器把它改写成扩展内相对路径
// （scripts/plugin-build.mjs 的 rewriteImports）。这里照同一条规则改写后落到临时目录，
// 目的就是让测试读的是插件仓库里那份真源码，而不是测试自己另抄一份。
async function loadFixturePlugin() {
  const source = readFileSync(path.join(FIXTURE_DIR, "plugin.js"), "utf8");
  // 临时模块必须落在扩展目录里：src/ 在 D 盘、系统临时目录在 C 盘，
  // 跨盘符算不出相对路径，import 会变成一个不存在的绝对路径。
  const tmpRoot = path.join(APP_ROOT, ".tmp");
  mkdirSync(tmpRoot, { recursive: true });
  const dir = mkdtempSync(path.join(tmpRoot, "renewal-fixture-"));
  const file = path.join(dir, "plugin.mjs");
  const toSrc = path.relative(dir, path.join(APP_ROOT, "src")).split(path.sep).join("/");
  const specifier = toSrc.startsWith(".") ? toSrc : `./${toSrc}`;
  writeFileSync(file, source.replace(/(["'])@app\//g, `$1${specifier}/`), "utf8");
  try {
    return (await import(pathToFileURL(file).href)).sitePlugin;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function scanForLiteral(dir, literal) {
  const hits = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) { hits.push(...scanForLiteral(full, literal)); continue; }
    if (!entry.endsWith(".js")) continue;
    if (readFileSync(full, "utf8").includes(literal)) hits.push(full);
  }
  return hits;
}

test("假站只靠插件目录里的声明就能续期，token 落仓且全程不开标签页", async () => {
  const plugin = await loadFixturePlugin();
  assert.equal(plugin.id, "fake-login");

  const renewal = renewalFromProvider({ request: plugin.request });
  assert.ok(renewal, "插件声明应当能直接换算成无头续期配置");
  assert.equal(renewal.kind, "cookie");
  assert.equal(renewal.refreshPath, "/api/user/auth/refresh");
  assert.equal(renewal.cookieName, "fake_session");

  const chromeApi = fakeChrome("fixture-session");
  const store = fakeStore();
  const request = fakeFetch({
    "https://fake-login.invalid/api/user/auth/refresh": { status: 200, body: { data: { access_token: "fixture-at", access_expires_at: 1800000600 } } }
  });

  const result = await renewStationAuth({ id: "fake-login", baseUrl: "https://fake-login.invalid/" }, renewal, { chrome: chromeApi, fetch: request, now: () => NOW, ...store });

  assert.equal(result.status, "ok");
  assert.equal(result.token, "fixture-at");
  assert.equal(store.data.get("fake-login").token, "fixture-at");
  // 站点报的是秒的绝对时间戳 1800000600，落仓时统一减一分钟余量，避免刚写完就判过期。
  assert.equal(store.data.get("fake-login").expiresAt, 1800000540000);
  assert.equal(chromeApi.rules.size, 0, "临时 header 规则必须清掉");
  assert.equal(chromeApi.tabCreates(), 0);
});

test("假站 fixture 不占真插件的位置：extension/src 里找不到它", async () => {
  // 这条是 D4 的硬保证：如果哪天有人在 src/ 里给这个站补了手写分支，
  // 「只加插件目录」就不再成立，这里立刻红。
  const hits = scanForLiteral(path.join(APP_ROOT, "src"), "fake-login");
  assert.deepEqual(hits, [], `src/ 里不该出现假站的字面量：${hits.join(", ")}`);
});

test("插件两样都没声明就不排无头任务，交回原来的页面路径", () => {
  assert.equal(renewalFromProvider({ request: {} }), null);
  assert.equal(renewalFromProvider({ request: { cookieAuth: { cookieName: "x" } } }), null);
  assert.equal(renewalFromProvider(undefined), null);
});
