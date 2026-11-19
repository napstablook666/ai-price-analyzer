import test from "node:test";
import assert from "node:assert/strict";
import { LEGACY_RESPONSE_FORMATS, RESPONSE_FORMAT_DEFINITIONS, isSupportedResponseFormat, migrateStationAdapter } from "../src/core/response-formats.js";
import { resolvePriceMap } from "../src/core/price-maps/index.js";
import { normalizeStation } from "../src/shared/schema.js";

const LEGACY_KEYS = Object.keys(LEGACY_RESPONSE_FORMATS);

test("退役的 responseFormat 已经不在枚举表里，且都指向现存的格式", () => {
  assert.ok(LEGACY_KEYS.length > 0);
  for (const key of LEGACY_KEYS) {
    assert.equal(isSupportedResponseFormat(key), false, `${key} 还留在 RESPONSE_FORMAT_DEFINITIONS 里`);
    const legacy = LEGACY_RESPONSE_FORMATS[key];
    assert.ok(RESPONSE_FORMAT_DEFINITIONS[legacy.format], `${key} 迁到了不存在的格式 ${legacy.format}`);
  }
});

test("退役表指向的价格映射必须还在，删了 map 文件这里就红", () => {
  for (const key of LEGACY_KEYS) {
    const resolved = resolvePriceMap(LEGACY_RESPONSE_FORMATS[key].priceMap);
    assert.equal(resolved.error, undefined, `${key}: ${resolved.error}`);
    assert.ok(resolved.map.rules.length, `${key} 解析出的映射没有 rules`);
  }
});

test("migrateStationAdapter 幂等，不覆盖站点自己写的 priceMap", () => {
  const once = migrateStationAdapter({ responseFormat: "newcodex" });
  assert.equal(once.responseFormat, "price-map");
  // 倍率基准已经写在 tokenflux 映射里，newcodex 退化成「同一份声明」，不再带自己的常数。
  assert.deepEqual(once.priceMap, { base: "tokenflux" });
  assert.deepEqual(migrateStationAdapter(once), once);

  const custom = migrateStationAdapter({ responseFormat: "allrouter", priceMap: { base: "tokenflux", source: "x" } });
  assert.deepEqual(custom.priceMap, { base: "tokenflux", source: "x" });

  const stored = { responseFormat: "tokenflux" };
  assert.equal(migrateStationAdapter(stored), stored);
});

test("normalizeStation 把存储里的旧值就地换掉，再归一化不再变", () => {
  for (const key of LEGACY_KEYS) {
    const station = normalizeStation({ baseUrl: "https://example.com", adapter: { responseFormat: key } });
    assert.equal(station.adapter.responseFormat, "price-map");
    assert.deepEqual(station.adapter.priceMap, LEGACY_RESPONSE_FORMATS[key].priceMap);
    const again = normalizeStation(station);
    assert.deepEqual(again.adapter, station.adapter);
  }
});
