import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildComparisonRows, pickPrimaryOfficial } from "../src/core/pricing.js";
import { buildChartGroups, deltaTone } from "../src/dashboard-index.js";

const USAGE = { input: 1_000_000, output: 1_000_000 };

function buildOffers({ references, models = [], station = {} }) {
  const base = { id: "tf", name: "TokenFlux", rechargeRate: 1, rechargeRateVerified: true, priceCurrencyVerified: true, ...station };
  const comparisons = buildComparisonRows({
    stations: [base],
    snapshots: [{ stationId: base.id, collectedAt: 1, status: "success", normalized: { data: models } }],
    references,
    usage: USAGE
  });
  return comparisons.flatMap(comparison => comparison.offers);
}

const FLASH_ITEM = { model_name: "deepseek-v4.1-flash", input_price: 0.07, output_price: 0.14, price_currency: "CREDITS" };

test("collapses several official candidates of one quote into a single offer", () => {
  const offers = buildOffers({
    models: [FLASH_ITEM],
    references: {
      models: [
        { name: "deepseek/deepseek-v4.1-flash-1017", provider: "deepseek", input: 0.0434, output: 0.3 },
        { name: "deepseek-v4.1-flash", provider: "deepseek", input: 0.09, output: 0.18 },
        { name: "deepseek/deepseek-v4.1-flash-1017:batch", provider: "deepseek", input: 0.048, output: 0.144 }
      ]
    }
  });

  assert.equal(offers.length, 1);
  const offer = offers[0];
  assert.equal(offer.officialCandidateCount, 3);
  assert.equal(offer.matchCandidateCount, 3);
  assert.equal(offer.officialName, "deepseek-v4.1-flash");
  assert.equal(offer.officialCandidates.length, 3);
  assert.equal(offer.officialCandidates[0].name, "deepseek-v4.1-flash");
  assert.equal(offer.diffPercent, offer.officialCandidates[0].diffPercent);
  assert.equal(offer.officialMonthlyCost, offer.officialCandidates[0].monthlyCost);
  assert.equal(offer.officialBlendedUnitPrice, offer.officialCandidates[0].officialBlendedUnitPrice);
  // 中转侧数值只累加一次，不应随候选数翻倍。
  assert.equal(offer.quotedPrices.input, 0.07);
});

test("keeps a single offer when the same model only matches one official entry", () => {
  const offers = buildOffers({
    models: [FLASH_ITEM],
    references: { models: [{ name: "deepseek-v4.1-flash", provider: "deepseek", input: 0.09, output: 0.18 }] }
  });
  assert.equal(offers.length, 1);
  assert.equal(offers[0].officialCandidateCount, 1);
});

test("pickPrimaryOfficial prefers the undecorated exact name, then the cheapest official", () => {
  const candidates = [
    { name: "m:batch", provider: "p", monthlyCost: 1 },
    { name: "m@eu", provider: "p", monthlyCost: 2 },
    { name: "m", provider: "p", monthlyCost: 3 }
  ];
  assert.equal(pickPrimaryOfficial(candidates, "m").name, "m");

  assert.equal(pickPrimaryOfficial([{ name: "m:batch", monthlyCost: 1 }, { name: "m-v2", monthlyCost: 9 }], "m").name, "m:batch");

  assert.equal(pickPrimaryOfficial([{ name: "m-1017", monthlyCost: 1 }, { name: "m-1018", monthlyCost: 9 }], "m").name, "m-1017");

  // 全部带装饰时退化到官方月成本最低的那条。
  assert.equal(pickPrimaryOfficial([{ name: "m:batch", monthlyCost: 9 }, { name: "m@eu", monthlyCost: 1 }], "m").name, "m@eu");

  assert.equal(pickPrimaryOfficial([], "m"), null);
});

