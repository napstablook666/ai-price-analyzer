import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { applyPriceMap, evalExpression, readPath } from "../src/core/price-map.js";
import { tokenfluxPriceMap } from "../src/core/price-maps/tokenflux.js";
import { stellaislePlazaPriceMap, stellaislePriceMap } from "../src/core/price-maps/stellaisle.js";
import { cheapRouterPriceMap } from "../src/core/price-maps/cheaprouter.js";
import { trueSotaPriceMap } from "../src/core/price-maps/true-sota.js";
import { sidrunePriceMap } from "../src/core/price-maps/sidrune.js";
import { relayRouterPriceMap } from "../src/core/price-maps/relayrouter.js";
import { allrouterPriceMap } from "../src/core/price-maps/allrouter.js";
import { normalizePricingPayload, normalizeProxyData, parseBillingTiers } from "../src/core/normalizers.js";
import { normalizeStation } from "../src/shared/schema.js";
import { RESPONSE_FORMAT_DEFINITIONS } from "../src/core/response-formats.js";
import { resolvePriceMap } from "../src/core/price-maps/index.js";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/tokenflux-pricing.json", import.meta.url), "utf8"));

function rowsOf(payload = fixture) {
  return applyPriceMap(tokenfluxPriceMap, payload, { parseTiers: parseBillingTiers });
}

function rowOf(model, group) {
  const found = rowsOf().rows.find(row => row.model_name === model && row.proxy_group_name === group);
  assert.ok(found, `没找到 ${model} / ${group} 这一行`);
  return found;
}

test("readPath 同时认点号路径和 JSON Pointer", () => {
  const source = { data: [{ pricing: { per_image: 0.04 } }], "a.b": 1 };
  assert.equal(readPath(source, "data[0].pricing.per_image"), 0.04);
  assert.equal(readPath(source, "data.0.pricing.per_image"), 0.04);
  assert.equal(readPath(source, "/data/0/pricing/per_image"), 0.04);
  assert.equal(readPath(source, "a.b"), 1);

  // 取不到就是取不到，不能变成 0，否则「不知道价格」会被当成「免费」。
  assert.equal(readPath(source, "data[0].missing"), undefined);
  assert.equal(readPath(source, "data[9].pricing"), undefined);
  assert.equal(readPath(source, "data[0].pricing.per_image.deeper"), undefined);
});

test("evalExpression 只算四则运算，不执行任何代码", () => {
  const scope = { model_ratio: 2.5, completion_ratio: 5, cache_ratio: 0.1 };
  assert.equal(evalExpression("model_ratio", scope), 2.5);
  assert.equal(evalExpression("model_ratio * completion_ratio", scope), 12.5);
  assert.equal(evalExpression("model_ratio * cache_ratio", scope), 0.25);
  assert.equal(evalExpression("(model_ratio + 1) * 2", scope), 7);
  assert.equal(evalExpression("-model_ratio / 2", scope), -1.25);

  // 缺变量返回 null，调用方必须当作「算不出来」。
  assert.equal(evalExpression("missing_field * 2", scope), null);
  assert.equal(evalExpression("model_ratio / 0", scope), null);
  // 表达式来自站点数据、不是我们的映射文件。写错方法调用要炸得响，由调用方兜。
  for (const bad of ["process.exit(1)", "model_ratio.toString()", "`${model_ratio}`", "model_ratio +"]) {
    assert.throws(() => evalExpression(bad, scope), /表达式|语法|不支持/);
  }
});

test("TokenFlux 按张计费：站内自带的 1K / 2K / 4K 倍率直接成档", () => {
  const rows = rowsOf().rows.filter(row => row.model_name === "gpt-image-2" && row.proxy_group_name === "default");
  assert.deepEqual(rows.map(row => [row.size_tier, row.image_price]), [
    ["1K", 0.06],
    ["2K", 0.1002],
    ["4K", 0.1404]
  ]);
  for (const row of rows) {
    assert.equal(row.media_type, "image");
    assert.equal(row.request_price, null);
    assert.equal(row.input_price, null);
  }
});

