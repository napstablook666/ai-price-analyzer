// 生图模型的计价口径归一。
//
// 文本模型永远能写成「单价 × token 数」，生图模型不是：可能按张、按图输出 token、
// 按像素、按次收钱。四种口径不能直接比大小，所以统一折算到「元/张（标准出图规格）」
// 再比。折算不出来的返回 null，调用方显示「—」，绝不编一个系数出来。

export const IMAGE_REFERENCE = Object.freeze({
  size: "1024×1024",
  quality: "medium",
  megapixels: (1024 * 1024) / 1_000_000,
  imagesPerRequest: 1
});

export const IMAGE_UNITS = ["image", "token", "megapixel", "request"];

export const IMAGE_UNIT_LABELS = {
  image: "元/张",
  token: "元/1M 图token",
  megapixel: "元/MP",
  request: "元/次"
};

export const IMAGE_UNIT_SUFFIXES = {
  image: "/张",
  token: "/1M",
  megapixel: "/MP",
  request: "/次"
};

// 一行的计价单位决定它进哪个榜。元/张 和 元/1M 图token 之间差一个「每张多少 token」
// 的系数，官方常常没公布，所以这两个只能分榜看，不能合并排序。
export const MEDIA_UNITS = ["image", "token", "megapixel", "request", "second"];

export const MEDIA_UNIT_LABELS = {
  image: "元/张",
  token: "元/1M 图token",
  megapixel: "元/MP",
  request: "元/次",
  second: "元/秒"
};

const MEDIA_UNIT_RANKS = new Map(MEDIA_UNITS.map((unit, index) => [unit, index]));

export function mediaUnitRank(unit) {
  return MEDIA_UNIT_RANKS.has(unit) ? MEDIA_UNIT_RANKS.get(unit) : MEDIA_UNITS.length;
}

export function mediaUnitLabel(unit, fallback = "未标单位") {
  return MEDIA_UNIT_LABELS[unit] || fallback;
}

export const IMAGE_SIZE_TIERS = ["768", "1K", "1.5K", "2K", "4K", "unstated"];

export const IMAGE_QUALITY_TIERS = ["low", "high", "unstated"];

// 像素边长 → 档位。取长边，够 4K 才进 4K。
function sizeOfPixels(pixels) {
  if (pixels >= 3800) return "4K";
  if (pixels >= 1900) return "2K";
  if (pixels >= 1400) return "1.5K";
  if (pixels >= 900) return "1K";
  if (pixels >= 700) return "768";
  return "unstated";
}

// 官方的 variant 一串里塞了尺寸和质量（`low_2k`、`2048x2048`、`high_resolution`）。
// 拆不出来的进 unstated，不猜。`high_resolution` 说的是分辨率不是质量，别误判成 high。
export function imageTierOf(variant = "", quality = "") {
  const raw = String(variant ?? "").trim().toLowerCase();
  const explicitQuality = String(quality ?? "").trim().toLowerCase();
  let tierQuality = "unstated";
  if (explicitQuality === "low" || explicitQuality === "high") tierQuality = explicitQuality;
  else if (!raw.includes("resolution")) {
    if (/(^|_)low($|_)/.test(raw)) tierQuality = "low";
    else if (/(^|_)high($|_)/.test(raw)) tierQuality = "high";
  }
  let tierSize = "unstated";
  const dimensions = raw.match(/(\d{3,4})\s*[x×]\s*(\d{3,4})/);
  if (dimensions) {
    tierSize = sizeOfPixels(Math.max(Number(dimensions[1]), Number(dimensions[2])));
  } else if (/(^|_)768($|_)/.test(raw)) tierSize = "768";
  else if (/(^|_)1\.5k($|_)/.test(raw)) tierSize = "1.5K";
  else if (/(^|_)1k($|_)/.test(raw)) tierSize = "1K";
  else if (/(^|_)2k($|_)/.test(raw)) tierSize = "2K";
  else if (/(^|_)4k($|_)/.test(raw)) tierSize = "4K";
  return { size: tierSize, quality: tierQuality };
}

// 一组同单位的报价怎么标：`1K`、`low`、`1K · low`、`规格未标注`。
export function imageTierLabel(tier = {}) {
  const size = IMAGE_SIZE_TIERS.includes(tier.size) ? tier.size : "unstated";
  const quality = IMAGE_QUALITY_TIERS.includes(tier.quality) ? tier.quality : "unstated";
  const parts = [size === "unstated" ? "" : size, quality === "unstated" ? "" : quality].filter(Boolean);
  return parts.length ? parts.join(" · ") : "规格未标注";
}

