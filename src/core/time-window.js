// 时段分档的占比不该手动拍一个比例。
// 站点已经把窗口写进了计费表达式（`weekday("Asia/Shanghai") >= 1 && hour(...) >= 9 …`），
// 那一档占多少流量就只取决于「窗口 × 你的使用时段」的重叠，算得出来。
// 手填 7/24 只对「每天均匀在用」的站成立：spiderai 高峰是工作日 9-12/14-18，
// 一周 35 小时，均匀口径是 20.8%，填 29.2% 会把混合价抬高约 7%。
// 参考的是电网分时电价的做法：费率按窗口给定，账单用负荷曲线积分，不拿一个平均值去猜。

// 使用时段就是一条负荷曲线。工作时段和夜间时段的曲线差别很大，
// 同一个站点窗口在这两条曲线下的混合价能差一倍。
export const USAGE_TIME_PROFILES = [
  { id: "uniform", label: "全天均匀", hint: "24 小时都在用，等于按窗口周时长占比" },
  { id: "workday", label: "工作日 9-18", hint: "只在上班时间用，工作时段窗口会几乎全中" },
  { id: "night", label: "夜间 20-8", hint: "夜里跑批和自动化" }
];

export const DEFAULT_TIME_PROFILE = "uniform";

const PROFILE_MATCHERS = {
  uniform: () => true,
  workday: (weekday, hour) => weekday >= 1 && weekday <= 5 && hour >= 9 && hour < 18,
  night: (_weekday, hour) => hour >= 20 || hour < 8
};

export function isUsageTimeProfile(value) {
  return Object.hasOwn(PROFILE_MATCHERS, String(value || ""));
}

function tokenize(text) {
  const tokens = [];
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    if (/\s/.test(char)) { index += 1; continue; }
    if (char === '"' || char === "'") {
      const end = text.indexOf(char, index + 1);
      if (end < 0) throw new Error("字符串没有闭合");
      tokens.push({ type: "string", value: text.slice(index + 1, end) });
      index = end + 1;
      continue;
    }
    const two = text.slice(index, index + 2);
    if (two === "&&" || two === "||" || two === "==" || two === "!=" || two === ">=" || two === "<=") {
      tokens.push({ type: "op", value: two });
      index += 2;
      continue;
    }
    if (char === ">" || char === "<") {
      tokens.push({ type: "op", value: char });
      index += 1;
      continue;
    }
    if (char === "!" || char === "(" || char === ")") {
      tokens.push({ type: char === "!" ? "op" : "punct", value: char });
      index += 1;
      continue;
    }
    if (/[0-9]/.test(char)) {
      const match = /^[0-9]+(?:\.[0-9]+)?/.exec(text.slice(index));
      tokens.push({ type: "number", value: match[0] });
      index += match[0].length;
      continue;
    }
    if (/[A-Za-z_]/.test(char)) {
      const match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(text.slice(index));
      tokens.push({ type: "ident", value: match[0] });
      index += match[0].length;
      continue;
    }
    throw new Error(`不认识的字符 ${char}`);
  }
  return tokens;
}

// 表达式只覆盖计费里真正出现的那一小撮语法：hour/weekday 调用、数字、比较、! && ||、括号。
// 解析不了的（算术、三元、自定义函数）直接返回 null，调用方退回旧的按名字猜档位，不猜语义。
const SUPPORTED_CALLS = new Set(["hour", "weekday", "month"]);

function parseTokens(tokens) {
  let index = 0;
  const peek = () => tokens[index];
  const next = () => tokens[index++];

  function parseOr() {
    let node = parseAnd();
    while (peek()?.type === "op" && peek().value === "||") {
      next();
      node = { type: "or", left: node, right: parseAnd() };
    }
    return node;
  }

  function parseAnd() {
    let node = parseComparison();
    while (peek()?.type === "op" && peek().value === "&&") {
      next();
      node = { type: "and", left: node, right: parseComparison() };
    }
    return node;
  }

  function parseComparison() {
    const left = parseUnary();
    const token = peek();
    if (token?.type === "op" && ["==", "!=", ">=", "<=", ">", "<"].includes(token.value)) {
      next();
      return { type: "compare", operator: token.value, left, right: parseUnary() };
    }
    return left;
  }

  function parseUnary() {
    if (peek()?.type === "op" && peek().value === "!") {
      next();
      return { type: "not", operand: parseUnary() };
    }
    return parsePrimary();
  }

  function parsePrimary() {
    const token = next();
    if (!token) throw new Error("表达式不完整");
    if (token.type === "number") return { type: "number", value: Number(token.value) };
    if (token.type === "string") return { type: "string", value: token.value };
    if (token.type === "punct" && token.value === "(") {
      const node = parseOr();
      if (next()?.value !== ")") throw new Error("括号不匹配");
      return node;
    }
    if (token.type === "ident") {
      if (!SUPPORTED_CALLS.has(token.value)) throw new Error(`不支持 ${token.value}`);
      if (next()?.value !== "(") throw new Error(`${token.value} 缺参数表`);
      const args = [];
      if (peek()?.value !== ")") {
        for (;;) {
          const argument = next();
          if (!argument || (argument.type !== "string" && argument.type !== "number")) throw new Error("参数只支持字面量");
          args.push(argument.type === "string" ? argument.value : Number(argument.value));
          if (peek()?.value === ",") { next(); continue; }
          break;
        }
      }
      if (next()?.value !== ")") throw new Error("参数表没闭合");
      return { type: "call", name: token.value, args };
    }
    throw new Error(`不认识的记号 ${token.value}`);
  }

  const ast = parseOr();
  if (index !== tokens.length) throw new Error("表达式尾部有多余内容");
  return ast;
}

