export const COMPARISON_MEDIA_MODES = Object.freeze(["text", "image", "video"]);

export const MEDIA_MODE_LABELS = Object.freeze({
  text: "文本",
  image: "生图",
  video: "视频"
});

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

export function mediaModeOf(value) {
  const normalized = normalizeMediaType(value);
  return COMPARISON_MEDIA_MODES.includes(normalized) ? normalized : "text";
}

export function mediaModeMatches(row = {}, mode = "text") {
  const currentMode = COMPARISON_MEDIA_MODES.includes(mode) ? mode : "text";
  const rowType = normalizeMediaType(row.mediaType ?? row.media_type) || "text";
  return rowType === currentMode;
}

