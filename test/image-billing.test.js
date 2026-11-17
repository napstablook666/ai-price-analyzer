import test from "node:test";
import assert from "node:assert/strict";
import {
  IMAGE_REFERENCE,
  IMAGE_UNIT_LABELS,
  compareImageQuote,
  imageCategoryOf,
  imageTierLabel,
  imageTierOf,
  mediaUnitLabel,
  mediaUnitRank,
  pickImageQuote,
  toPerImage,
  tokensPerImage
} from "../src/core/image-billing.js";
import { aggregateImageQuotes, parseImageEndpoints, parseImageModels } from "../src/core/openrouter.js";

test("一张图的 token 数只登记官方公开过的模型族", () => {
  assert.equal(tokensPerImage("openai/gpt-image-1"), 1056);
  assert.equal(tokensPerImage("openai/gpt-image-1-mini"), 1056);
  assert.equal(tokensPerImage("google/gemini-2.5-flash-image"), 1290);
  // 查不到就返回 null，不许拿别的模型的值凑。
  assert.equal(tokensPerImage("google/gemini-3-pro-image"), null);
  assert.equal(tokensPerImage("black-forest-labs/flux.2-pro"), null);
  assert.equal(tokensPerImage(""), null);
});

test("标准出图规格是 1024×1024 medium", () => {
  assert.equal(IMAGE_REFERENCE.size, "1024×1024");
  assert.equal(IMAGE_REFERENCE.quality, "medium");
  assert.ok(Math.abs(IMAGE_REFERENCE.megapixels - 1.048576) < 1e-12);
});

test("四种计价单位都给出中文标签", () => {
  assert.deepEqual(Object.keys(IMAGE_UNIT_LABELS).sort(), ["image", "megapixel", "request", "token"]);
  assert.equal(IMAGE_UNIT_LABELS.image, "元/张");
});

test("站内同时报张价和图 token 价时，优先取与官方同口径的那一档", () => {
  const prices = { imagePrice: 0.04, imageOutput: 30 };
  assert.deepEqual(pickImageQuote(prices, "token"), { unit: "token", value: 30 });
  assert.deepEqual(pickImageQuote(prices, "image"), { unit: "image", value: 0.04 });
  // 没有官方参照时按「张 → 图 token」取。
  assert.deepEqual(pickImageQuote(prices, ""), { unit: "image", value: 0.04 });
  assert.equal(pickImageQuote({ imagePrice: 0, imageOutput: null }, ""), null);
  assert.equal(pickImageQuote({}, ""), null);
});

test("按张价折合就是它自己，不带假设", () => {
  assert.deepEqual(toPerImage({ unit: "image", value: 0.04 }, "openai/gpt-image-1"), { perImage: 0.04, assumption: "" });
});

test("图 token 价折成元/张要带 token 假设", () => {
  const result = toPerImage({ unit: "token", value: 30 }, "openai/gpt-image-1");
  assert.ok(Math.abs(result.perImage - 0.03168) < 1e-12);
  assert.match(result.assumption, /1056 tokens\/张/);
  // 锚定表没有的模型族不折算。
  assert.equal(toPerImage({ unit: "token", value: 30 }, "google/gemini-3-pro-image"), null);
});

test("像素价按 1.048576 MP/张 折合", () => {
  const result = toPerImage({ unit: "megapixel", value: 0.03 }, "");
  assert.ok(Math.abs(result.perImage - 0.03 * 1.048576) < 1e-12);
  assert.match(result.assumption, /1\.048576 MP\/张/);
});

test("按次价按每次一张折合", () => {
  const result = toPerImage({ unit: "request", value: 0.2 }, "");
  assert.equal(result.perImage, 0.2);
  assert.match(result.assumption, /1 张\/次/);
});

test("同单位直比给百分比，元/张的算 direct", () => {
  const direct = compareImageQuote({ unit: "image", value: 0.04 }, { unit: "image", value: 0.08 }, "");
  assert.equal(direct.kind, "direct");
  assert.equal(direct.diffPercent, -50);

  const sameUnit = compareImageQuote({ unit: "token", value: 30 }, { unit: "token", value: 60 }, "");
  assert.equal(sameUnit.kind, "same-unit");
  assert.equal(sameUnit.diffPercent, -50);
});