test("TokenFlux 按张计费：没有倍率表的模型只出一行，不编档位", () => {
  const row = rowOf("gpt-image-2.5", "default");
  assert.equal(row.image_price, 0.1);
  assert.equal(row.size_tier, undefined);
  assert.equal(row.media_type, "image");
});

test("TokenFlux 按 token 计费：分组倍率乘在价格上", () => {
  const standard = rowOf("claude-opus-4-7", "default");
  assert.equal(standard.input_price, 5);
  assert.equal(standard.output_price, 25);
  assert.equal(standard.cache_read_price, 0.5);
  assert.equal(standard.cache_write_price, 6.25);
  assert.equal(standard.group_ratio, 1);

  const discounted = rowOf("claude-opus-4-7", "Claude Code 特惠");
  assert.equal(discounted.group_ratio, 0.2);
  assert.equal(discounted.input_price, 1);
  assert.equal(discounted.output_price, 5);
});

test("TokenFlux 只报 token 价的出图模型标成 image，进生图榜", () => {
  const row = rowOf("gpt-image-2.5-sunburst", "default");
  assert.equal(row.media_type, "image");
  assert.equal(row.image_price, null);
  assert.equal(row.input_price, 75);
  assert.equal(row.tier_name, "标准");
});

test("TokenFlux 视频模型：billing_usage_schema 声明 seconds，单位就是秒", () => {
  const row = rowOf("wan2.7-i2v", "default");
  assert.equal(row.media_type, "video");
  assert.equal(row.request_unit, "second");
  assert.equal(row.request_price, 1);
  assert.equal(row.image_price, null);
});

test("TokenFlux 表达式计费：按上下文长度分档，带区间", () => {
  const rows = rowsOf().rows.filter(row => row.model_name === "gpt-6-astra" && row.proxy_group_name === "default");
  assert.deepEqual(rows.map(row => [row.tier_name, row.input_price, row.output_price, row.min_tokens, row.max_tokens]), [
    ["0_272k", 10, 50, 0, 272000],
    ["272k_plus", 20, 75, 272001, undefined]
  ]);
});

test("TokenFlux 整份数据没有解析不了的模型", () => {
  assert.deepEqual(rowsOf().unresolved, []);
});

test("没有匹配规则的模型进 unresolved，不能静默丢掉", () => {
  const payload = { success: true, group_ratio: { default: 1 }, data: [{ model_name: "mystery-model", quota_type: "??" }] };
  const result = rowsOf(payload);
  assert.equal(result.rows.length, 0);
  assert.equal(result.unresolved.length, 1);
  assert.equal(result.unresolved[0].model, "mystery-model");
});

// 这两条钉的是「口径」，不是实现的当前输出：ratio 1 对应多少美元必须有独立依据，
// 否则下次有人把常数改回 1，测试只会跟着改数字，什么也拦不住。
test("tokenflux 的倍率单位是 $2/M：ratio 1.5 出 $3", () => {
  const payload = {
    success: true,
    group_ratio: { default: 1 },
    data: [{ model_name: "claude-sonnet-4-5", quota_type: 0, model_ratio: 1.5, completion_ratio: 5, enable_groups: ["default"] }]
  };
  const rows = rowsOf(payload).rows;
  assert.equal(rows.length, 1);
  // 官方 claude-sonnet-4-5 输入 $3/M，站内 ratio 1.5。×2 对上，×1 差一半。
  assert.equal(rows[0].input_price, 3);
  assert.equal(rows[0].output_price, 15);
  // 回写字段要除回来，存储里的 model_ratio 仍是站点原文的 1.5。
  assert.equal(rows[0].model_ratio, 1.5);
});

test("声明里的 ratioBase 能覆盖族基准", () => {
  const payload = {
    success: true,
    group_ratio: { default: 1 },
    data: [{ model_name: "claude-sonnet-4-5", quota_type: 0, model_ratio: 1.5, completion_ratio: 5, enable_groups: ["default"] }]
  };
  const declared = resolvePriceMap({ base: "tokenflux", ratioBase: 1 });
  assert.equal(declared.error, undefined);
  assert.equal(declared.map.ratioBase, 1);
  const rows = applyPriceMap(declared.map, payload, { parseTiers: parseBillingTiers }).rows;
  assert.equal(rows[0].input_price, 1.5);
});

