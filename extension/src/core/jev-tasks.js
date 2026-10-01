import { JEV_MODEL_CANDIDATE_LIMIT } from "./matching.js";
export const JEV_NO_MATCH = "__no_match__";

function safeLabel(value) {
  return String(value || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
}

export const JEV_COMPARISON_LABELS = {
  stale_data: "中转报价已过期",
  estimated_proxy_prices: "部分中转价格为估算值",
  tiered_or_group_pricing: "报价受分组或时段影响",
  incomplete_official_reference: "官方参考价格字段不完整",
  uncertain_model_match: "官方模型匹配置信度较低",
  no_obvious_issue: "未发现明显可比性问题",
  insufficient_evidence: "现有字段不足，建议人工核对"
};

export function resolveJevTaskConfig(settings, apiKey) {
  const jev = settings?.jev || {};
  const baseUrl = String(jev.baseUrl || "").trim();
  const model = String(jev.modelId || "").trim();
  const key = String(apiKey || "").trim();
  if (!baseUrl) throw new Error("请在设置中配置独立的 JEV API 地址");
  if (!model) throw new Error("请在设置中选择 JEV 模型");
  if (!key) throw new Error("请在设置中配置独立的 JEV API Key");
  return { baseUrl, model, apiKey: key };
}

export function isExtensionPageSender(sender, extensionRootUrl) {
  return Boolean(extensionRootUrl && String(extensionRootUrl).endsWith("/") && String(sender?.url || "").startsWith(extensionRootUrl));
}

export function buildJevModelMatchTask(proxyModelName, candidates = []) {
  const proxyModel = safeLabel(proxyModelName);
  if (!proxyModel) throw new Error("中转模型名称为空");
  const seen = new Set();
  const officialCandidates = candidates.filter(candidate => {
    const id = String(candidate?.id || candidate?.name || "").trim();
    if (!id || id.length > 200 || /[\u0000-\u001f\u007f]/.test(id) || id === JEV_NO_MATCH || seen.has(id)) return false;
    seen.add(id);
    return true;
  }).slice(0, JEV_MODEL_CANDIDATE_LIMIT).map(candidate => ({
    id: String(candidate.id || candidate.name).trim(),
    name: safeLabel(candidate.name) || safeLabel(candidate.id),
    provider: safeLabel(candidate.provider),
    aliases: (Array.isArray(candidate.aliases) ? candidate.aliases : []).map(value => safeLabel(value)).filter(Boolean).slice(0, 8)
  }));
  if (!officialCandidates.length) throw new Error("没有可供 JEV 判断的官方模型候选");

  const criteria = Object.fromEntries(officialCandidates.map(candidate => [
    candidate.id,
    [candidate.name, candidate.provider, candidate.aliases.length ? `aliases: ${candidate.aliases.join(", ")}` : ""].filter(Boolean).join("; ")
  ]));
  criteria[JEV_NO_MATCH] = "None of the listed official models matches, or the evidence is insufficient.";
  return {
    state: { proxy_model: proxyModel },
    questions: {
      model_match: {
        type: "choice",
        instructions: `Choose the official model that represents the same underlying model as proxy_model. Choose ${JEV_NO_MATCH} if none fit or the evidence is uncertain.`,
        criteria
      }
    }
  };
}

export function buildJevComparisonTask(offer = {}) {
  const fields = ["input", "output", "cacheRead", "cacheWrite", "request", "imageOutput", "imagePrice"];
  const presentFields = prices => fields.filter(field => Number.isFinite(prices?.[field]));
  const delta = offer.diffPercent === null || offer.diffPercent === undefined ? NaN : Number(offer.diffPercent);
  const priceGapDirection = !Number.isFinite(delta)
    ? "unavailable"
    : Math.abs(delta) < 0.005 ? "near_equal" : delta > 0 ? "proxy_higher" : "proxy_cheaper";
  const groupRatio = offer.groupRatio === null || offer.groupRatio === undefined ? NaN : Number(offer.groupRatio);
  const matchConfidence = offer.matchConfidence === null || offer.matchConfidence === undefined ? NaN : Number(offer.matchConfidence);
  const estimatedProxyFields = [
    ...(offer.cacheReadEstimated ? ["cacheRead"] : []),
    ...(offer.cacheWriteEstimated ? ["cacheWrite"] : [])
  ];
  const criteria = {
    stale_data: JEV_COMPARISON_LABELS.stale_data,
    estimated_proxy_prices: JEV_COMPARISON_LABELS.estimated_proxy_prices,
    tiered_or_group_pricing: JEV_COMPARISON_LABELS.tiered_or_group_pricing,
    incomplete_official_reference: JEV_COMPARISON_LABELS.incomplete_official_reference,
    uncertain_model_match: JEV_COMPARISON_LABELS.uncertain_model_match,
    no_obvious_issue: JEV_COMPARISON_LABELS.no_obvious_issue,
    insufficient_evidence: JEV_COMPARISON_LABELS.insufficient_evidence
  };
  return {
    state: {
      proxy_model: safeLabel(offer.modelName),
      official_model: safeLabel(offer.officialName),
      comparison: {
        price_gap_direction: priceGapDirection,
        proxy_price_fields: presentFields(offer.prices),
        official_price_fields: presentFields(offer.officialPrices),
        stale: Boolean(offer.stale),
        estimated_proxy_fields: estimatedProxyFields,
        tiered_pricing: Boolean(offer.tierName && offer.tierName !== "标准"),
        group_ratio_applied: Number.isFinite(groupRatio) && Math.abs(groupRatio - 1) > 0.0001,
        uncertain_model_match: Number.isFinite(matchConfidence) && matchConfidence < 0.8 || offer.matchRuleId === "fuzzy",
        evidence: offer.evidence === "estimated" ? "estimated" : "direct"
      }
    },
    questions: {
      comparison_review: {
        type: "choice",
        instructions: "Choose the single most relevant review reason using only the supplied fields. Do not calculate prices or infer missing data. Choose insufficient_evidence when the fields do not support a conclusion.",
        criteria
      }
    }
  };
}
