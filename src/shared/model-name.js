const MODEL_DECORATIONS = [
  /:(?:free|thinking|official|fast|online|extended|beta|none|auto|batch)$/,
  /:peft:\d+$/,
  /@(?:eu|us|global|jp|au|in|cn|default|\d+)$/,
  /-v\d+(?::\d+)?$/,
  /-(?:19|20)\d{2}(?:0\d|1[0-2])?(?:[0-3]\d)?$/,
  // OpenRouter image route suffixes are equivalent to the base model for identity and pricing.
  /-(?:flare|sunburst)$/
];

export function stripModelDecoration(value) {
  let current = String(value || "").toLowerCase().trim();
  for (let round = 0; round < 3; round += 1) {
    const before = current;
    for (const pattern of MODEL_DECORATIONS) current = current.replace(pattern, "");
    if (current === before) break;
  }
  return current;
}

export function bareModelSpelling(id) {
  const segments = String(id || "").toLowerCase().trim().split("/").filter(Boolean);
  return stripModelDecoration(segments[segments.length - 1] || "");
}

export function canonicalModelKey(value) {
  const base = String(value || "").trim().replace(/^(?:[\[【][^\]】]*[\]】]\s*)+/, "");
  return bareModelSpelling(base).replace(/[\s._]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}
