import test from "node:test";
import assert from "node:assert/strict";
import {
  clearStationRenewal,
  getModelAssistantKey,
  getStationCredential,
  getStationRenewal,
  listStationRenewals,
  removeStationCredential,
  setModelAssistantKey,
  setStationCredential,
  setStationRenewal
} from "../src/shared/credentials.js";

const TOKENS = "ai-price-analyzer:tokens";
const ASSISTANT_KEY = "ai-price-analyzer:model-assistant-key";
const RENEWAL = { expiresAt: null, refreshToken: "", lastRenewedAt: null, renewFailures: 0, status: "unknown" };

// 最小 chrome.storage 替身：只实现真用到的 get/set/remove，
// 内容放内存 Map，dump() 用来断言最终落在哪个 area。
function fakeChrome() {
  const makeArea = () => {
    const data = new Map();
    return {
      get: async key => (data.has(key) ? { [key]: data.get(key) } : {}),
      set: async values => { for (const [key, value] of Object.entries(values)) data.set(key, value); },
      remove: async key => { data.delete(key); },
      dump: () => Object.fromEntries(data)
    };
  };
  const local = makeArea();
  const session = makeArea();
  return { storage: { local, session }, local, session };
}

test("凭据写 local，同时清掉 session 里的同名键", async () => {
  const chromeApi = fakeChrome();
  await chromeApi.session.set({ [TOKENS]: { "site-a": { token: "old" } } });
  await setStationCredential("site-a", { token: "t-1" }, chromeApi);
  assert.deepEqual(chromeApi.local.dump()[TOKENS], { "site-a": { token: "t-1", identity: "", username: "", password: "", ...RENEWAL } });
  assert.equal(TOKENS in chromeApi.session.dump(), false);
});

test("读凭据时 local 覆盖 session", async () => {
  const chromeApi = fakeChrome();
  await chromeApi.session.set({ [TOKENS]: { "site-a": { token: "session" } } });
  await chromeApi.local.set({ [TOKENS]: { "site-a": { token: "local" } } });
  assert.equal((await getStationCredential("site-a", chromeApi)).token, "local");
});

test("老格式的裸字符串凭据读出来补成三段", async () => {
  const chromeApi = fakeChrome();
  await chromeApi.local.set({ [TOKENS]: { "site-a": "legacy-token" } });
  assert.deepEqual(await getStationCredential("site-a", chromeApi), { token: "legacy-token", identity: "", username: "", password: "", ...RENEWAL });
});

test("三段全空的凭据等于删除，不留在存储里", async () => {
  const chromeApi = fakeChrome();
  await setStationCredential("site-a", { token: "t" }, chromeApi);
  await removeStationCredential("site-a", chromeApi);
  assert.deepEqual(chromeApi.local.dump()[TOKENS], {});
  assert.deepEqual(await getStationCredential("site-a", chromeApi), { token: "", identity: "", username: "", password: "", ...RENEWAL });
});

test("没有 chrome 时不炸，读走默认值、写静默跳过", async () => {
  await setStationCredential("site-a", { token: "t" }, {});
  await setModelAssistantKey("sk-1", {});
  assert.deepEqual(await getStationCredential("site-a", {}), { token: "", identity: "", username: "", password: "", ...RENEWAL });
  assert.equal(await getModelAssistantKey({}), "");
});

test("模型密钥写 local，首尾空白被裁掉", async () => {
  const chromeApi = fakeChrome();
  await setModelAssistantKey("  sk-abc  ", chromeApi);
  assert.equal(chromeApi.local.dump()[ASSISTANT_KEY], "sk-abc");
  assert.equal(await getModelAssistantKey(chromeApi), "sk-abc");
});

test("模型密钥传空等于清除", async () => {
  const chromeApi = fakeChrome();
  await setModelAssistantKey("sk-abc", chromeApi);
  await setModelAssistantKey("   ", chromeApi);
  assert.equal(ASSISTANT_KEY in chromeApi.local.dump(), false);
  assert.equal(await getModelAssistantKey(chromeApi), "");
});

test("模型密钥读的时候 session 优先", async () => {
  const chromeApi = fakeChrome();
  await chromeApi.session.set({ [ASSISTANT_KEY]: "sk-session" });
  await chromeApi.local.set({ [ASSISTANT_KEY]: "sk-local" });
  assert.equal(await getModelAssistantKey(chromeApi), "sk-session");
});

