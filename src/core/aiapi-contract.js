export const AIAPI_GROUP_PRICE_FIELDS = ["billingMultiplier"];
export const AIAPI_EFFECTIVE_PRICE_FIELDS = [
  "inputPer1M", "outputPer1M", "cacheReadPer1M", "cacheCreatePer1M", "cacheCreate1hPer1M"
];
export const AIAPI_PRICE_KEYS = new Set([
  ...AIAPI_GROUP_PRICE_FIELDS,
  ...AIAPI_EFFECTIVE_PRICE_FIELDS
].map(key => key.toLowerCase()));