// 一张图多少输出 token。只登记官方公开过的值，查不到返回 null。
// gpt-image 系 1024²：low 272 / medium 1056 / high 4160，这里取 medium。
// Gemini 2.5 Flash Image：Google 文档写每张 1290 tokens。
const TOKENS_PER_IMAGE = [
  { pattern: /^openai\/gpt-image-1($|-)/, tokens: 1056 },
  { pattern: /^openai\/gpt-image-2($|-)/, tokens: 1056 },
  { pattern: /^google\/gemini-2\.5-flash-image$/, tokens: 1290 }
];

export function tokensPerImage(modelId = "") {
  const key = String(modelId || "").trim().toLowerCase();
  return TOKENS_PER_IMAGE.find(entry => entry.pattern.test(key))?.tokens ?? null;
}

// 站内报价可能同时报张价和图 token 价。优先用与官方同口径的那一档，
// 没有官方参照时按「张 → 图 token」的顺序取。
export function pickImageQuote(prices = {}, preferredUnit = "") {
  const candidates = [
    { unit: "image", value: Number(prices.imagePrice) },
    { unit: "token", value: Number(prices.imageOutput) }
  ].filter(entry => Number.isFinite(entry.value) && entry.value > 0);
  if (!candidates.length) return null;
  return candidates.find(entry => entry.unit === preferredUnit) || candidates[0];
}

// 任一计价单位 → 元/张。假设写进 assumption，展示时要跟着价格一起出现。
export function toPerImage(quote, modelId = "") {
  if (!quote) return null;
  if (quote.unit === "image") return { perImage: quote.value, assumption: "" };
  if (quote.unit === "megapixel") {
    const megapixels = IMAGE_REFERENCE.megapixels;
    return {
      perImage: quote.value * megapixels,
      assumption: `按 ${IMAGE_REFERENCE.size}、${megapixels.toFixed(6)} MP/张 折算`
    };
  }
  if (quote.unit === "request") {
    const count = IMAGE_REFERENCE.imagesPerRequest;
    return { perImage: quote.value / count, assumption: `按 ${count} 张/次 折算` };
  }
  if (quote.unit === "token") {
    const tokens = tokensPerImage(modelId);
    if (tokens === null) return null;
    return {
      perImage: quote.value * tokens / 1_000_000,
      assumption: `按 ${tokens} tokens/张（${IMAGE_REFERENCE.size} ${IMAGE_REFERENCE.quality}）折算`
    };
  }
  return null;
}

// 四档比价：direct = 同单位同规格（元/张）；same-unit = 同单位但非张价；
// converted = 跨单位折算，带假设标签且不参与推荐；tier-mismatch = 规格对不上，不给百分比；
// none = 比不了。
// 站内报价没有尺寸字段，标成 unstated。官方标了 1K 就说明两边说的不是同一张图，
// 这时候同单位也不给百分比，只把两个数并排放着让人自己看。
export function compareImageQuote(stationQuote, officialQuote, modelId = "", stationTier = null, officialTier = null) {
  const none = { kind: "none", diffPercent: null, assumption: "" };
  if (!stationQuote || !officialQuote) return none;
  const stationLabel = stationTier ? imageTierLabel(stationTier) : "";
  const officialLabel = officialTier ? imageTierLabel(officialTier) : "";
  const tierMismatch = Boolean(stationLabel && officialLabel && stationLabel !== officialLabel);
  if (stationQuote.unit === officialQuote.unit) {
    if (!(officialQuote.value > 0)) return none;
    if (tierMismatch) {
      return { kind: "tier-mismatch", diffPercent: null, assumption: `${stationLabel} 对 ${officialLabel}` };
    }
    return {
      kind: stationQuote.unit === "image" ? "direct" : "same-unit",
      diffPercent: (stationQuote.value - officialQuote.value) / officialQuote.value * 100,
      assumption: ""
    };
  }
  const stationPerImage = toPerImage(stationQuote, modelId);
  const officialPerImage = toPerImage(officialQuote, modelId);
  if (!stationPerImage || !officialPerImage || !(officialPerImage.perImage > 0)) return none;
  return {
    kind: "converted",
    diffPercent: (stationPerImage.perImage - officialPerImage.perImage) / officialPerImage.perImage * 100,
    assumption: [stationPerImage.assumption, officialPerImage.assumption].filter(Boolean).join("；")
  };
}

// 生图行不按月成本分档，按元/张的价差分档。折算比不进推荐。
export function imageCategoryOf(compare) {
  // 跨单位折算是估出来的，规格对不上的连数都没有，两种都不给档位。
  if (!compare || compare.kind === "none" || compare.kind === "converted" || compare.kind === "tier-mismatch") return "";
  if (!Number.isFinite(compare.diffPercent)) return "";
  if (compare.diffPercent < -40) return "excellent";
  if (compare.diffPercent < -2) return "good";
  if (compare.diffPercent > 50) return "bad";
  return "fair";
}
