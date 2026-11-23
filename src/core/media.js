// 本项目只比文本模型的价格。这里只回答「这条报价是不是媒体类型」：判定成 image / video / unknown
// 的报价在 buildComparisonRows 里整条丢掉，既不进比价表，也不占核验数。

const MEDIA_TYPE_ALIASES = new Map([
  ["text", "text"],
  ["token", "text"],
  ["chat", "text"],
  ["completion", "text"],
  ["llm", "text"],
  ["image", "image"],
  ["img", "image"],
  ["image-generation", "image"],
  ["image_generation", "image"],
  ["video", "video"],
  ["vid", "video"],
  ["video-generation", "video"],
  ["video_generation", "video"]
]);

// 时间计费单位：出现这些单位就说明是按秒/分钟卖的媒体，文本没有这种口径。
const TIME_BILLED_UNITS = new Set(["second", "seconds", "per_second", "minute", "minutes", "per_minute"]);

const own = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);

export function normalizeMediaType(value) {
  const key = String(value ?? "").trim().toLowerCase();
  if (!key) return null;
  return MEDIA_TYPE_ALIASES.get(key) || "unknown";
}

function firstMediaType(values) {
  for (const value of values) {
    const normalized = normalizeMediaType(value);
    if (normalized) return normalized;
  }
  return null;
}

function endpointMediaType(endpoints) {
  if (!Array.isArray(endpoints)) return null;
  const normalized = endpoints.map(value => String(value ?? "").trim().toLowerCase());
  if (normalized.some(value => value === "video-generation" || value === "video_generation" || value.includes("video"))) return "video";
  if (normalized.some(value => value === "image-generation" || value === "image_generation" || value.includes("image"))) return "image";
  return null;
}

export function mediaTypeForPricing(item = {}, { targetField = "" } = {}) {
  const explicit = firstMediaType([
    item.media_type,
    item.mediaType,
    item.modality,
    item.media
  ]);
  if (explicit) return explicit;

  const endpointType = endpointMediaType(item.supported_endpoint_types);
  if (endpointType) return endpointType;

  const billingUsageSchema = item.billing_usage_schema || item.billingUsageSchema;
  if (billingUsageSchema && typeof billingUsageSchema === "object" && own(billingUsageSchema, "seconds")) return "video";

  const billingMode = String(item.billing_mode || item.billingMode || "").trim().toLowerCase();
  if (["image", "per_image", "per_image_generation"].includes(billingMode)) return "image";
  if (["video", "per_video", "per_second", "per_minute"].includes(billingMode)) return "video";
  // 按秒、按分钟计费的只有视频；文本从不按时间卖，见到就整条丢掉。
  const billingUnit = String(item.request_unit || item.requestUnit || item.billing_unit || item.billingUnit || "").trim().toLowerCase();
  if (TIME_BILLED_UNITS.has(billingUnit)) return "video";

  if (targetField === "image") return "image";

  const videoIndependent = item.video_rate_independent === true || String(item.video_rate_independent ?? "").trim().toLowerCase() === "true";
  const hasVideoPricing = videoIndependent || ["video_rate_multiplier", "per_second_price", "per_minute_price", "video_price"].some(key => Number(item[key]) > 0);
  if (targetField === "request" && hasVideoPricing) return "video";

  const imagePrice = Number(item.image_price ?? item.imagePrice);
  return Number.isFinite(imagePrice) && imagePrice > 0 ? "image" : null;
}

export function mediaSpecsOf(item = {}) {
  const value = item.media_specs ?? item.mediaSpecs ?? item.billing_usage_schema ?? item.billingUsageSchema;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return { ...value };
}