test("续期字段与三段凭据同键落盘，采集换 token 不冲掉 expiresAt", async () => {
  const chromeApi = fakeChrome();
  await setStationCredential("site-a", { token: "t-1" }, chromeApi);
  await setStationRenewal("site-a", { expiresAt: 1800000000000, status: "ok" }, chromeApi);
  await setStationCredential("site-a", { token: "t-2" }, chromeApi);
  const stored = chromeApi.local.dump()[TOKENS]["site-a"];
  assert.equal(stored.token, "t-2");
  assert.equal(stored.expiresAt, 1800000000000);
  assert.equal(stored.status, "ok");
});

test("只靠 cookie 的站也要能落续期状态", async () => {
  const chromeApi = fakeChrome();
  assert.deepEqual(await setStationRenewal("site-a", { status: "ok", expiresAt: 42 }, chromeApi), { ...RENEWAL, status: "ok", expiresAt: 42 });
  assert.deepEqual(chromeApi.local.dump()[TOKENS]["site-a"], { token: "", identity: "", username: "", password: "", ...RENEWAL, status: "ok", expiresAt: 42 });
});

test("getStationCredential 一次给出三段凭据加续期状态", async () => {
  const chromeApi = fakeChrome();
  await setStationCredential("site-a", { token: "t-1", username: "u", password: "p" }, chromeApi);
  await setStationRenewal("site-a", { expiresAt: 42, refreshToken: "rt", renewFailures: 2, status: "needsLogin" }, chromeApi);
  assert.deepEqual(await getStationCredential("site-a", chromeApi), {
    token: "t-1", identity: "", username: "u", password: "p", expiresAt: 42, refreshToken: "rt", lastRenewedAt: null, renewFailures: 2, status: "needsLogin"
  });
  assert.deepEqual(await getStationCredential("missing", chromeApi), { token: "", identity: "", username: "", password: "", ...RENEWAL });
});

test("旧格式读出来补齐续期默认值，存储里原样不动", async () => {
  const chromeApi = fakeChrome();
  await chromeApi.local.set({ [TOKENS]: { "site-a": { token: "t", username: "u", password: "p" } } });
  assert.equal((await getStationCredential("site-a", chromeApi)).status, "unknown");
  assert.deepEqual(chromeApi.local.dump()[TOKENS]["site-a"], { token: "t", username: "u", password: "p" });
});

test("非法 status 与负数续期计数收敛到默认值", async () => {
  const chromeApi = fakeChrome();
  await chromeApi.local.set({ [TOKENS]: { "site-a": { token: "t", status: "bogus", renewFailures: -2, expiresAt: "nope" } } });
  const renewal = await getStationCredential("site-a", chromeApi);
  assert.equal(renewal.status, "unknown");
  assert.equal(renewal.renewFailures, 0);
  assert.equal(renewal.expiresAt, null);
});

test("续期状态可单独读取，不连带凭据三段", async () => {
  const chromeApi = fakeChrome();
  await setStationCredential("site-a", { token: "t-1", username: "u" }, chromeApi);
  await setStationRenewal("site-a", { expiresAt: 1800000000000, status: "ok" }, chromeApi);
  assert.deepEqual(await getStationRenewal("site-a", chromeApi), {
    expiresAt: 1800000000000,
    refreshToken: "",
    lastRenewedAt: null,
    renewFailures: 0,
    status: "ok"
  });
  assert.equal((await getStationCredential("site-a", chromeApi)).username, "u");
});

test("没有续期记录的站读成默认值，不返回 undefined", async () => {
  const chromeApi = fakeChrome();
  assert.deepEqual(await getStationRenewal("never-saved", chromeApi), RENEWAL);
});

test("清续期只清续期，token 留着，下次采集还能用", async () => {
  const chromeApi = fakeChrome();
  await setStationCredential("site-a", { token: "t-1" }, chromeApi);
  await setStationRenewal("site-a", { expiresAt: 1800000000000, status: "ok", renewFailures: 4 }, chromeApi);
  await clearStationRenewal("site-a", chromeApi);
  assert.deepEqual(await getStationRenewal("site-a", chromeApi), RENEWAL);
  assert.equal((await getStationCredential("site-a", chromeApi)).token, "t-1");
  assert.deepEqual(await clearStationRenewal("no-such-station", chromeApi), RENEWAL);
});

test("一次列出全站续期状态，按站点名排序", async () => {
  const chromeApi = fakeChrome();
  await setStationRenewal("zeta", { status: "ok", expiresAt: 1800000000000 }, chromeApi);
  await setStationRenewal("alpha", { status: "needsLogin", renewFailures: 3 }, chromeApi);
  const rows = await listStationRenewals(chromeApi);
  assert.deepEqual(rows.map(row => row.stationId), ["alpha", "zeta"]);
  assert.equal(rows[0].status, "needsLogin");
  assert.equal(rows[0].renewFailures, 3);
  assert.equal(rows[1].expiresAt, 1800000000000);
});