// 周表按使用时段所在的墙上钟枚举（默认北京时间），表达式若写了别的时区，
// 就把该时区同一瞬间的墙上钟换算过去。夏令时用固定偏移近似，站点窗口都是整点，够用。
function zoneOffsetMs(timeZone) {
  if (!timeZone) return null;
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone, hour12: false,
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit"
    });
    const instant = Date.UTC(2026, 0, 6, 4);
    const parts = Object.fromEntries(formatter.formatToParts(new Date(instant)).map(part => [part.type, part.value]));
    return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour) % 24, Number(parts.minute)) - instant;
  } catch {
    return null;
  }
}

const PROFILE_TIME_ZONE = "Asia/Shanghai";

function zoneShiftHours(timeZone) {
  if (!timeZone || timeZone === PROFILE_TIME_ZONE) return 0;
  const target = zoneOffsetMs(timeZone);
  const base = zoneOffsetMs(PROFILE_TIME_ZONE);
  if (target === null || base === null) return 0;
  return (target - base) / 3_600_000;
}

function evaluate(node, context) {
  switch (node.type) {
    case "number": return node.value;
    case "string": return node.value;
    case "call":
      if (node.name === "hour") return context.hour;
      if (node.name === "weekday") return context.weekday;
      return context.month;
    case "not": return !evaluate(node.operand, context);
    case "and": return Boolean(evaluate(node.left, context)) && Boolean(evaluate(node.right, context));
    case "or": return Boolean(evaluate(node.left, context)) || Boolean(evaluate(node.right, context));
    case "compare": {
      const left = evaluate(node.left, context);
      const right = evaluate(node.right, context);
      switch (node.operator) {
        case "==": return left === right;
        case "!=": return left !== right;
        case ">=": return left >= right;
        case "<=": return left <= right;
        case ">": return left > right;
        case "<": return left < right;
        default: return false;
      }
    }
    default: return false;
  }
}

function timeZoneOf(node, found = []) {
  if (!node || typeof node !== "object") return found;
  if (node.type === "call" && (node.name === "hour" || node.name === "weekday") &&
      typeof node.args?.[0] === "string") found.push(node.args[0]);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach(item => timeZoneOf(item, found));
    else if (value && typeof value === "object") timeZoneOf(value, found);
  }
  return found;
}

// 一个月条件在周表里没有固定答案（跨月），这种表达式不参与概率计算。
function usesMonth(node) {
  if (!node || typeof node !== "object") return false;
  if (node.type === "call" && node.name === "month") return true;
  return Object.values(node).some(value =>
    Array.isArray(value) ? value.some(usesMonth) : Boolean(value) && typeof value === "object" && usesMonth(value));
}

// 把表达式编译成「一周 168 格里哪些落在窗口内」。解析失败返回 null。
export function compileTimeWindow(expression) {
  const text = String(expression || "").trim();
  if (!text) return null;
  let ast;
  try {
    ast = parseTokens(tokenize(text));
  } catch {
    return null;
  }
  if (usesMonth(ast)) return null;
  const shift = zoneShiftHours(timeZoneOf(ast)[0]);
  return (weekday, hour) => {
    const shifted = hour + shift;
    const wrapped = ((shifted % 24) + 24) % 24;
    const dayShift = Math.floor(shifted / 24);
    return Boolean(evaluate(ast, {
      hour: wrapped,
      weekday: ((weekday + dayShift) % 7 + 7) % 7,
      month: 0
    }));
  };
}

// 一条报价里的时段选择器：带 multiplier 的时段条件是「这一档按时段打折」，不负责选档，跳过。
export function timeSelectorOf(item) {
  const conditions = item?.billing_conditions ?? item?.billingConditions;
  if (!Array.isArray(conditions)) return null;
  const selector = conditions.find(condition =>
    condition && condition.type === "time" && condition.expression && !Number.isFinite(Number(condition.multiplier)));
  return selector ? String(selector.expression) : null;
}

// 窗口 × 负荷曲线 = 该档占一周流量的比例。算不出来（没窗口表达式/解析不了）返回 null。
export function shareOfWindow(expression, profileId = DEFAULT_TIME_PROFILE) {
  const matcher = PROFILE_MATCHERS[isUsageTimeProfile(profileId) ? profileId : DEFAULT_TIME_PROFILE];
  const inWindow = compileTimeWindow(expression);
  if (!inWindow || !matcher) return null;
  let total = 0;
  let inside = 0;
  for (let weekday = 0; weekday < 7; weekday += 1) {
    for (let hour = 0; hour < 24; hour += 1) {
      if (!matcher(weekday, hour)) continue;
      total += 1;
      if (inWindow(weekday, hour)) inside += 1;
    }
  }
  if (!total) return null;
  return inside / total;
}

// 一整组档位在整周里的占比分布。没有可算的窗口时返回 null，调用方退回按名字猜。
export function shareOfTiers(items, profileId = DEFAULT_TIME_PROFILE) {
  if (!Array.isArray(items) || !items.length) return null;
  const shares = items.map(item => {
    const expression = timeSelectorOf(item);
    if (!expression) return null;
    return shareOfWindow(expression, profileId);
  });
  const known = shares.filter(share => Number.isFinite(share));
  if (known.length !== items.length) return null;
  const total = known.reduce((sum, share) => sum + share, 0);
  if (!(total > 0)) return null;
  return shares.map(share => share / total);
}