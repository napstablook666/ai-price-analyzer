import { normalizeProxyModelName } from "./matching.js";

// 改提示词或解析协议必须 +1，否则缓存指纹不变，旧结论会一直复用。
export const ASSIST_PROMPT_VERSION = "v1";
export const ASSIST_CANDIDATE_LIMIT = 12;
// 一批 5 条：15 条一批时推理耗时经常越过 60 秒超时，整批 15 条一起记失败；5 条一批实测 11 到 30 秒。
export const ASSIST_BATCH_SIZE = 5;
export const ASSIST_MAX_ATTEMPTS = 3;
// 批次并行上限：批越小批数越多，这里同时压 6 批，整体仍只等一轮往返。别调太高，中转站通常限流。
export const ASSIST_CONCURRENCY = 6;
// 识别是长推理任务，60 秒不够；超时太短会把还在跑的批次当成失败记下来。
export const ASSIST_TIMEOUT_MS = 180000;

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
      // 超时是环境问题（模型慢、中转排队），不代表这个写法判不出来，下次还能再问。
      const exhausted = cached.status === "failed" && Number(cached.attempts) >= ASSIST_MAX_ATTEMPTS && cached.reason !== "timeout";
      if ((settled && sameFingerprint) || exhausted) {
        reused.push({ ...cached, key });
        continue;
      }
    }
    pending.push({ ...entry, key });
  }
  return { pending, reused };
}
// 一批的输出就是一串短行，给足余量再封顶，避免模型自由发挥把等待时间拉长。
export function assistMaxTokens(batchSize = ASSIST_BATCH_SIZE) {
  const count = Math.max(1, Math.trunc(Number(batchSize)) || ASSIST_BATCH_SIZE);
  return count * 20 + 256;
}

// 同一个写法在不同站点往往指向同一个模型，候选也完全一样：问一次，答案按候选集合分发到各站点。
// 签名带上候选 id 列表，候选不同的写法不会被合并。
export function collapseAssistEntries(entries = []) {
  const groups = new Map();
  const followers = new Map();
  for (const entry of entries) {
    const signature = `${normalizeProxyModelName(entry.modelName)}\u0000${(entry.candidates || []).map(candidate => candidate.id).join(",")}`;
    const primary = groups.get(signature);
    if (!primary) {
      groups.set(signature, entry);
      followers.set(entry.key, []);
      continue;
    }
    followers.get(primary.key).push(entry);
  }
  return { primary: [...groups.values()], followers };
}

// 把主条目的结论摊回同一签名的其它站点条目，成功后与失败重问用的是同一个出口。
export function spreadAssistResults(results = [], followers = new Map()) {
  if (!followers.size) return results;
  const spread = [];
  for (const result of results) {
    spread.push(result);
    for (const follower of followers.get(result.key) || []) {
      spread.push({ ...result, key: follower.key, stationId: follower.stationId, modelName: follower.modelName, fingerprint: follower.fingerprint });
    }
  }
  return spread;
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
  // 失败原因写进缓存：超时、接口报错、模型漏答要能分开看，否则界面上只剩一个 failed。
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
      reason: String(entry.reason || "unanswered"),
      error: String(entry.error || ""),
      previous: previous.status ? { status: previous.status, targetId: previous.targetId || "", at: previous.at || 0 } : null
    };
  }
  return next;
}

// 失败原因分得开才修得动：超时和漏答是两回事，前者要加时或缩批，后者要改提示词。
export const ASSIST_FAILURE_LABELS = {
  timeout: "请求超时",
  error: "接口报错",
  unanswered: "模型没答这条"
};

export function assistFailureLabel(entry) {
  if (!entry || entry.status !== "failed") return "";
  const label = ASSIST_FAILURE_LABELS[entry.reason] || ASSIST_FAILURE_LABELS.unanswered;
  const detail = String(entry.error || "").trim();
  return detail ? `${label}：${detail}` : label;
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