test("分组在 enable_groups 里但 group_ratio 没有倍率时不出行", () => {
  const payload = {
    success: true,
    group_ratio: { default: 1 },
    data: [{ model_name: "ghost-group", quota_type: 0, model_ratio: 1, completion_ratio: 2, enable_groups: ["nowhere"] }]
  };
  const result = rowsOf(payload);
  // 没倍率就是不知道这一档打几折。按 1 算会把价格报高，按 0 算会报成免费，两种都是编。
  assert.equal(result.rows.length, 0);
  assert.equal(result.unresolved.length, 1);
  assert.equal(result.unresolved[0].model, "ghost-group");
});

test("enable_groups 全空时只出站内基准价，不拿 group_ratio 的键给每个模型编分组", () => {
  const payload = {
    success: true,
    group_ratio: { "gpt-plus": 0.14, "gpt 稳定分组": 0.25 },
    data: [{ model_name: "gpt-5.4", quota_type: 0, model_ratio: 2, completion_ratio: 3, enable_groups: [] }]
  };
  const rows = applyPriceMap(stellaislePriceMap, payload, { parseTiers: parseBillingTiers }).rows;
  // 站点不公开「模型 ↔ 分组」，就按倍率 1 出一条基准价，多编一行都是编。
  assert.deepEqual(rows.map(row => [row.proxy_group_name, row.group_ratio, row.input_price]), [
    ["站内基准价", 1, 4]
  ]);
  // 没声明 unlisted 的 map 照旧把这条记进 unresolved，不静默丢也不瞎猜。
  const fallback = rowsOf(payload);
  assert.equal(fallback.rows.length, 0);
  assert.equal(fallback.unresolved.length, 1);
});

// 分组广场：一条数据对应一个分组，分组名与倍率由 normalizer 展开时标在 __group_* 上。
// 口径分两半（见 price-maps/stellaisle.js）：tiered 的表达式要乘分组倍率，
// token 与按次价站内已经乘过，倍率恒为 1。乘错一边整张榜都偏。
test("分组广场：表达式按分组倍率折算，token 与按次价原样出", () => {
  const payload = {
    data: [
      {
        model_name: "gpt-6-luna",
        pricing_mode: "tiered",
        billing_expr: 'len <= 272000 ? tier("standard", p * 0.1 + c * 0.5 + cr * 0.01) : tier("long_context", p * 0.2 + c * 0.75 + cr * 0.02)',
        __group_name: "SWS · 认证特惠供应商s001",
        __group_ratio: 0.088
      },
      {
        model_name: "codex-auto-review",
        pricing_mode: "token",
        input_per_m: 0.066,
        output_per_m: 0.396,
        cached_input_per_m: 0.0066,
        __group_name: "SWS · 认证特惠供应商s001",
        __group_ratio: 1
      },
      {
        model_name: "gpt-image-2.5",
        pricing_mode: "per_call",
        price_per_call: 0.02145,
        __group_name: "平台认证 · 认证供应商d01",
        __group_ratio: 1
      }
    ]
  };
  const rows = applyPriceMap(stellaislePlazaPriceMap, payload, { parseTiers: parseBillingTiers }).rows;
  assert.deepEqual(
    rows.filter(row => row.model_name === "gpt-6-luna").map(row => [row.tier_name, row.input_price, row.output_price]),
    [["standard", 0.0088, 0.044], ["long_context", 0.0176, 0.066]]
  );
  const codex = rows.find(row => row.model_name === "codex-auto-review");
  // input_per_m 0.066 已经是 0.75 × 0.088 的结果，再乘一次就等于白送。
  assert.equal(codex.group_ratio, 1);
  assert.equal(codex.input_price, 0.066);
  assert.equal(codex.proxy_group_name, "SWS · 认证特惠供应商s001");
  const image = rows.find(row => row.model_name === "gpt-image-2.5");
  assert.equal(image.group_ratio, 1);
  assert.equal(image.image_price, 0.02145);
  assert.equal(image.request_price, null);
  assert.equal(image.media_type, "image");
});

// ---- CheapRouter：和 TokenFlux 形状完全不同的第二份站点 ----

