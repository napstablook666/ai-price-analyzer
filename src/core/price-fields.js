import { rawPriceValue as rawPriceValueFromRust } from "./rust-price-shim.js";

export const PRICE_FIELD_DEFINITIONS = Object.freeze([
  { standard: "input", normalized: "input_price", aliases: ["input_price", "inputPrice", "input", "prompt_price"] },
  { standard: "output", normalized: "output_price", aliases: ["output_price", "outputPrice", "output", "completion_price"] },
  { standard: "cacheRead", normalized: "cache_read_price", aliases: ["cache_read_price", "cacheReadPrice", "cache_read"] },
  { standard: "cacheWrite", normalized: "cache_write_price", aliases: ["cache_write_price", "cacheWritePrice", "cache_write"] },
  { standard: "cacheWrite1h", normalized: "cache_write_1h_price", aliases: ["cache_write_1h_price", "cacheWrite1hPrice", "cache_write_1h"] },
  { standard: "request", normalized: "request_price", aliases: ["request_price", "requestPrice", "request"] },
  { standard: "imageInput", normalized: "image_input_price", aliases: ["image_input_price", "imageInputPrice", "image_input_token_price"] },
  { standard: "imageOutput", normalized: "image_output_price", aliases: ["image_output_price", "imageOutputPrice", "image_token_price"] },
  { standard: "imagePrice", normalized: "image_price", aliases: ["image_price", "imagePrice", "per_image_price"] }
]);

export const STANDARD_PRICE_FIELDS = Object.freeze(PRICE_FIELD_DEFINITIONS.map(field => field.standard));
export const NORMALIZED_PRICE_FIELDS = Object.freeze(PRICE_FIELD_DEFINITIONS.map(field => field.normalized));

export function rawPriceValue(item, field) {
  return rawPriceValueFromRust(item, field);
}
