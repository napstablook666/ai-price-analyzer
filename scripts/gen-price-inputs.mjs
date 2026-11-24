// 给 price-fields-rs 生成真实输入用例：9 个价格字段 × 11 种取值形态（缺键 / 0 / 空串 / null / 字符串 / false）。
// 用法：node scripts/gen-price-inputs.mjs 然后 rust-anything record rust/price-fields-rs --inputs rust/price-fields-rs/cases-inputs.jsonl
import { PRICE_FIELD_DEFINITIONS } from "../src/core/price-fields.js";
import { writeFileSync } from "node:fs";

const items = [
  {},
  { input_price: 0.5 },
  { inputPrice: 0 },
  { input: "" },
  { prompt_price: null, input_price: null, inputPrice: 7 },
  { cache_read_price: 0.02, cacheWritePrice: 0.03 },
  { request_price: 0.01, image_price: 0.2 },
  { imageInputPrice: 0.1, imageOutputPrice: 0.4 },
  { input_price: "0.3", inputPrice: 0.4 },
  { input_price: false },
  { cache_write_1h_price: 0.05 }
];

const rows = [];
for (const field of PRICE_FIELD_DEFINITIONS) for (const item of items) rows.push({ fn: "rawPriceValue", args: [item, field] });
writeFileSync(new URL("../rust/price-fields-rs/cases-inputs.jsonl", import.meta.url), rows.map(row => JSON.stringify(row)).join("\n") + "\n");
console.log(`rows ${rows.length}`);