test("跨单位折算才给百分比，并挂上两边的假设", () => {
  const compare = compareImageQuote(
    { unit: "token", value: 30 },
    { unit: "image", value: 0.144 },
    "openai/gpt-image-1"
  );
  assert.equal(compare.kind, "converted");
  assert.ok(Math.abs(compare.diffPercent - ((0.03168 - 0.144) / 0.144 * 100)) < 1e-9);
  assert.match(compare.assumption, /1056 tokens\/张/);
});

test("缺一边或者官方价非正时比不了", () => {
  assert.equal(compareImageQuote(null, { unit: "image", value: 1 }, "").kind, "none");
  assert.equal(compareImageQuote({ unit: "image", value: 1 }, null, "").kind, "none");
  assert.equal(compareImageQuote({ unit: "image", value: 1 }, { unit: "image", value: 0 }, "").kind, "none");
  // 折算所需的系数查不到，也只能 none。
  assert.equal(compareImageQuote({ unit: "token", value: 30 }, { unit: "image", value: 1 }, "unknown/model").kind, "none");
});

test("分档按元/张的价差，折算比不给档位", () => {
  assert.equal(imageCategoryOf({ kind: "direct", diffPercent: -60 }), "excellent");
  assert.equal(imageCategoryOf({ kind: "direct", diffPercent: -10 }), "good");
  assert.equal(imageCategoryOf({ kind: "direct", diffPercent: 1 }), "fair");
  assert.equal(imageCategoryOf({ kind: "direct", diffPercent: 80 }), "bad");
  assert.equal(imageCategoryOf({ kind: "none", diffPercent: null }), "");
  assert.equal(imageCategoryOf({ kind: "none", diffPercent: -60 }), "");
});

const LIST_JSON = {
  data: [
    { id: "openai/gpt-image-1", name: "GPT Image 1", canonical_slug: "openai/gpt-image-1" },
    { id: "black-forest-labs/flux.2-pro", name: "FLUX.2 Pro" }
  ]
};

test("生图模型列表只补身份信息，价格留给 endpoint", () => {
  const models = parseImageModels(LIST_JSON);
  assert.deepEqual(models.map(model => model.id), ["openai/gpt-image-1", "black-forest-labs/flux.2-pro"]);
  assert.equal(models[0].display_name, "GPT Image 1");
  assert.equal(models[0].provider, "openai");
  assert.equal(models[0].imagePrice, null);
  assert.equal(models[0].isImageModel, true);
  assert.equal(models[0].imageOnly, true);
});

test("endpoint 只收 output_image，输入侧和未知单位丢掉", () => {
  const rows = parseImageEndpoints({
    id: "openai/gpt-image-1",
    endpoints: [{
      provider_name: "OpenAI",
      pricing: [
        { billable: "input_text", unit: "token", cost_usd: 0.000005 },
        { billable: "input_image", unit: "image", cost_usd: 0.01 },
        { billable: "output_image", unit: "image", cost_usd: 0.04, variant: "" },
        { billable: "output_image", unit: "image", cost_usd: 0.08, variant: "high_resolution" },
        { billable: "output_image", unit: "bogus", cost_usd: 1 }
      ]
    }]
  });
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { modelId: "openai/gpt-image-1", provider: "OpenAI", unit: "image", valueUsd: 0.04, variant: "" });
  assert.equal(rows[1].variant, "high_resolution");
});

test("主档取无 variant / 1k，其余档位进附表，同档取最低价", () => {
  const quotes = aggregateImageQuotes([
    { modelId: "m", provider: "a", unit: "image", valueUsd: 0.05, variant: "" },
    { modelId: "m", provider: "b", unit: "image", valueUsd: 0.03, variant: "" },
    { modelId: "m", provider: "a", unit: "image", valueUsd: 0.09, variant: "2k" },
    { modelId: "m", provider: "a", unit: "megapixel", valueUsd: 0.02, variant: "4k" }
  ]);
  assert.equal(quotes.m.unit, "image");
  assert.equal(quotes.m.value, 0.03);
  assert.equal(quotes.m.provider, "b");
  assert.equal(quotes.m.variant, "");
  assert.deepEqual(Object.keys(quotes.m.tiers).sort(), ["2k", "4k"]);
  assert.equal(quotes.m.tiers["4k"].unit, "megapixel");
});

