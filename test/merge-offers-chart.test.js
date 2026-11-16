import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildComparisonRows, pickPrimaryOfficial } from "../src/core/pricing.js";
import { buildMonthlyCostRankings, deltaTone, modeSwitchFilters, monthlyCostBarWidth, monthlyCostRankingFor } from "../src/dashboard-index.js";
import { priceEntryTone } from "../src/dashboard-pricing.js";

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

test("priceEntryTone only compares prices that really exist on both sides", () => {
  assert.equal(priceEntryTone({ relay: { value: 0.2 }, official: { value: 0.18 } }), "up");
  assert.equal(priceEntryTone({ relay: { value: 0.14 }, official: { value: 0.18 } }), "down");
  // 0.5% 容差：四舍五入导致的微小差异不算涨跌。
  assert.equal(priceEntryTone({ relay: { value: 0.1805 }, official: { value: 0.18 } }), "neutral");
  assert.equal(priceEntryTone({ relay: { value: 0.182 }, official: { value: 0.18 } }), "up");
  assert.equal(priceEntryTone({ relay: { value: 0.18 }, official: null }), "neutral");
  assert.equal(priceEntryTone({ relay: null, official: { value: 0.18 } }), "neutral");
  assert.equal(priceEntryTone({ relay: { value: 0.18 }, official: { value: 0 } }), "neutral");
  assert.equal(priceEntryTone({ relay: { value: 0 }, official: { value: 0.18 } }), "down");
  // 估算值是拿输入价兜底出来的，不参与比价。
  assert.equal(priceEntryTone({ relay: { value: 0.2, estimated: true }, official: { value: 0.18 } }), "neutral");
  assert.equal(priceEntryTone({ relay: { value: 0.2 }, official: { value: 0.18, estimated: true } }), "neutral");
});

