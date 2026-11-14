import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildComparisonRows, pickPrimaryOfficial } from "../src/core/pricing.js";
import { buildMonthlyCostRankings, deltaTone, monthlyCostBarWidth, monthlyCostRankingFor } from "../src/dashboard-index.js";

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
  assert.match(header, /data-sort-keys="diffPercent blendedUnitPrice">价差 \/ 混合单价<\/th>/);
  const secondary = html.match(/<select id="sort-secondary">[\s\S]*?<\/select>/)?.[0] || "";
  assert.equal((secondary.match(/value="diffPercent"/g) || []).length, 1);
  assert.equal(script.includes('data-label="推荐"'), false);
  assert.match(script, /data-label="价差 \/ 混合单价"/);
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
assert.match(script, /const matchDetails = event\.target\.closest\("\.model-match-details"\);/);
  assert.match(script, /closeModelMatchDetails\(matchDetails\)/);
  assert.match(script, /document\.addEventListener\("mouseout", event =>/);
  assert.match(script, /details\.contains\(event\.relatedTarget\)/);
assert.equal(script.includes('.monthly-cost-summary, .model-match-details > .confidence-tag'), true);
  assert.match(script, /matchDetails\.open = true;\s*\n\s*delete matchDetails\.dataset\.hoverOpen;/);
  assert.equal(css.includes('.model-match-popover::before'), true);
});


test("monthlyCostBarWidth uses one shared baseline and clamps overflow", () => {
  assert.equal(monthlyCostBarWidth(25, 100), 25);
  assert.equal(monthlyCostBarWidth(100, 100), 100);
  assert.equal(monthlyCostBarWidth(160, 100), 100);
  assert.equal(monthlyCostBarWidth(0, 100), 0);
  assert.equal(monthlyCostBarWidth(null, 100), null);
  assert.equal(monthlyCostBarWidth(20, 0), null);
  assert.equal(monthlyCostBarWidth(Number.NaN, 100), null);
  assert.ok(Math.abs(monthlyCostBarWidth(49.2392, 70.9523) - 49.2392 / 70.9523 * 100) < 1e-10);
});

test("monthly cost rankings use every filtered offer and keep the cheapest ten", () => {
  const rows = Array.from({ length: 12 }, (_, index) => ({
    canonicalModel: "model-a",
    monthlyCost: (12 - index) * 10,
    stationId: `a${index}`,
    stationName: `A${index}`
  }));
  rows.push(
    { canonicalModel: "model-a", monthlyCost: null, stationId: "unknown", stationName: "Unknown" },
    { canonicalModel: "model-b", monthlyCost: 5, stationId: "b0", stationName: "B0" },
    { canonicalModel: "model-b", monthlyCost: 5, stationId: "b1", stationName: "B1" }
  );
  const rankings = buildMonthlyCostRankings(rows);
  const highest = monthlyCostRankingFor(rows[0], rankings);
  assert.equal(highest.rank, 12);
  assert.equal(highest.total, 12);
  assert.equal(highest.baseline, 120);
  assert.equal(highest.top.length, 10);
  assert.deepEqual(highest.top.map(entry => entry.monthlyCost), [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
  assert.equal(monthlyCostRankingFor(rows[11], rankings).rank, 1);
  const unavailable = monthlyCostRankingFor(rows[12], rankings);
  assert.equal(unavailable.rank, null);
  assert.equal(unavailable.total, 12);
  assert.equal(unavailable.baseline, 120);
  assert.equal(unavailable.top.length, 10);
  assert.equal(monthlyCostRankingFor(rows[13], rankings).rank, 1);
  assert.equal(monthlyCostRankingFor(rows[14], rankings).rank, 1);
  assert.equal(monthlyCostRankingFor(rows[14], rankings).total, 2);
  assert.equal(monthlyCostRankingFor(rows[14], rankings).baseline, 5);
  assert.equal(monthlyCostBarWidth(40, 100), 40);
  assert.equal(monthlyCostBarWidth(20, 100), 20);
});

test("dashboard merges comparison columns and exposes same-model monthly cost rankings", () => {
  const html = readFileSync(new URL("../dashboard.html", import.meta.url), "utf8");
  const script = readFileSync(new URL("../src/dashboard.js", import.meta.url), "utf8");
  const css = readFileSync(new URL("../styles/dashboard.css", import.meta.url), "utf8");
  assert.match(html, /<th scope="col" colspan="3" class="paid-only-column merged-price-heading" data-sort-keys="monthlyCost">报价与月成本<\/th>/);
  assert.match(html, /<th scope="col" colspan="2" class="paid-only-column" data-sort-keys="diffPercent blendedUnitPrice">价差 \/ 混合单价<\/th>/);
  assert.equal(html.includes("data-monthly-cost-scale"), false);
  assert.equal(html.includes("monthly-cost-ruler"), false);
  assert.match(script, /<td colspan="3" data-label="报价与月成本" class="merged-price-cell/);
  assert.match(script, /<td colspan="2" data-label="价差 \/ 混合单价" class="merged-comparison-cell paid-only-column"/);
  assert.equal(script.includes('<td data-label="中转单价">'), false);
  assert.equal(script.includes("is-blended-unit-price"), false);
  assert.equal(script.includes("chart-line"), false);
  assert.equal(script.includes("月省"), false);
  assert.equal(script.includes("月多付"), false);
  assert.equal(script.includes("<small>/月</small>"), false);
  assert.match(script, /<details class="monthly-cost-details">/);
  assert.match(script, /class="monthly-cost-ranking-list"/);
  assert.match(script, /月成本最低前 \$\{top\.length\} 条/);
  assert.match(script, /buildMonthlyCostRankings\(filtered\)/);
  assert.match(script, /monthlyCostRankingFor\(row, monthlyCostRankings\)/);
  assert.match(script, /monthlyCostBarWidth\(row\.monthlyCost, baseline\)/);
  assert.match(script, /closeMonthlyCostDetails\(event\.target\.closest\("\.monthly-cost-details"\)\)/);
  assert.match(script, /document\.addEventListener\("mouseover", event =>/);
  assert.match(script, /details\.dataset\.hoverOpen = "true"/);
  assert.match(css, /\.merged-comparison-columns/);
  assert.match(css, /\.monthly-cost-ranking-list/);
  assert.match(css, /\.monthly-cost-details\[open\] > \.monthly-cost-popover/);
  assert.match(css, /\.comparison-table td\.merged-comparison-cell/);
  assert.equal(css.includes("monthly-cost-scale-switch"), false);
  assert.equal(css.includes("chart-line"), false);
  assert.equal(css.includes(".merged-price-unit + .merged-price-unit"), false);
});