// 真实 payload 裁出来的 5 条：两种 token 形状 + 两个分组的出图模型。
const cheapRouterFixture = JSON.parse(readFileSync(new URL("./fixtures/cheaprouter-pricing.json", import.meta.url), "utf8"));

function cheapRows() {
  return applyPriceMap(cheapRouterPriceMap, cheapRouterFixture);
}

test("CheapRouter 上下文分档：一档一行，档位区间和价格都跟着走", () => {
  const rows = cheapRows().rows.filter(row => row.model_name === "codex-auto-review");
  assert.deepEqual(rows.map(row => [row.tier_name, row.input_price, row.output_price, row.min_tokens, row.max_tokens]), [
    ["≤272K", 0.03, 0.18, 0, 272000],
    [">272K", 0.06, 0.27, 272000, undefined]
  ]);
  // completion_ratio 站点没给，按 0.18 / 0.03 推成 6，不能写成 1。
  assert.equal(rows[0].completion_ratio, 6);
  assert.equal(rows[0].price_currency, "USD");
});

test("CheapRouter 按张计费：三档同价并成一行，不重复记三笔", () => {
  const rows = cheapRows().rows.filter(row => row.model_name === "gpt-image-2");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].image_price, 0.0536);
  assert.equal(rows[0].media_type, "image");
  assert.equal(rows[0].size_tier, undefined);
  assert.equal(rows[0].input_price, null);
  assert.equal(rows[0].request_price, null);
});

test("CheapRouter 一条价格都没有的模型进 unresolved，不静默丢", () => {
  const payload = {
    code: 0,
    data: { enabled: true, items: [{ model: "ghost-model", billing_mode: "token", group: { name: "某个分组" }, effective_pricing_usd: {}, pricing_details: {} }] }
  };
  const result = applyPriceMap(cheapRouterPriceMap, payload);
  assert.equal(result.rows.length, 0);
  assert.deepEqual(result.unresolved.map(entry => entry.model), ["ghost-model"]);
});

test("CheapRouter 没有分档的模型只出一行，价格就是 effective_pricing_usd", () => {
  const rows = cheapRows().rows.filter(row => row.model_name === "claude-haiku-4-5-20251001");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].input_price, 0.5);
  assert.equal(rows[0].output_price, 2.5);
  assert.equal(rows[0].tier_name, undefined);
});

test("CheapRouter 出图模型按张计费，不同分组各记一行", () => {
  const rows = cheapRows().rows.filter(row => row.media_type === "image");
  assert.deepEqual(rows.map(row => [row.model_name, row.proxy_group_name, row.image_price]), [
    ["gpt-image-2", "Codex促销分组-不降智", 0.0536],
    ["gpt-image-2.5-flare", "GPT官Key分组", 0.0536]
  ]);
});

// ---- TrueSOTA：模型带 group_id 外键，分组名和倍率在另一处 ----

const trueSotaFixture = JSON.parse(readFileSync(new URL("./fixtures/true-sota-pricing.json", import.meta.url), "utf8"));

function trueSotaRows() {
  return applyPriceMap(trueSotaPriceMap, trueSotaFixture);
}

test("TrueSOTA 按 group_id 查分组名和倍率，不从模型自己身上找", () => {
  const [row] = trueSotaRows().rows.filter(entry => entry.model_name === "claude-fable-5" && entry.proxy_group_name === "Claude");
  assert.equal(row.group_ratio, 2.2);
  // 每 token 0.00001 美元 → 每百万 10，再乘 2.2
  assert.equal(row.input_price, 22);
  assert.equal(row.output_price, 110);
  assert.equal(row.price_currency, "USD");
});

test("TrueSOTA 查不到分组就不猜，记成 unresolved", () => {
  const payload = { code: 0, data: { groups: [], models: [{ name: "orphan", group_id: 404, input_price: 0.00001, output_price: 0.00002 }] } };
  const result = applyPriceMap(trueSotaPriceMap, payload);
  assert.equal(result.rows.length, 0);
  assert.deepEqual(result.unresolved.map(entry => entry.model), ["orphan"]);
});

