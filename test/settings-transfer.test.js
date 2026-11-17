import test from "node:test";
import assert from "node:assert/strict";
import { buildSettingsExport, parseSettingsExport } from "../src/core/settings-transfer.js";

const settings = { comparisonMode: "paid", interval: 30, modelAssistant: { baseUrl: "https://x", model: "m", apiKey: "sk-secret" } };
const stations = [{ id: "a", name: "站点 A", auth: { type: "token", token: "t-1", username: "u", password: "p" } }];

test("导出带格式标记和导出时间", () => {
  const payload = buildSettingsExport({ settings, stations, now: () => Date.parse("2026-11-20T00:00:00Z") });
  assert.equal(payload.format, "apa-settings");
  assert.equal(payload.version, 1);
  assert.equal(payload.exportedAt, "2026-11-20T00:00:00.000Z");
});

test("导出不写密钥", () => {
  const payload = buildSettingsExport({ settings, stations });
  assert.equal(payload.settings.modelAssistant.apiKey, undefined);
  assert.equal(payload.settings.modelAssistant.model, "m");
  assert.equal(payload.stations[0].auth.token, "");
  assert.equal(payload.stations[0].auth.type, "token");
});

test("导入清掉残留的凭据", () => {
  const parsed = parseSettingsExport(JSON.stringify({
    format: "apa-settings",
    version: 1,
    settings: { modelAssistant: { apiKey: "leak" } },
    stations: [{ id: "a", auth: { type: "password", token: "t", username: "u", password: "p" } }]
  }));
  assert.equal(parsed.settings.modelAssistant.apiKey, undefined);
  assert.deepEqual(parsed.stations[0].auth, { type: "password", token: "", username: "", password: "" });
});

test("拒绝不是本扩展导出的文件", () => {
  assert.throws(() => parseSettingsExport('{"hello":1}'), /不是本扩展导出的配置文件/);
  assert.throws(() => parseSettingsExport("{"), 检测 => 检测 instanceof SyntaxError);
});

test("拒绝更高版本的配置文件", () => {
  assert.throws(
    () => parseSettingsExport({ format: "apa-settings", version: 9, settings: {}, stations: [] }),
    /更新的扩展版本/
  );
});
