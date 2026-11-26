// 计费表达式解析：从站点写的 `tier(...)` 表达式里拆出价格档位（token / 按次 / 按秒 / 按张）。
// 纯字符串处理，不依赖 DOM、网络或浏览器 API，从 normalizers.js 拆出来是为了有独立的移植边界。
import { SYSTEM_BASE_PRICE_PER_1M } from "../shared/schema.js";
const TIER_CALL_PATTERN = /tier\s*\(/gi;
// len <= N / p <= N 这类长度条件决定档位区间，hour(...) 之类的时间条件不算。
const TIER_BOUNDARY_PATTERN = /(?:^|[^a-z0-9_])(?:len|length|tokens?|input_tokens?|p)\s*(<=|<|>=|>)\s*(\d+(?:\.\d+)?)[\s)]*$/i;
const TIER_MULTIPLIER_PATTERN = /\*\s*\(\s*([^?]*?)\?\s*(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)\s*\)/gi;

function balancedSpan(source, start) {
  let depth = 1;
  let quote = "";
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (char === "\\") index += 1;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }
    if (char === "(") depth += 1;
    else if (char === ")" && --depth === 0) return { body: source.slice(start, index), end: index };
  }
  return null;
}

function splitArguments(body) {
  const parts = [];
  let depth = 0;
  let quote = "";
  let current = "";
  for (const char of body) {
    if (quote) {
      current += char;
      if (char === quote) quote = "";
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
      current += char;
      continue;
    }
    if (char === "(" || char === "[") depth += 1;
    else if (char === ")" || char === "]") depth -= 1;
    if (char === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  parts.push(current);
  return parts;
}

// 三元链 A ? X : B ? Y : Z 里每个分支的生效条件就是它前面那个 `?` 左侧的表达式，
// 各分支条件天然互斥（B 成立即 A 不成立），所以不必把 A 的否定拼进去。
function conditionBefore(expression, questionAt) {
  let depth = 0;
  let quote = "";
  let index = questionAt - 1;
  for (; index >= 0; index -= 1) {
    const char = expression[index];
    if (quote) {
      if (char === quote) quote = "";
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }
    if (char === ")") {
      depth += 1;
      continue;
    }
    if (char === "(") {
      if (!depth) break;
      depth -= 1;
      continue;
    }
    if (depth) continue;
    if (char === "?" || char === ":" || char === ",") break;
  }
  return expression.slice(index + 1, questionAt).trim();
}

function ternaryBranches(expression) {
  const branches = [];
  const open = [];
  let depth = 0;
  let quote = "";
  for (let index = 0; index < expression.length; index += 1) {
    const char = expression[index];
    if (quote) {
      if (char === quote) quote = "";
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }
    if (char === "(" || char === "[") {
      depth += 1;
      continue;
    }
    if (char === ")" || char === "]") {
      depth -= 1;
      continue;
    }
    if (char === "?") {
      open.push(index);
      continue;
    }
    if (char !== ":" || !open.length) continue;
    const questionAt = open.pop();
    branches.push({ condition: conditionBefore(expression, questionAt), start: questionAt + 1, end: index });
  }
  for (const questionAt of open) {
    branches.push({ condition: conditionBefore(expression, questionAt), start: questionAt + 1, end: expression.length });
  }
  return branches;
}

// 表达式常写成 `(p*2+c*8+cr*0.04)` 或 `(p*2+c*8+cr*0.04)*0.5`：外层括号和顶层倍率都不是价格项，
// 不剥掉会让系数解析漏掉紧贴括号的那一项（`(p*2` 匹配不上 `p`）。
function scaledBody(text) {
  let value = String(text || "").trim();
  let scale = 1;
  for (;;) {
    const scaled = value.match(/^(\([\s\S]*\))\s*([*/])\s*(\d+(?:\.\d+)?|\.\d+)$/);
    if (!scaled) break;
    const factor = Number(scaled[3]);
    if (!Number.isFinite(factor) || factor === 0) break;
    scale *= scaled[2] === "/" ? 1 / factor : factor;
    value = scaled[1].trim();
  }
  for (;;) {
    if (!value.startsWith("(")) break;
    const span = balancedSpan(value, 1);
    if (!span || span.end !== value.length - 1) break;
    value = span.body.trim();
  }
  return { body: value, scale };
}

function boundaryOf(condition) {
  const match = String(condition || "").match(TIER_BOUNDARY_PATTERN);
  if (!match) return {};
  const value = Number(match[2]);
  if (!Number.isFinite(value)) return {};
  const operator = match[1];
  // 保留开闭区间：`len > N` 的档从 N+1 开始，`len <= N` 的档到 N 结束、下一档从 N+1 开始。
  if (operator.startsWith("<")) return { maxTokens: value, maxInclusive: operator === "<=" };
  return { minTokens: operator === ">=" ? value : value + 1 };
}

export function parseBillingTiers(expression) {
  if (typeof expression !== "string" || !expression.includes("tier")) return [];
  const branches = ternaryBranches(expression);
  const tiers = [];
  TIER_CALL_PATTERN.lastIndex = 0;
  let match;
  while ((match = TIER_CALL_PATTERN.exec(expression))) {
    const callStart = match.index;
    const span = balancedSpan(expression, TIER_CALL_PATTERN.lastIndex);
    if (!span) continue;
    TIER_CALL_PATTERN.lastIndex = span.end + 1;
    const [rawName, rawBody = ""] = splitArguments(span.body);
    const name = String(rawName || "").replace(/["']/g, "").trim();
    const body = rawBody.trim();
    const branch = branches
      .filter(item => item.start <= callStart && callStart < item.end)
      .sort((first, second) => (first.end - first.start) - (second.end - second.start))[0];
    const boundary = boundaryOf(branch?.condition);
    const minTokens = boundary.minTokens ?? null;
    const maxTokens = boundary.maxTokens ?? null;
    const maxInclusive = boundary.maxInclusive ?? true;
    // fixed(x) 是站点写的固定单价：* image_count 时按张，否则按次。
    const fixed = body.match(/^fixed\s*\(\s*(\d+(?:\.\d+)?|\.\d+)\s*\)$/i);
    if (fixed) {
      const perImage = /^\s*\*\s*image_count\b/i.test(expression.slice(span.end + 1));
      const price = Number(fixed[1]);
      tiers.push({
        name,
        input: 0,
        output: 0,
        ratio: 0,
        completion: 1,
        billing: { cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0 },
        unit: perImage ? "image" : "request",
        fixed: price,
        ...(perImage ? {} : { request: price }),
        minTokens,
        maxTokens,
        maxInclusive
      });
      continue;
    }
    // The explicit seconds × constant form is a per-second quote; composite usage formulas stay unresolved.
    const perSecond = body.match(/^u\s*\(\s*["']seconds["']\s*\)\s*\*\s*(\d+(?:\.\d+)?|\.\d+)$/i);
    if (perSecond && Number(perSecond[1]) > 0) {
      tiers.push({
        name,
        input: 0,
        output: 0,
        ratio: 0,
        completion: 1,
        billing: { cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0 },
        unit: "second",
        fixed: Number(perSecond[1]),
        minTokens,
        maxTokens,
        maxInclusive
      });
      continue;
    }
    if (/\bu\s*\(/i.test(body)) continue;
    const { body: priceBody, scale } = scaledBody(body);
    const coefficients = {};
    for (const term of priceBody.match(/[+-]?[^+-]+/g) || []) {
      const parts = term.trim().match(/^([+-]?)\s*(?:(\d+(?:\.\d+)?|\.\d+)\s*\*\s*)?([a-z0-9]+)(?:\s*\*\s*(\d+(?:\.\d+)?|\.\d+))?$/i);
      if (!parts) continue;
      const sign = parts[1] === "-" ? -1 : 1;
      const coefficient = Number(parts[2] || parts[4] || 1) * sign;
      coefficients[parts[3].toLowerCase()] = (coefficients[parts[3].toLowerCase()] || 0) + coefficient;
    }
    const input = Number(coefficients.p || 0) * scale;
    const output = Number(coefficients.c || 0) * scale;
    if (input <= 0 && output <= 0) continue;
    tiers.push({
      name,
      input,
      output,
      ratio: input / SYSTEM_BASE_PRICE_PER_1M,
      completion: input > 0 ? output / input : 1,
      billing: {
        cacheRead: Number(coefficients.cr || 0) * scale,
        cacheWrite: Number(coefficients.cc || 0) * scale,
        cacheWrite1h: Number(coefficients.cc1h || 0) * scale
      },
      unit: "token",
      fixed: null,
      minTokens,
      maxTokens,
      maxInclusive
    });
  }
  // 两个绝对价档按时间互斥切换，不能把低峰价当成无条件报价。
  const timeBranch = branches.length === 1 && branches[0];
  if (tiers.length === 2 && timeBranch && /\b(?:hour|weekday)\s*\(/i.test(timeBranch.condition) &&
      tiers.every(tier => tier.minTokens === null && tier.maxTokens === null)) {
    tiers[0].billingConditions = [{ type: "time", expression: timeBranch.condition }];
    tiers[1].billingConditions = [{ type: "time", expression: `!(${timeBranch.condition})` }];
  }
  for (const multiplierRule of expression.matchAll(TIER_MULTIPLIER_PATTERN)) {
    const condition = multiplierRule[1].trim();
    const type = /\b(?:hour|weekday)\s*\(/i.test(condition) ? "time" : "context";
    const multiplier = Number(multiplierRule[2]);
    const fallbackMultiplier = Number(multiplierRule[3]);
    for (const tier of tiers) {
      if (type === "time") {
        tier.timeDiscount = multiplier;
        tier.timeCondition = condition;
      }
      (tier.billingConditions ||= []).push({
        type,
        expression: condition,
        multiplier,
        fallback_multiplier: fallbackMultiplier
      });
    }
  }
  // 只有出现长度条件时才补区间下界，否则普通单档模型不该凭空多出 min_tokens。
  if (tiers.some(tier => tier.minTokens !== null || tier.maxTokens !== null)) {
    // 表达式的书写顺序不等于区间顺序。站点会把「中间档」写在最后：
    //   len <= 250000 ? 0.06 : (len >= 500000 ? 0.2 : 0.1)
    // 第三档没有自己的边界，它就是剩下的那段。所以先按已知下界排骨架，再把无边界档填进空隙。
    const upperAfter = tier => (tier.maxTokens === null ? Infinity : tier.maxInclusive === false ? tier.maxTokens : tier.maxTokens + 1);
    const skeleton = tiers
      .filter(tier => tier.minTokens !== null || tier.maxTokens !== null)
      .sort((a, b) => (a.minTokens ?? 0) - (b.minTokens ?? 0));

    let cursor = 0;
    for (const tier of skeleton) {
      if (tier.minTokens === null) tier.minTokens = cursor;
      cursor = upperAfter(tier);
    }

    const gaps = [];
    let gapStart = 0;
    for (const tier of skeleton) {
      if (tier.minTokens > gapStart) gaps.push({ start: gapStart, end: tier.minTokens - 1 });
      const next = upperAfter(tier);
      if (next === Infinity) { gapStart = Infinity; break; }
      gapStart = next;
    }
    if (gapStart !== Infinity) gaps.push({ start: gapStart, end: null });

    const floating = tiers.filter(tier => tier.minTokens === null && tier.maxTokens === null);
    floating.forEach((tier, index) => {
      const gap = gaps[index];
      if (!gap) return;
      tier.minTokens = gap.start;
      tier.maxTokens = gap.end;
    });
    // 填完之后按区间重排，避免中间档在表里排到最后。
    if (floating.length) tiers.sort((a, b) => (a.minTokens ?? 0) - (b.minTokens ?? 0));
  }
  return tiers;
}