test("只有 2k / 4k 档位时退而取最低价当主档", () => {
  const quotes = aggregateImageQuotes([
    { modelId: "m", provider: "a", unit: "image", valueUsd: 0.12, variant: "2k" },
    { modelId: "m", provider: "a", unit: "image", valueUsd: 0.2, variant: "4k" }
  ]);
  assert.equal(quotes.m.variant, "2k");
  assert.equal(quotes.m.value, 0.12);
  assert.deepEqual(Object.keys(quotes.m.tiers), ["4k"]);
});

test("variant 里拆出尺寸和质量，拆不出来进 unstated", () => {
  assert.deepEqual(imageTierOf(""), { size: "unstated", quality: "unstated" });
  assert.deepEqual(imageTierOf("1k"), { size: "1K", quality: "unstated" });
  assert.deepEqual(imageTierOf("1.5k"), { size: "1.5K", quality: "unstated" });
  assert.deepEqual(imageTierOf("2k"), { size: "2K", quality: "unstated" });
  assert.deepEqual(imageTierOf("4k"), { size: "4K", quality: "unstated" });
  assert.deepEqual(imageTierOf("768"), { size: "768", quality: "unstated" });
  assert.deepEqual(imageTierOf("low_2k"), { size: "2K", quality: "low" });
  assert.deepEqual(imageTierOf("2048x2048"), { size: "2K", quality: "unstated" });
  assert.deepEqual(imageTierOf("4096x4096"), { size: "4K", quality: "unstated" });
  // high_resolution 说的是分辨率，不是质量档。
  assert.deepEqual(imageTierOf("high_resolution"), { size: "unstated", quality: "unstated" });
  // 尺寸在另一列时以那一列为准。
  assert.deepEqual(imageTierOf("1k", "high"), { size: "1K", quality: "high" });
  // 质量只认 low / high，medium 当默认不记。
  assert.deepEqual(imageTierOf("1k", "medium"), { size: "1K", quality: "unstated" });
});

test("档位标签只写有值的部分", () => {
  assert.equal(imageTierLabel({ size: "1K", quality: "unstated" }), "1K");
  assert.equal(imageTierLabel({ size: "unstated", quality: "low" }), "low");
  assert.equal(imageTierLabel({ size: "2K", quality: "high" }), "2K · high");
  assert.equal(imageTierLabel({ size: "unstated", quality: "unstated" }), "规格未标注");
  assert.equal(imageTierLabel({}), "规格未标注");
});

test("规格对不上就不给百分比，哪怕单位相同", () => {
  const station = { unit: "image", value: 0.04 };
  const official = { unit: "image", value: 0.13 };
  const mismatch = compareImageQuote(station, official, "m", imageTierOf(""), imageTierOf("1k"));
  assert.equal(mismatch.kind, "tier-mismatch");
  assert.equal(mismatch.diffPercent, null);
  assert.equal(imageCategoryOf(mismatch), "");
  // 两边都是 unstated 就算同口径，照常直比。
  const aligned = compareImageQuote(station, official, "m", imageTierOf(""), imageTierOf(""));
  assert.equal(aligned.kind, "direct");
  assert.equal(imageCategoryOf(aligned), "excellent");
  // 没传档位时保持旧行为，不凭空判定口径冲突。
  assert.equal(compareImageQuote(station, official, "m").kind, "direct");
});

test("单位排序固定：元/张 在元/1M 图token 前，未知单位沉底", () => {
  assert.ok(mediaUnitRank("image") < mediaUnitRank("token"));
  assert.ok(mediaUnitRank("token") < mediaUnitRank("megapixel"));
  assert.ok(mediaUnitRank("megapixel") < mediaUnitRank("request"));
  assert.ok(mediaUnitRank("request") < mediaUnitRank("second"));
  assert.ok(mediaUnitRank("second") < mediaUnitRank(null));
  assert.equal(mediaUnitLabel("image"), "元/张");
  assert.equal(mediaUnitLabel("second"), "元/秒");
  assert.equal(mediaUnitLabel(null, "未标单位"), "未标单位");
});
