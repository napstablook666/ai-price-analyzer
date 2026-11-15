import { normalizeProxyModelName } from "./matching.js";

// 改提示词或解析协议必须 +1，否则缓存指纹不变，旧结论会一直复用。
export const ASSIST_PROMPT_VERSION = "v1";
export const ASSIST_CANDIDATE_LIMIT = 12;
export const ASSIST_BATCH_SIZE = 15;
export const ASSIST_MAX_ATTEMPTS = 3;

const GENERIC_MODEL_TOKENS = new Set([
  "ai", "api", "chat", "model", "models", "llm", "pro", "max", "plus", "turbo",
  "latest", "preview", "beta", "alpha", "stable", "new", "free", "mini", "lite",
  "flash", "thinking", "reasoning", "instruct", "base", "omni", "high", "low", "medium"
]);

function modelTokens(name) {
const tokens = new Set();
  for (const token of normalizeProxyModelName(name).split(/[^a-z0-9]+/)) {
    // 字母数字紧贴的写法（gpt5、claude4）拆开，否则和 gpt-5 对不上。
    for (const part of token.match(/[a-z]+|\d+/g) || []) {
      if (part.length > 1 && !GENERIC_MODEL_TOKENS.has(part)) tokens.add(part);
    }
  }
  return tokens;
}

function officialNames(model) {
  return [...new Set([model?.name, model?.display_name, model?.id, ...(model?.aliases || [])].filter(Boolean).map(value => String(value)))];
}