test("dashboard drops the paid recommendation column and keeps one delta sort option", () => {
  const html = readFileSync(new URL("../dashboard.html", import.meta.url), "utf8");
  const script = readFileSync(new URL("../src/dashboard.js", import.meta.url), "utf8");
  const header = html.match(/<thead>[\s\S]*?<\/thead>/)?.[0] || "";
  assert.equal(header.includes(">推荐</th>"), false);
  assert.match(header, /data-sort-keys="monthlyCost blendedUnitPrice diffPercent">月成本 · 混合单价<\/th>/);
  assert.equal(header.includes(">混合单价</th>"), false);
  const secondary = html.match(/<select id="sort-secondary">[\s\S]*?<\/select>/)?.[0] || "";
  assert.equal((secondary.match(/value="diffPercent"/g) || []).length, 1);
  assert.equal(script.includes('data-label="推荐"'), false);
  assert.match(script, /data-label="月成本 · 混合单价"/);
  assert.equal(script.includes('data-label="混合单价"'), false);
  assert.equal(script.includes('class="delta-cell'), false);
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
  assert.equal(script.includes('.monthly-cost-summary'), false);
  assert.equal(script.includes('event.target.closest(".model-match-details > .confidence-tag")'), true);
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

test("dashboard aligns price matrices and exposes same-model monthly cost rankings", () => {
  const html = readFileSync(new URL("../dashboard.html", import.meta.url), "utf8");
  const script = readFileSync(new URL("../src/dashboard.js", import.meta.url), "utf8");
  const css = readFileSync(new URL("../styles/dashboard.css", import.meta.url), "utf8");
  assert.equal(html.includes("price-group-heading"), false);
  // 费用项、官方、中转三个表头合并成一组 colspan，所以按合并后的结构断言。
  assert.match(html, /colspan="3" class="paid-only-column price-key-heading is-section-start"/);
  assert.match(html, /class="price-head-key">费用项/);
  assert.match(html, /class="price-head-side">官方<\/span>/);
  assert.match(html, /class="price-head-side">中转<\/span>/);
  assert.match(html, /data-sort-keys="monthlyCost blendedUnitPrice diffPercent">月成本 · 混合单价<\/th>/);
  assert.match(html, /class="unit-hint-popover".*中转币/);
  assert.equal(html.includes('data-sort-keys="diffPercent" '), false);
  assert.equal(html.includes("thead-subcolumns"), false);
  assert.equal(html.includes("data-monthly-cost-scale"), false);
  assert.equal(html.includes("monthly-cost-ruler"), false);
  assert.match(script, /<td colspan="3" data-label="单价 \/ 每 M tokens" class="price-cell is-section-start paid-only-column"/);
  // 输入/输出保留两列对齐的主行，其余费用项压成一行小胶囊，行高不再随费用项数量线性增长。
  assert.match(script, /<div class="price-grid-row price-line-primary"><span class="price-key">/);
  assert.match(script, /class="price-grid-detail">\$\{cacheGroup\}\$\{otherChips\}/);
  assert.match(script, /<span class="price-mini-label">缓存<\/span>/);
  assert.match(script, /class="price-mini-pair"><span class="price-mini-official">/);
  // 官方和中转同价时不重复写两遍，省掉箭头，一排三个缓存胶囊才放得下
  assert.match(script, /if \(entry\.official && entry\.relay && officialText === relayText\)/);
  assert.match(script, /<td data-label="月成本 · 混合单价" class="cost-combined-cell is-section-start paid-only-column"/);
  assert.equal(script.includes('data-label="混合单价"'), false);
  assert.equal(script.includes('class="blended-cell'), false);
  assert.equal(script.includes('<td data-label="中转单价">'), false);
  assert.equal(script.includes("is-blended-unit-price"), false);
  assert.equal(script.includes("chart-line"), false);
  assert.equal(script.includes("月省"), false);
  assert.equal(script.includes("月多付"), false);
  assert.equal(script.includes("<small>/月</small>"), false);
  assert.match(script, /<div class="monthly-cost-popover" data-monthly-cost-panel/);
  assert.equal(script.includes('class="monthly-cost-rank"'), false);
  assert.match(script, /class="monthly-cost-ranking-list"/);
  assert.match(script, /月成本最低前 \$\{top\.length\} 条/);
  assert.match(script, /buildMonthlyCostRankings\(filtered\)/);
  assert.match(script, /monthlyCostRankingFor\(row, monthlyCostRankings\)/);
  assert.match(script, /monthlyCostBarWidth\(row\.monthlyCost, ranking\.baseline\)/);
  assert.match(script, /priceGridMarkup\(row, currency, officialQuotedPrices, monthlyCostChartMarkup\(row, currency, monthlyRanking\)\)/);
  assert.match(script, /<div class="cost-combined"><div class="cost-combined-main">/);
  assert.match(script, /<div class="cost-combined-main">.*<span class="delta-tag/);
  assert.match(script, /<span class="blended-line"><span class="blended-label">混合<\/span>/);
  assert.match(script, /data-monthly-cost-trigger role="button" tabindex="0" aria-haspopup="true" aria-expanded="false"/);
  assert.match(script, /monthlyCostLayer\(\)\.append\(panel\)/);
  assert.match(script, /document\.addEventListener\("mouseover", event =>/);
  assert.match(script, /details\.dataset\.hoverOpen = "true"/);
  assert.match(css, /\.summary-item\.is-primary/);
  assert.match(css, /\.price-chart \.cell-chart/);
  assert.equal(css.includes(".dashboard-heading"), false);
  assert.match(css, /\.dashboard-workspace:has\(\.dashboard-sidebar > \[data-collapsed="true"\]/);
  assert.match(css, /\.monthly-cost-ranking-list/);
  assert.match(css, /\.monthly-cost-popover\[hidden\]/);
  assert.match(css, /\.floating-layer \{ position: fixed/);
  assert.match(css, /\.cell-chart\.is-monthly-cost/);
  assert.equal(css.includes("monthly-cost-scale-switch"), false);
  assert.equal(css.includes("chart-line"), false);
  assert.equal(css.includes(".merged-price-unit"), false);
});

test("keeps reference status selectors aligned with the topbar markup", () => {
  const html = readFileSync(new URL("../dashboard.html", import.meta.url), "utf8");
  const script = readFileSync(new URL("../src/dashboard.js", import.meta.url), "utf8");
  assert.match(html, /id="reference-pill"[^>]*>[\s\S]*?id="reference-status"[\s\S]*?id="reference-note"/);
  assert.match(script, /\$\("#reference-status"\)\.textContent/);
  assert.match(script, /\$\("#reference-note"\)\.textContent/);
  assert.doesNotMatch(script, /pill\.querySelector\("\[data-reference-(?:status|note)\]"\)/);
});
test("switching comparison mode drops filters that belong to the other dataset", () => {
  const defaults = ["anthropic", "openai"];
  const filters = { search: "gpt", stationId: "s1", provider: ["z-ai"], group: ["Claude"], models: ["gpt-5"], showUnmatched: true, sortBy: "monthlyCost", sortSecondary: "diffPercent", sortDirection: "desc" };
  const next = modeSwitchFilters(filters, defaults);
  assert.deepEqual(next.provider, ["anthropic", "openai"]);
  assert.equal(next.search, "");
  assert.equal(next.stationId, "");
  assert.equal(next.group, null);
  assert.deepEqual(next.models, []);
  assert.equal(next.showUnmatched, true);
  assert.equal(next.sortBy, "monthlyCost");
  assert.equal(next.sortDirection, "desc");
  assert.deepEqual(filters.provider, ["z-ai"]);
  next.provider.push("x-ai");
  assert.deepEqual(defaults, ["anthropic", "openai"]);
  const script = readFileSync(new URL("../src/dashboard.js", import.meta.url), "utf8");
  assert.match(script, /resetFiltersForModeSwitch\(\);\s*\n\s*render\(data\);/);
  assert.match(script, /state\.filters = modeSwitchFilters\(state\.filters, DEFAULT_PROVIDER_FILTER\)/);
});
