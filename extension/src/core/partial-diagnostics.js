const DIAGNOSTIC_FIELDS = Object.freeze([
  Object.freeze({ key: "unsupportedBillingModes", label: "部分计费模式未解析" }),
  Object.freeze({ key: "invalidPricingValues", label: "价格字段异常" }),
  Object.freeze({ key: "unpricedModels", label: "未定价模型" })
]);

function diagnosticValues(normalized, key) {
  return Array.isArray(normalized?.[key])
    ? normalized[key].map(value => String(value || "").trim()).filter(Boolean)
    : [];
}

export function getPartialDiagnostics(normalized = {}) {
  const reasons = DIAGNOSTIC_FIELDS.map(({ key, label }) => {
    const values = diagnosticValues(normalized, key);
    return values.length ? { key, values, message: `${label}：${values.join(", ")}` } : null;
  }).filter(Boolean);
  return {
    reasons,
    message: reasons.map(reason => reason.message).join("；") || "部分解析"
  };
}