// 站点写法与官方名字的 token 重叠打分，给判定用的短名单。
export function suggestModelCandidates(proxyName, officialList = [], limit = ASSIST_CANDIDATE_LIMIT) {
  const tokens = modelTokens(proxyName);
  if (!tokens.size) return [];
  const count = Math.min(ASSIST_CANDIDATE_LIMIT, Math.max(1, Math.trunc(Number(limit)) || ASSIST_CANDIDATE_LIMIT));
  return officialList
    .map(model => {
      const score = Math.max(0, ...officialNames(model).map(name => {
        const candidateTokens = modelTokens(name);
        const shared = [...tokens].filter(token => candidateTokens.has(token)).length;
        return shared / Math.max(tokens.size, candidateTokens.size || 1);
      }));
      return { model, score };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || String(a.model.id).localeCompare(String(b.model.id)))
    .slice(0, count)
    .map(({ model }) => model);
}

// 比价行里规则落到 unmatched 的，就是待识别池。
export function collectUnmatchedModels(rows = []) {
  const seen = new Map();
  for (const row of rows) {
    if (row.matchRuleId !== "unmatched") continue;
    const stationId = String(row.stationId || "").trim();
    const modelName = String(row.modelName || "").trim();
    if (!stationId || !modelName) continue;
    const key = cacheKey(stationId, modelName);
    const existing = seen.get(key);
    if (existing) {
      existing.count += 1;
      continue;
    }
    seen.set(key, {
      key,
      stationId,
      stationName: String(row.stationName || "").trim(),
      modelName,
      displayName: String(row.displayName || modelName).trim(),
      count: 1
    });
  }
  return [...seen.values()].sort((left, right) => left.stationName.localeCompare(right.stationName) || left.modelName.localeCompare(right.modelName));
}

export function cacheKey(stationId, modelName) {
  return `${String(stationId || "").trim()}\u0000${normalizeProxyModelName(modelName)}`;
}

// FNV-1a：只用来做内容指纹，不做安全用途。
export function stableHash(input) {
  let hash = 0x811c9dc5;
  const text = String(input ?? "");
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function assistFingerprint({ candidateIds = [], referencesFetchedAt = 0 } = {}) {
  return `${ASSIST_PROMPT_VERSION}:${stableHash(candidateIds.join(","))}:${Number(referencesFetchedAt) || 0}`;
}

export function buildAssistEntries({ unmatched = [], officialList = [], referencesFetchedAt = 0, limit = ASSIST_CANDIDATE_LIMIT } = {}) {
  return unmatched.map(entry => {
    const candidates = suggestModelCandidates(entry.modelName, officialList, limit);
    // 官方条目不一定带 id（OpenRouter 解析件只保证有 name），判定目标要和 modelById 的 id || name 对齐。
    const candidateId = model => String(model.id || model.name || "").trim();
    const candidateIds = candidates.map(candidateId).filter(Boolean);
    return {
      ...entry,
      key: cacheKey(entry.stationId, entry.modelName),
      candidates: candidates.map(model => ({
        id: candidateId(model),
        name: String(model.name || model.id || "").trim(),
        displayName: String(model.display_name || model.name || model.id || "").trim()
      })).filter(model => model.id),
      fingerprint: assistFingerprint({ candidateIds, referencesFetchedAt }),
      referencesFetchedAt: Number(referencesFetchedAt) || 0
    };
  }).filter(entry => entry.candidates.length);
}

export function buildAssistPrompt(entries = []) {
  const lines = [
    "你在做模型名归一。每条给出一个中转站的模型写法和它的候选规范模型 id。",
    "规则：只能从该条的候选里选一个 id；没有合适的就写 none；不要编造 id；不要输出解释。",
    "输出格式：每行「序号 => id」，例如 1 => openai/gpt-5.5。不要代码块，不要多余文字。",
    ""
  ];
  entries.forEach((entry, index) => {
    lines.push(`${index + 1}. 写法：${entry.modelName}`);
    if (entry.stationName) lines.push(`   站点：${entry.stationName}`);
    lines.push(`   候选：${entry.candidates.map(candidate => candidate.id).join(" | ")}`);
  });
  return lines.join("\n");
}

const LINE_PATTERN = /^\s*(\d+)\s*(?:=>|->|:|：)\s*(.+?)\s*$/;
const NONE_VALUES = new Set(["none", "null", "无", "没有", "-", "n/a"]);

export function parseAssistResponse(text, { entries = [] } = {}) {
  const accepted = [];
  const invalid = [];
  const ignored = [];
  const byIndex = new Map(entries.map((entry, index) => [index + 1, entry]));
  let matchedLines = 0;

  for (const rawLine of String(text || "").split(/\r?\n/)) {
    const line = rawLine.replace(/^```[a-z]*\s*$/i, "").trim();
    if (!line) continue;
    const parsed = LINE_PATTERN.exec(line);
    if (!parsed) continue;
    const entry = byIndex.get(Number(parsed[1]));
    if (!entry) {
      ignored.push({ line, reason: "unknown-index" });
      continue;
    }
    matchedLines += 1;
    const value = parsed[2].replace(/^[`"'（(]+|[`"'）)]+$/g, "").trim();
    const targetId = value.split(/\s+/)[0];
    if (NONE_VALUES.has(targetId.toLowerCase())) {
      accepted.push({ key: entry.key, stationId: entry.stationId, modelName: entry.modelName, targetId: "", status: "none", confidence: 0 });
      continue;
    }
    // 只认本次候选里的 id，模型自己造出来的 id 一律作废。
    const candidate = entry.candidates.find(item => item.id === targetId);
    if (candidate) {
      accepted.push({ key: entry.key, stationId: entry.stationId, modelName: entry.modelName, targetId: candidate.id, status: "accepted", confidence: 0.8 });
    } else {
      invalid.push({ key: entry.key, stationId: entry.stationId, modelName: entry.modelName, targetId, status: "invalid", confidence: 0 });
    }
  }

  return { accepted, invalid, ignored, matchedLines, entryCount: entries.length };
}

// 逆：把上一轮结论转成人工覆盖时用得上，保持 targetId 与官方 id 同一形态。
export function overrideFromAssist(entry) {
  if (!entry || entry.status !== "accepted" || !entry.targetId) return null;
  return { stationId: entry.stationId, modelName: entry.modelName, officialModelId: entry.targetId };
}

export function selectPendingEntries({ cache = {}, entries = [], referencesFetchedAt = 0, force = false } = {}) {
  const pending = [];
  const reused = [];
  for (const entry of entries) {
    const key = entry.key || cacheKey(entry.stationId, entry.modelName);
    const cached = cache[key];
    if (!force && cached) {
      // 指纹盖住提示词版本、候选集合、官方清单时间三样，指纹一致就是输入没变。
      const sameFingerprint = cached.fingerprint === entry.fingerprint;
      const settled = cached.status === "accepted" || cached.status === "invalid" || cached.status === "none";
      const exhausted = cached.status === "failed" && Number(cached.attempts) >= ASSIST_MAX_ATTEMPTS;
      if ((settled && sameFingerprint) || exhausted) {
        reused.push({ ...cached, key });
        continue;
      }
    }
    pending.push({ ...entry, key });
  }
  return { pending, reused };
}

export function applyAssistResults(cache = {}, results = [], { fingerprintByKey = {}, notAsked = [] } = {}) {
  const next = { ...cache };
  const at = Date.now();
  for (const result of results) {
    const key = result.key || cacheKey(result.stationId, result.modelName);
    const previous = next[key] || {};
    next[key] = {
      stationId: result.stationId,
      modelName: result.modelName,
      targetId: result.targetId || "",
      status: result.status,
      confidence: Number(result.confidence) || 0,
      attempts: Number(previous.attempts || 0) + 1,
      fingerprint: fingerprintByKey[key] || result.fingerprint || "",
      referencesFetchedAt: Number(result.referencesFetchedAt) || 0,
      at,
      previous: previous.status ? { status: previous.status, targetId: previous.targetId || "", at: previous.at || 0 } : null
    };
  }
  // 没被问到的条目（响应里缺该序号）记一次失败，避免同一批反复重问。
  for (const entry of notAsked) {
    const key = entry.key || cacheKey(entry.stationId, entry.modelName);
    const previous = next[key] || {};
    next[key] = {
      stationId: entry.stationId,
      modelName: entry.modelName,
      targetId: "",
      status: "failed",
      confidence: 0,
      attempts: Number(previous.attempts || 0) + 1,
      fingerprint: entry.fingerprint || "",
      referencesFetchedAt: Number(entry.referencesFetchedAt) || 0,
      at,
      previous: previous.status ? { status: previous.status, targetId: previous.targetId || "", at: previous.at || 0 } : null
    };
  }
  return next;
}

export function llmMatchesFromCache(cache = {}) {
  const matches = {};
  for (const entry of Object.values(cache)) {
    if (entry?.status !== "accepted" || !entry.targetId) continue;
    const normalized = normalizeProxyModelName(entry.modelName);
    if (!normalized) continue;
    matches[entry.stationId] ||= {};
    matches[entry.stationId][normalized] = entry.targetId;
  }
  return matches;
}

export function summarizeCache(cache = {}) {
  const counts = { accepted: 0, none: 0, invalid: 0, failed: 0 };
  for (const entry of Object.values(cache)) {
    if (entry?.status && counts[entry.status] !== undefined) counts[entry.status] += 1;
  }
  return { ...counts, total: Object.keys(cache).length };
}