import { normalizeProxyModelName } from "./matching.js";

// 改提示词或解析协议必须 +1，否则缓存指纹不变，旧结论会一直复用。
export const ASSIST_PROMPT_VERSION = "v2";
export const ASSIST_CANDIDATE_LIMIT = 12;
// 一批 5 条：15 条一批时推理耗时经常越过 60 秒超时，整批 15 条一起记失败；5 条一批实测 11 到 30 秒。
export const ASSIST_BATCH_SIZE = 5;
export const ASSIST_MAX_ATTEMPTS = 3;
// 批次并行上限：批越小批数越多，这里同时压 6 批，整体仍只等一轮往返。别调太高，中转站通常限流。
export const ASSIST_CONCURRENCY = 6;
// 识别是长推理任务，60 秒不够；超时太短会把还在跑的批次当成失败记下来。
export const ASSIST_TIMEOUT_MS = 180000;
// 超时是环境问题，不该像漏答那样被算成「判不出来」；但也不能每次点识别都重发，加一层冷却窗。
export const ASSIST_TIMEOUT_COOLDOWN_MS = 30 * 60 * 1000;
// 判定改成打分制：模型给候选打 0 到 100 分，分数过线的才算命中，结论只剩「是」和「不是」。
export const ASSIST_SCORE_THRESHOLD = 70;
// 一批里接口报错或模型漏答时同一轮内自动重来，最多问 3 次再落失败。
export const ASSIST_RETRIES = 3;
export const ASSIST_RETRY_DELAY_MS = 1500;

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
    "规则：给这条写法最像的候选打 0 到 100 分，分数越高越确定是同一个模型；一个都不像就写 none；不要编造 id；不要输出解释。",
    "输出格式：每行「序号 => id 分数」，例如 1 => openai/gpt-5.5 92。不要代码块，不要多余文字。",
    ""
  ];
  entries.forEach((entry, index) => {
    lines.push(`${index + 1}. 写法：${entry.modelName}`);
    if (entry.stationName) lines.push(`   站点：${entry.stationName}`);
    lines.push(`   候选：${entry.candidates.map(candidate => candidate.id).join(" | ")}`);
  });
  // 一条都别漏：漏答的条目只会被记成失败再问一遍，白烧 token。
  lines.push("", `一共 ${entries.length} 条，每条都要有一行输出，序号从 1 到 ${entries.length}，一条都不能少；拿不准就把分数打低。`);
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
    const [targetId, scoreToken] = value.split(/\s+/);
    // 分数是模型的把握度，缺省按 80 算，兼容只回 id 不写分数的模型。
    const rawScore = Number(scoreToken);
    const score = Math.max(0, Math.min(100, Number.isFinite(rawScore) ? Math.round(rawScore) : 80));
    const hit = (target, status) => ({ key: entry.key, stationId: entry.stationId, modelName: entry.modelName, targetId: target, status, confidence: status === "accepted" ? score / 100 : 0, score });
    if (NONE_VALUES.has(targetId.toLowerCase())) {
      accepted.push(hit("", "none"));
      continue;
    }
    // 只认本次候选里的 id。模型编出来的名字候选里没有，同样记「不是」，结论不分裂成第三种。
    const candidate = entry.candidates.find(item => item.id === targetId);
    if (!candidate) {
      accepted.push(hit("", "none"));
      continue;
    }
    accepted.push(score >= ASSIST_SCORE_THRESHOLD ? hit(candidate.id, "accepted") : hit("", "none"));
  }

  // invalid 保留在返回值里只为兼容调用方，新协议不再产生这种结论。
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
      // 忽略是人工决定，清单刷新也不复活；其余结论还要看指纹是否过期。
      const ignored = cached.status === "ignored";
      // invalid 是旧协议的结论，退出 settled 让它按打分规则重判一次。
      const settled = cached.status === "accepted" || cached.status === "none";
      // 超时是环境问题（模型慢、中转排队），不代表这个写法判不出来，下次还能再问。
      const exhausted = cached.status === "failed" && Number(cached.attempts) >= ASSIST_MAX_ATTEMPTS && cached.reason !== "timeout";
      // 但冷却期内不重发，否则一次偶发超时会让每次点识别都白等一轮。
      const cooling = cached.status === "failed" && cached.reason === "timeout" && Number(cached.nextRetryAt) > Date.now();
      if (ignored || (settled && sameFingerprint) || exhausted || cooling) {
        reused.push({ ...cached, key });
        continue;
      }
    }
    pending.push({ ...entry, key });
  }
  return { pending, reused };
}
// 一批的输出是带分数的短行，基础额度按 1024 给：推理模型的思考过程也算输出，256 会被吃光只剩空正文。
export function assistMaxTokens(batchSize = ASSIST_BATCH_SIZE) {
  const count = Math.max(1, Math.trunc(Number(batchSize)) || ASSIST_BATCH_SIZE);
  return count * 40 + 1024;
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
      // 超时只锁一段时间，冷却结束自动回到待识别；漏答和报错等下一次手动触发。
      nextRetryAt: entry.reason === "timeout" ? at + ASSIST_TIMEOUT_COOLDOWN_MS : 0,
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
// 判定池分三区，界面按区给不同动作：
//   matched   已经归到官方模型（AI 命中或人工指定）→ 撤销、改指定
//   unmatched 还没问过，等识别                     → 识别、人工指定
//   confirm   试过但没成：否定、报错、人工忽略      → 重试、忽略、人工指定
// 已接受条目仍从缓存里取：它一旦生效就不在 unmatched 里，靠 unmatched 拼列表会把它整片弄丢。
export const ASSIST_POOL_MATCHED = "matched";
export const ASSIST_POOL_UNMATCHED = "unmatched";
export const ASSIST_POOL_CONFIRM = "confirm";

export function assistPoolOf(entry = {}) {
  // 人工指定优先：写过覆盖的写法不管 AI 判成什么都已经归位。
  if (entry.manual || entry.status === "accepted") return ASSIST_POOL_MATCHED;
  // 没问过，或者问了还没落结论。
  if (!entry.status) return ASSIST_POOL_UNMATCHED;
  if (entry.status === "pending" && !Number(entry.attempts)) return ASSIST_POOL_UNMATCHED;
  // 剩下的都是「试过但没成」：none / invalid / ignored / failed。
  return ASSIST_POOL_CONFIRM;
}

// 把两个来源拼成同一张表：缓存里有结论的（含已生效）和当前未匹配但没问过的。
// 主键用 cacheKey(stationId, modelName)，同一条在两个来源里只会出现一次。
export function buildAssistPool({ cache = {}, rows = [], stationNameById = new Map(), unmatchedKeys = new Set(), overrides = [] } = {}) {
  const pool = [];
  // 报价已经不在了、结论又不是人工接受的条目，永远发不出去，只留在缓存里当死账。
  const orphans = [];
  const rowByKey = new Map(rows.map(row => [row.key, row]));
  // 人工指定是最高优先级的结论，池里显示的目标以它为准。
  const overrideByKey = new Map();
  for (const item of overrides) {
    const key = cacheKey(item?.stationId, item?.modelName);
    const target = String(item?.officialModelId || "").trim();
    if (key && target) overrideByKey.set(key, target);
  }
  const seen = new Set();
  for (const [key, entry] of Object.entries(cache)) {
    if (!entry?.status) continue;
    const row = rowByKey.get(key);
    const count = row?.count || 0;
    const status = entry.status;
    const manualTarget = overrideByKey.get(key) || "";
    // 只有还等着判的条目会变成死账；定了论的、人工指定过的都留着，删掉要重新问模型或重设覆盖。
    if (!count && !manualTarget && (status === "pending" || status === "failed")) {
      orphans.push({ key, stationId: entry.stationId, modelName: entry.modelName, status });
      continue;
    }
    const poolEntry = {
      key,
      stationId: entry.stationId,
      stationName: row?.stationName || stationNameById.get(entry.stationId) || entry.stationId,
      modelName: entry.modelName,
      displayName: row?.displayName || entry.modelName,
      count,
      candidates: row?.candidates || 0,
      status,
      manual: Boolean(manualTarget),
      failure: status === "failed" ? assistFailureLabel(entry) : "",
      reason: String(entry.reason || ""),
      targetId: manualTarget || entry.targetId || "",
      attempts: Number(entry.attempts) || 0,
      at: Number(entry.at) || 0,
      // 冷却中的超时条目照样留在待确认，界面按这两个字段提示什么时候能再问。
      cooling: status === "failed" && entry.reason === "timeout" && Number(entry.nextRetryAt) > Date.now(),
      nextRetryAt: Number(entry.nextRetryAt) || 0,
      // 已接受的写法如果又出现在未匹配里，说明官方清单换了或 id 失效，界面要标出来。
      stale: status === "accepted" && !manualTarget && unmatchedKeys.has(key)
    };
    poolEntry.pool = assistPoolOf(poolEntry);
    seen.add(key);
    pool.push(poolEntry);
  }
  for (const row of rows) {
    if (seen.has(row.key)) continue;
    const manualTarget = overrideByKey.get(row.key) || "";
    const poolEntry = { ...row, manual: Boolean(manualTarget), targetId: manualTarget || row.targetId || "", stale: false, cooling: false, nextRetryAt: 0 };
    poolEntry.pool = assistPoolOf(poolEntry);
    seen.add(row.key);
    pool.push(poolEntry);
  }
  // 只有人工覆盖、没有任何 AI 结论的写法也要进池，否则写完指定这行就从队列里消失了，改错没处改。
  for (const item of overrides) {
    const key = cacheKey(item?.stationId, item?.modelName);
    const target = String(item?.officialModelId || "").trim();
    if (!key || !target || seen.has(key)) continue;
    const row = rowByKey.get(key);
    seen.add(key);
    const poolEntry = {
      key,
      stationId: item.stationId,
      stationName: row?.stationName || stationNameById.get(item.stationId) || item.stationId,
      modelName: item.modelName,
      displayName: row?.displayName || item.modelName,
      count: row?.count || 0,
      candidates: row?.candidates || 0,
      status: "manual",
      manual: true,
      failure: "",
      reason: "",
      targetId: target,
      attempts: 0,
      at: 0,
      cooling: false,
      nextRetryAt: 0,
      stale: false
    };
    poolEntry.pool = assistPoolOf(poolEntry);
    pool.push(poolEntry);
  }
  return { pool, orphans };
}

// 按区聚合，界面顶部直接读这几个数，不再靠 summarizeCache 那种全量统计。
export function summarizePool(pool = [], orphans = []) {
  const counts = { matched: 0, unmatched: 0, confirm: 0 };
  const failures = { timeout: 0, error: 0, unanswered: 0 };
  const settled = { none: 0, invalid: 0, exhausted: 0, ignored: 0 };
  let stale = 0;
  let cooling = 0;
  for (const entry of pool) {
    counts[entry.pool] += 1;
    if (entry.pool === ASSIST_POOL_MATCHED && entry.stale) stale += 1;
    if (entry.pool !== ASSIST_POOL_CONFIRM) continue;
    if (entry.status === "failed") {
      failures[entry.reason] = (failures[entry.reason] || 0) + 1;
      if (entry.cooling) cooling += 1;
      // 超时是环境问题，重试到顶也不代表判不出来，不算「到顶」。
      if (entry.reason !== "timeout" && Number(entry.attempts) >= ASSIST_MAX_ATTEMPTS) settled.exhausted += 1;
    } else if (entry.status === "none") settled.none += 1;
    else if (entry.status === "invalid") settled.invalid += 1;
    else if (entry.status === "ignored") settled.ignored += 1;
  }
  return { counts, failures, settled, stale, cooling, orphans: orphans.length, total: pool.length };
}

export function poolSummaryLabel(summary) {
  if (!summary.total) return "队列是空的";
  const parts = [`已匹配 ${summary.counts.matched}`, `未匹配 ${summary.counts.unmatched}`, `待确认 ${summary.counts.confirm}`];
  if (summary.cooling) parts.push(`冷却 ${summary.cooling}`);
  if (summary.stale) parts.push(`失效 ${summary.stale}`);
  if (summary.orphans) parts.push(`残留 ${summary.orphans}`);
  return parts.join(" · ");
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