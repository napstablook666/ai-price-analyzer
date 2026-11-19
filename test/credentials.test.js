import test from "node:test";
import assert from "node:assert/strict";
import {
  getModelAssistantKey,
  getStationCredential,
  removeStationCredential,
  setModelAssistantKey,
  setStationCredential
} from "../src/shared/credentials.js";

const TOKENS = "ai-price-analyzer:tokens";
const ASSISTANT_KEY = "ai-price-analyzer:model-assistant-key";

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
  assert.deepEqual(chromeApi.local.dump()[TOKENS], { "site-a": { token: "t-1", username: "", password: "" } });
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
  assert.deepEqual(await getStationCredential("site-a", chromeApi), { token: "legacy-token", username: "", password: "" });
});

test("三段全空的凭据等于删除，不留在存储里", async () => {
  const chromeApi = fakeChrome();
  await setStationCredential("site-a", { token: "t" }, chromeApi);
  await removeStationCredential("site-a", chromeApi);
  assert.deepEqual(chromeApi.local.dump()[TOKENS], {});
  assert.deepEqual(await getStationCredential("site-a", chromeApi), { token: "", username: "", password: "" });
});

test("没有 chrome 时不炸，读走默认值、写静默跳过", async () => {
  await setStationCredential("site-a", { token: "t" }, {});
  await setModelAssistantKey("sk-1", {});
  assert.deepEqual(await getStationCredential("site-a", {}), { token: "", username: "", password: "" });
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