test("TrueSOTA 出图模型即使没有顶层价，也能从分档里出价", () => {
  const rows = trueSotaRows().rows.filter(row => row.model_name === "gpt-image-1" && row.proxy_group_name === "官方GPT");
  assert.deepEqual(rows.map(row => [row.size_tier, row.image_price]), [["1K", 0.134], ["2K", 0.201], ["4K", 0.268]]);
  assert.equal(rows[0].media_type, "image");
});

test("TrueSOTA 出图模型只有统一价时只出一行", () => {
  const rows = trueSotaRows().rows.filter(row => row.model_name === "gpt-image-2" && row.proxy_group_name === "生图");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].image_price, 0.15);
  assert.equal(rows[0].size_tier, undefined);
});

// Sidrune 的 live payload 里，一份价挂多个分组、分组倍率分层、图片单开倍率三件事同时出现，
// 这里用最小样本把这三条分别钉住。

const sidruneFixture = {
  code: 0,
  data: {
    groups: [
      {
        id: 46, name: "GPT-Pro", rate_multiplier: 0.2, effective_rate_multiplier: 0.2,
        promo_active: false, image_rate_independent: true, image_rate_multiplier: 1
      },
      {
        id: 180, name: "GPT-Pro优选", rate_multiplier: 0.4, effective_rate_multiplier: 0.3,
        promo_active: true, promo_rate_multiplier: 0.1, image_rate_independent: false, image_rate_multiplier: 0.2
      }
    ],
    pricing: [
      {
        name: "gpt-5", billing_mode: "token", group_ids: [46, 180],
        input_price: 0.00001, output_price: 0.00005,
        cache_read_price: 0.000001, cache_write_price: 0.0000125, cache_write_1h_price: 0.00002,
        image_input_price: 0.00001, image_output_price: 0.00003
      },
      {
        name: "gpt-image-2", billing_mode: "image", group_ids: [46], per_request_price: 0.35,
        intervals: [
          { tier_label: "1K", per_request_price: 0.15 },
          { tier_label: "2K", per_request_price: 0.25 },
          { tier_label: "4K", per_request_price: 0.35 }
        ]
      }
    ]
  }
};

function sidruneRows() {
  return applyPriceMap(sidrunePriceMap, sidruneFixture);
}

test("Sidrune 一份价挂多个分组时每个分组各出一行", () => {
  const rows = sidruneRows().rows.filter(row => row.model_name === "gpt-5");
  assert.deepEqual(rows.map(row => row.proxy_group_name).sort(), ["GPT-Pro", "GPT-Pro优选"]);
  assert.deepEqual(rows.map(row => row.enable_groups).flat(), ["GPT-Pro", "GPT-Pro优选"]);
});

test("Sidrune 促销倍率压过常规倍率", () => {
  const rows = sidruneRows().rows.filter(row => row.model_name === "gpt-5");
  const promo = rows.find(row => row.proxy_group_name === "GPT-Pro优选");
  assert.equal(promo.group_ratio, 0.1);
  assert.equal(promo.input_price, 1);
  assert.equal(promo.output_price, 5);
});

test("Sidrune 图片 token 价走图片倍率，文本价走文本倍率", () => {
  const row = sidruneRows().rows.find(row => row.model_name === "gpt-5" && row.proxy_group_name === "GPT-Pro");
  // 文本价打 0.2 折，图片价不打折——差 5 倍，这是这个分组开关的全部意义。
  assert.equal(row.input_price, 2);
  assert.equal(row.image_input_price, 10);
  assert.equal(row.image_output_price, 30);
  assert.equal(row.cache_write_1h_price, 4);
});

test("Sidrune 出图模型按 1K/2K/4K 各出一行，价落在 image_price 上", () => {
  const rows = sidruneRows().rows.filter(row => row.model_name === "gpt-image-2");
  assert.deepEqual(rows.map(row => [row.size_tier, row.image_price]), [["1K", 0.15], ["2K", 0.25], ["4K", 0.35]]);
  for (const row of rows) {
    assert.equal(row.media_type, "image");
    assert.equal(row.request_price, null, "按张的价不能落到按次字段上");
    assert.equal(row.input_price, null);
  }
});

const relayFixture = JSON.parse(readFileSync(new URL("./fixtures/relayrouter-pricing.json", import.meta.url), "utf8"));

function relayRows(payload = relayFixture) {
  return applyPriceMap(relayRouterPriceMap, payload, { parseTiers: parseBillingTiers });
}

