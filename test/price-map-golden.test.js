// 映射与快照之间的一致性检查。
//
// 三件事：
// 1. 每个 base 走一遍自己的 fixture，结果要和 test/golden/ 里那份逐行一致。
// 2. 每个 base 要么有 fixture，要么在已知豁免名单里。新加站点不能悄悄没人验证。
// 3. 声明相对基准 base 的差异键要有个上限。差值一直涨说明那个站不是在复用形状，
//    是在往声明里硬塞字段；超过上限就该停下来考虑写 strategy。

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { PRICE_MAP_BASES, priceMapDiffKeys } from "../src/core/price-maps/index.js";
import {
  GOLDEN_CASES,
  renderGolden,
  goldenPath,
  caseName,
  NO_FIXTURE_YET as NO_FIXTURE_YET_REASONS
} from "../scripts/price-map-golden.mjs";

// 还没补 fixture 的 base 只在 scripts/price-map-golden.mjs 里声明一次（连理由一起），
// 这里和 scripts/guard-coverage.mjs 都读那一份，别各抄一个名单。
const NO_FIXTURE_YET = new Set(Object.keys(NO_FIXTURE_YET_REASONS));

// 和 tokenflux 比，差异键最多这么几个。全是 1 的时候调这个数才是对的。
const MAX_DIFF_KEYS = 4;

const BASE_OF_FIXTURE = new Map(GOLDEN_CASES.map(item => [item.base, item.fixture]));
const label = item => caseName(item);

test("每份 golden 与当前映射一致", () => {
  for (const item of GOLDEN_CASES) {
    // 快照比的是内容，换行风格不算改动（Windows 签出是 CRLF，生成的是 LF）。
    const expected = readFileSync(goldenPath(label(item)), "utf8").replace(/\r\n/g, "\n");
    assert.equal(
      renderGolden(item),
      expected,
      `${label(item)} 的产出变了。确认是新行为就 node scripts/price-map-golden.mjs --update`
    );
  }
});

test("fixture 的未解析模型必须与明确记录的已知缺口完全一致", () => {
  for (const item of GOLDEN_CASES) {
    const text = renderGolden(item);
    const summary = text.split("\n").find(line => line.startsWith("# rows:")) || "";
    const count = Number((summary.match(/unresolved: (\d+)/) || [])[1]);
    const expected = item.expectedUnresolved || [];
    const misses = (text.split("# unresolved\n")[1] || "").trim().split("\n").filter(Boolean).map(line => line.split("=")[0]);
    assert.equal(count, expected.length, `${caseName(item)} 未解析模型数量变了`);
    assert.deepEqual(misses.sort(), [...expected].sort(), `${caseName(item)} 已知缺口外不能静默丢价`);
  }
});

test("价格字段里不许出现 NaN", () => {
  for (const item of GOLDEN_CASES) {
    const body = renderGolden(item)
      .split("\n")
      .filter(line => line && !line.startsWith("#"));
    for (const line of body) {
      assert.ok(!/NaN|Infinity/.test(line), `${item.base} 出现非法数值：${line}`);
    }
  }
});

test("每个 base 都有 fixture 或者被明确豁免", () => {
  const missing = Object.keys(PRICE_MAP_BASES).filter(
    base => !BASE_OF_FIXTURE.has(base) && !NO_FIXTURE_YET.has(base)
  );
  assert.deepEqual(missing, [], `这些 base 没有 fixture，补一份再把名字从 NO_FIXTURE_YET 删掉：${missing.join(", ")}`);
});

test("豁免名单里不许留着已经有 fixture 的 base", () => {
  const stale = [...NO_FIXTURE_YET].filter(base => BASE_OF_FIXTURE.has(base));
  assert.deepEqual(stale, [], `这些已经有 fixture 了，从 NO_FIXTURE_YET 里删掉：${stale.join(", ")}`);
});

test("声明相对基准 base 的差异不该持续膨胀", () => {
  const tooFar = [];
  for (const base of Object.keys(PRICE_MAP_BASES)) {
    if (base === "tokenflux") continue;
    const keys = priceMapDiffKeys({ base: "tokenflux", source: base });
    if (keys.length > MAX_DIFF_KEYS) tooFar.push(`${base}: ${keys.length} 个键（${keys.join(", ")}）`);
  }
  assert.deepEqual(tooFar, [], `差异太大，这个站可能该写 strategy 而不是塞声明：\n${tooFar.join("\n")}`);
});
