import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { normalizePricingPayload } from "../src/core/normalizers.js";
import { buildComparisonRows, flattenComparisonRows } from "../src/core/pricing.js";
import { parseOpenRouterData } from "../src/core/openrouter.js";
import { sitePlugin } from "../src/site-plugins/providers/openrouter.js";

// 真实报文裁剪：一条长度档模型 + 它的 :batch 兄弟、无 cache 价的模型、路由占位（-1）、
// 浮动别名（~ 开头 + alias_target）、:free 变体、时段档模型、按张计价模型。
const SOURCE = JSON.parse(readFileSync(new URL("./fixtures/openrouter-models.json", import.meta.url), "utf8"));

const station = {
  id: "openrouter",
  name: "OpenRouter",
  priceCurrency: sitePlugin.preset.priceCurrency,
  priceCurrencyVerified: true,
  rechargeRate: sitePlugin.preset.rechargeRmb / sitePlugin.preset.rechargeCredits,
  rechargeRateVerified: true,
  category: "relay"
};

const normalized = normalizePricingPayload(sitePlugin.request.decodeResponse(STRUCTURED_CLONE(SOURCE)), "price-map", {
  priceMap: sitePlugin.preset.adapter.priceMap,
  priceCurrency: station.priceCurrency,
  priceCurrencyVerified: true
});

function STRUCTURED_CLONE(value) {
  return JSON.parse(JSON.stringify(value));
}

const rowsFor = name => normalized.data.filter(row => row.model_name === name);
const offersFor = (name, usage) => buildComparisonRows({
  stations: [station],
  snapshots: [{ stationId: station.id, collectedAt: 1, status: "success", normalized }],
  references: { models: [] },
  usage
}).flatMap(row => row.offers).filter(offer => offer.modelName === name && offer.stationId === "openrouter");

test("openrouter：浮动别名、:free 变体、-1 路由占位都不出价", () => {
  assert.equal(rowsFor("~unbiased/pareto-latest").length, 0);
  assert.equal(rowsFor("inclusionai/ling-3.2-flash:free").length, 0);
  assert.equal(rowsFor("openrouter/auto").length, 0);
  assert.ok(rowsFor("openai/gpt-6.2-astra-pro").length > 0);
});

test("openrouter：美元/百万 token 口径与 cache 价", () => {
  const [base] = rowsFor("openai/gpt-6.2-astra-pro");
  assert.equal(base.price_currency, "USD");
  assert.equal(base.input_price, 8);
  assert.equal(base.output_price, 40);
  assert.equal(base.cache_read_price, 0.4);
  assert.equal(base.cache_write_price, 10);
  assert.equal(base.min_tokens, 0);
  const [noCache] = rowsFor("amazon/nova-lite-v1");
  assert.equal(noCache.input_price, 0.06);
  assert.equal(noCache.cache_read_price, null);
});

test("openrouter：长度档补出开区间上界，同一请求只命中一档", () => {
  const tiers = rowsFor("openai/gpt-6.2-astra-pro");
  assert.equal(tiers.length, 2);
  assert.deepEqual(tiers.map(row => [row.min_tokens, row.max_tokens]), [[0, 272000], [272000, undefined]]);
  const short = offersFor("openai/gpt-6.2-astra-pro", { input: 300000, output: 60000, requests: 1000 });
  const long = offersFor("openai/gpt-6.2-astra-pro", { input: 400000, output: 60000, requests: 1 });
  assert.equal(short.length, 1);
  assert.equal(long.length, 1);
  assert.equal(short[0].prices.input, 8);
  assert.equal(long[0].prices.input, 16);
  assert.equal(long[0].prices.output, 60);
});

test("openrouter：:batch 与主条目各自出价", () => {
  const [batch] = rowsFor("openai/gpt-6.2-astra-pro:batch");
  assert.equal(batch.input_price, 4);
  assert.equal(batch.output_price, 20);
});

test("openrouter：时段档（utc_*）跳过，只留基础价", () => {
  const rows = rowsFor("minimax/minimax-m3.1-flash");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].input_price, 0.15);
  assert.equal(rows[0].min_tokens, 0);
});

test("openrouter：充值折算 = 加密 5% × 实时汇率，自比只剩 5% 手续费", () => {
  const { rechargeRmb, rechargeCredits, rechargeCurrency, rechargePremium, priceCurrency } = sitePlugin.preset;
  assert.equal(priceCurrency, "USD");
  assert.equal(rechargeCurrency, "CNY");
  assert.equal(rechargeCredits, 1);
  // 不写死元价：1 美元额度实付 1.05 美元，折元价交给计算层用实时汇率乘。
  assert.equal(rechargeRmb, 1);
  assert.equal(rechargePremium, 1.05);
  const crypto = sitePlugin.preset.rechargePayments.find(payment => payment.channel === "crypto");
  assert.equal(crypto.payAmount / crypto.faceAmount, 1.05);
  const diffs = [6.68, 7.3].map(rate => selfDiffPercent(rate));
  assert.equal(Number(diffs[0].toFixed(2)), 5);
  // 汇率从 6.68 漂到 7.3，自比差额不该跟着动。旧配置写死 7.3，实时 6.68 时会多出 9 个点。
  assert.equal(diffs[0].toFixed(6), diffs[1].toFixed(6));
  assert.ok(sitePlugin.preset.rechargeRateVerified);
  assert.ok(sitePlugin.preset.rechargePaymentsVerified);
});

function selfDiffPercent(exchangeRate) {
  const selfStation = {
    id: "openrouter",
    name: "OpenRouter",
    priceCurrency: sitePlugin.preset.priceCurrency,
    priceCurrencyVerified: true,
    rechargeCurrency: sitePlugin.preset.rechargeCurrency,
    rechargeRmb: sitePlugin.preset.rechargeRmb,
    rechargeCredits: sitePlugin.preset.rechargeCredits,
    rechargePremium: sitePlugin.preset.rechargePremium,
    rechargeRateVerified: true,
    category: "relay"
  };
  const rows = buildComparisonRows({
    stations: [selfStation],
    snapshots: [{ stationId: selfStation.id, collectedAt: 1, status: "success", normalized }],
    references: {
      models: parseOpenRouterData(STRUCTURED_CLONE(SOURCE)),
      exchangeRate,
      openRouterRechargeRate: exchangeRate
    },
    usage: { input: 1_000_000, output: 1_000_000, requests: 0 }
  });
  const row = flattenComparisonRows(rows).find(item => item.modelName === "openai/gpt-6.2-astra-pro");
  assert.ok(row, "自比应该出价");
  return row.diffPercent;
}