function relayRow(model, group, payload = relayFixture) {
  const found = relayRows(payload).rows.find(row => row.model_name === model && row.proxy_group_name === group);
  assert.ok(found, `没找到 ${model} / ${group} 这一行`);
  return found;
}

test("RelayRouter 缓存写读 5 分钟倍率，1 小时写单独成列", () => {
  // 2（模型倍率）× 2（每倍率 2 美元/M）× 1.1（分组倍率）= 4.4
  const row = relayRow("claude-opus-5-5", "Anthropic-Claude-1");
  assert.equal(row.input_price, 4.4);
  assert.equal(row.output_price, 22);
  assert.equal(row.cache_read_price, 0.22);
  assert.equal(row.cache_write_price, 5.5, "5.5 = 4.4 × 1.25，站点只发 cache_creation_5m_ratio");
  assert.equal(row.cache_write_1h_price, 8.8, "8.8 = 4.4 × 2");
  assert.equal(row.request_price, null);
});

test("RelayRouter 老字段 cache_creation_ratio 仍能兜住缓存写价", () => {
  const payload = {
    success: true,
    group_ratio: { "A-1": 1 },
    data: [{ model_name: "legacy-claude", quota_type: 0, model_ratio: 1, completion_ratio: 5, cache_ratio: 0.1, cache_creation_ratio: 3, enable_groups: ["A-1"], supported_endpoint_types: ["openai"] }]
  };
  const row = relayRow("legacy-claude", "A-1", payload);
  assert.equal(row.cache_write_price, 6, "2 × 3，没有 5m 字段时回落到老字段");
  assert.equal(row.cache_write_1h_price, undefined);
});

test("RelayRouter 的长上下文分档按 step_ratios 展开，档内倍率整段生效", () => {
  const rows = relayRows().rows.filter(row => row.model_name === "gpt-6.1-sol" && row.proxy_group_name === "Openai-Gpt-1");
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(row => [row.min_tokens, row.max_tokens]), [[0, 272000], [272000, 1000000]]);
  // 1 × 2 × 0.58824 = 1.17648；第二档 prompt_step_ratio 2，输出再乘 completion_step_ratio 1.5。
  assert.equal(rows[0].input_price, 1.17648);
  assert.equal(rows[0].output_price, 5.8824);
  assert.equal(rows[1].input_price, 2.35296);
  assert.equal(rows[1].output_price, 8.8236);
});

test("RelayRouter 按次计价模型只出按次价，并带上媒体类型", () => {
  const row = relayRow("gpt-image-2-c", "Gpt-Image-1");
  assert.equal(row.request_price, 0.0088236, "0.12 × 0.07353 的分组倍率");
  assert.equal(row.input_price, null);
  assert.equal(row.output_price, null);
  assert.equal(row.media_type, "image");
  const video = relayRow("wan3.0-video", "Alibaba-video-1");
  assert.equal(video.request_price, 0.0065);
  assert.equal(video.media_type, "video");
});

// ---- AllRouter：/api/pricing 就是 tokenflux 形状，分组倍率公开 ----

// 真实 payload 裁出来的 5 条：倍率类、分时表达式、长度分档表达式、出图表达式各一。
const allRouterFixture = JSON.parse(readFileSync(new URL("./fixtures/allrouter-pricing.json", import.meta.url), "utf8"));

function allRouterRows() {
  return applyPriceMap(allrouterPriceMap, allRouterFixture, { parseTiers: parseBillingTiers });
}

function allRouterRow(model, group, tier) {
  const found = allRouterRows().rows.find(row => row.model_name === model && row.proxy_group_name === group &&
    (tier === undefined || row.tier_name === tier));
  assert.ok(found, `没找到 ${model} / ${group} / ${tier ?? "-"} 这一行`);
  return found;
}

