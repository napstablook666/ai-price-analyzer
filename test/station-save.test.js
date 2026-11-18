import assert from "node:assert/strict";
import nodeTest from "node:test";
import { mergeStationSave } from "../src/core/station-save.js";

const test = (name, fn) => nodeTest(name, { concurrency: false }, fn);
const station = (id, extra = {}) => ({ id, baseUrl: `https://${id}.example.com`, enabled: true, ...extra });

test("传入数组里缺席的站点保留：页面快照过期不会误删", () => {
  const current = [station("a"), station("b")];
  const merged = mergeStationSave(current, [station("a", { enabled: false })], []);
  assert.deepEqual(merged.map(item => item.id), ["a", "b"]);
  assert.equal(merged[0].enabled, false);
  assert.equal(merged[1].enabled, true);
});

test("显式名单里的站点被删掉", () => {
  const merged = mergeStationSave([station("a"), station("b")], [station("a")], ["b"]);
  assert.deepEqual(merged.map(item => item.id), ["a"]);
});

test("新增站点追加到末尾，原有顺序不变", () => {
  const merged = mergeStationSave([station("a"), station("b")], [station("b"), station("c")], []);
  assert.deepEqual(merged.map(item => item.id), ["a", "b", "c"]);
});

test("同一个 id 既在新增名单又在删除名单，按删除算", () => {
  const merged = mergeStationSave([station("a")], [station("b")], ["b"]);
  assert.deepEqual(merged.map(item => item.id), ["a"]);
});

test("库里没有的新站点正常写入", () => {
  const merged = mergeStationSave([], [station("x")], []);
  assert.deepEqual(merged.map(item => item.id), ["x"]);
});

test("入参不是数组时不抛异常", () => {
  assert.deepEqual(mergeStationSave(undefined, undefined, undefined), []);
  assert.deepEqual(mergeStationSave(null, [station("a")], null).map(item => item.id), ["a"]);
});

test("删除名单里的空字符串与空白不当作 id", () => {
  const merged = mergeStationSave([station("a")], [], ["", "  ", null]);
  assert.deepEqual(merged.map(item => item.id), ["a"]);
});