test("buildChartGroups groups by canonical model, normalizes bars and excludes public stations", () => {
  const row = (overrides) => ({
    canonicalModel: "m1",
    displayName: "M1",
    provider: "openai",
    stationId: "a",
    stationName: "A",
    stationCategory: "paid",
    blendedUnitPrice: 1,
    officialBlendedUnitPrice: 4,
    diffPercent: -75,
    category: "excellent",
    pricingUnavailable: false,
    ...overrides
  });
  const rows = [
    row({}),
    row({ stationId: "b", stationName: "B", blendedUnitPrice: 2 }),
    row({ stationId: "c", stationName: "C", blendedUnitPrice: 8 }),
    row({ stationId: "p", stationName: "P", stationCategory: "public", blendedUnitPrice: 0.5 }),
    row({ stationId: "u", stationName: "U", pricingUnavailable: true, blendedUnitPrice: null }),
    row({ canonicalModel: "m2", displayName: "M2", stationId: "a", blendedUnitPrice: 3, officialBlendedUnitPrice: 3, diffPercent: 0 })
  ];

  const { groups, totalGroups } = buildChartGroups(rows);
  assert.equal(totalGroups, 2);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].canonicalModel, "m1");
  assert.deepEqual(groups[0].bars.map(bar => bar.stationId), ["a", "b", "c"]);
  // 轨道满格 = 组内最贵的一站；官方价比满格还贵时不给参考线位置
  assert.deepEqual(groups[0].bars.map(bar => bar.widthPercent), [12.5, 25, 100]);
  assert.equal(groups[0].officialLeftPercent, 50);
  assert.equal(groups[1].officialLeftPercent, 100);
  assert.equal(groups[1].bars[0].widthPercent, 100);
  assert.equal(groups[0].officialBlendedUnitPrice, 4);
  const aboveTrack = buildChartGroups([row({ blendedUnitPrice: 1, officialBlendedUnitPrice: 40 })]);
  assert.equal(aboveTrack.groups[0].officialLeftPercent, null);

  const truncated = buildChartGroups(rows, { maxGroups: 1 });
  assert.equal(truncated.groups.length, 1);
  assert.equal(truncated.totalGroups, 2);
});

test("deltaTone maps price difference percentages to readable color levels", () => {
  assert.equal(deltaTone(null), "neutral");
  assert.equal(deltaTone(0), "neutral");
  assert.equal(deltaTone(-0.004), "neutral");
  assert.equal(deltaTone(-94.12), "excellent");
  assert.equal(deltaTone(-40), "good");
  assert.equal(deltaTone(-10), "good");
  assert.equal(deltaTone(-2), "fair");
  assert.equal(deltaTone(20), "fair");
  assert.equal(deltaTone(50), "fair");
  assert.equal(deltaTone(50.01), "bad");
});

test("dashboard drops the paid recommendation column and keeps one delta sort option", () => {
  const html = readFileSync(new URL("../dashboard.html", import.meta.url), "utf8");
  const script = readFileSync(new URL("../src/dashboard.js", import.meta.url), "utf8");
  const header = html.match(/<thead>[\s\S]*?<\/thead>/)?.[0] || "";
  assert.equal(header.includes(">推荐</th>"), false);
  assert.match(header, /data-sort-keys="diffPercent">价差<\/th>/);
  const secondary = html.match(/<select id="sort-secondary">[\s\S]*?<\/select>/)?.[0] || "";
  assert.equal((secondary.match(/value="diffPercent"/g) || []).length, 1);
  assert.equal(script.includes('data-label="推荐"'), false);
  assert.match(script, /data-label="价差"/);
});

test("dashboard folds official matching into one confidence detail control", () => {
  const script = readFileSync(new URL("../src/dashboard.js", import.meta.url), "utf8");
  const css = readFileSync(new URL("../styles/dashboard.css", import.meta.url), "utf8");
  assert.match(script, /function modelMatchMarkup\(row, currency\)/);
  assert.match(script, /<details class="model-match-details">/);
  assert.match(script, /<summary class="confidence-tag"/);
  assert.match(script, /const officialNote = !isPublic \? modelMatchMarkup\(row, currency\) : ""/);
  assert.match(script, /官方候选（\$\{candidates\.length\}）/);
  assert.equal(script.includes('class="official-name"'), false);
  assert.equal(script.includes('class="candidate-tag"'), false);
  assert.match(css, /\.model-match-details:hover \.model-match-popover/);
  assert.match(css, /\.model-match-details\[open\] \.model-match-popover/);
  assert.match(script, /function closeModelMatchDetails\(except = null\)/);
  assert.match(script, /document\.addEventListener\("click", event => \{\s*closeModelMatchDetails\(event\.target\.closest\("\.model-match-details"\)\);/);
  assert.match(script, /document\.addEventListener\("mouseout", event =>/);
  assert.match(script, /details\.contains\(event\.relatedTarget\)/);
});