test("AllRouter 用站点公开的分组名和倍率，不编基准价", () => {
  const { rows, unresolved } = allRouterRows();
  assert.deepEqual(unresolved, []);
  // 分组名必须来自站点的 group_ratio，编出来的占位分组名一个都不能有。
  const siteGroups = new Set(Object.keys(allRouterFixture.group_ratio));
  for (const row of rows) assert.ok(siteGroups.has(row.proxy_group_name), `分组名 ${row.proxy_group_name} 不在站点的分组表里`);
  assert.ok(!rows.some(row => row.proxy_group_name === "基准价"));
  assert.equal(allRouterRow("deepseek-v4.1-flash", "deepseek").group_ratio, 0.4);
  assert.equal(allRouterRow("glm-5.3-flash", "glm").group_ratio, 0.3);
});

test("AllRouter 表达式价乘分组倍率：default 0.75、deepseek 0.4", () => {
  // 表达式 off_peak 是 p*0.15 + c*0.6，乘分组倍率才是站点实际扣的钱。
  const offPeak = allRouterRow("deepseek-v4.1-flash", "default", "off_peak");
  assert.equal(offPeak.input_price, 0.1125);
  assert.equal(offPeak.output_price, 0.45);
  assert.equal(allRouterRow("deepseek-v4.1-flash", "deepseek", "off_peak").input_price, 0.06);
  assert.equal(allRouterRow("deepseek-v4.1-flash", "default", "peak").input_price, 0.225);
  // 长度分档同样按分组倍率走：gpt 分组是自营号池，倍率 0.053。
  assert.equal(allRouterRow("gpt-6-luna-openai-compact", "gpt", "0_272k").input_price, 0.0053);
  assert.equal(allRouterRow("gpt-6-luna-openai-compact", "default", "272k_plus").output_price, 0.5625);
});

test("AllRouter 倍率类按 1 = $2 折算，再乘分组倍率", () => {
  // claude-opus-5-5：ratio 2 → $4/M，claude-official-api 0.65 → 2.6。
  const row = allRouterRow("claude-opus-5-5", "claude-official-api");
  assert.equal(row.input_price, 2.6);
  assert.equal(row.output_price, 13);
  assert.equal(row.completion_ratio, 5);
  assert.equal(row.price_currency, "USD");
});

test("AllRouter 出图模型靠 supported_endpoint_types 进生图榜", () => {
  assert.equal(allRouterRow("gpt-image-2.5", "default").media_type, "image");
  assert.equal(allRouterRow("claude-opus-5-5", "claude-max").media_type, undefined);
});

// 这三家原本各有一个 12 行的 strategy 类，canParse 只比字符串、parse 只调 super.parse。
// 现在统一走 price-map 处理器 + 格式定义里的兜底声明，这组测试守住那条路别再长出新的壳类。
test("走 price-map 的格式定义必须自带可解析的 priceMap 声明", () => {
  for (const [format, definition] of Object.entries(RESPONSE_FORMAT_DEFINITIONS)) {
    if (definition.strategy !== "price-map" || format === "price-map") continue;
    assert.ok(definition.priceMap, `${format} 用了 price-map 处理器，但没有声明 priceMap`);
    assert.equal(resolvePriceMap(definition.priceMap).error, undefined, `${format} 的 priceMap 解不出来`);
  }
});

test("退役的枚举值经 normalizeStation 迁移后，仍然走同一条 price-map 解析", () => {
  const cases = [
    ["allrouter", "allrouter-pricing.json"],
    ["relayrouter", "relayrouter-pricing.json"]
  ];
  for (const [format, file] of cases) {
    const payload = JSON.parse(readFileSync(new URL(`./fixtures/${file}`, import.meta.url), "utf8"));
    // 走真实链路：存储里躺着的旧 responseFormat，被 normalizeStation 换成新声明，
    // 再按 collectors 的取法（format + priceMap）解析。
    const station = normalizeStation({ baseUrl: "https://example.com", adapter: { responseFormat: format } });
    assert.equal(station.adapter.responseFormat, "price-map");
    const migrated = normalizePricingPayload(payload, station.adapter.responseFormat, { priceMap: station.adapter.priceMap });
    const declared = normalizeProxyData(payload, { responseFormat: "price-map", priceMap: { base: format } });
    assert.ok(migrated.data.length > 0, `${format} 迁移后解析不出数据`);
    assert.equal(migrated.sourceFormat, format);
    assert.deepEqual(migrated.data, declared.data);
    assert.deepEqual(migrated.group_ratio, declared.group_ratio);
  }
});
