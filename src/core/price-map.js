// 站点价格映射引擎：把「字段名 → 计费语义」写成数据，代码只负责求值。
// 目标是把 normalizers.js 里一个站点一个 if 分支的写法换掉，
// 一个站点一个 map 文档，字段改名改 map 不改代码。

import { SYSTEM_BASE_PRICE_PER_1M } from "../shared/schema.js";

const OWN = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);

// 价格字段的取值闸：不是有限非负数就当「没给」，调用方一律按未知处理。
export const finitePrice = value => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

// ---------- 取值 ----------

// 支持 `a.b[0].c` 和 JSON Pointer 的 `/a/b/0/c` 两种写法。
// 取不到返回 undefined，调用方必须当作「不知道」，不能当 0。
export function readPath(source, path) {
  if (path === undefined || path === null || path === "") return source;
  const text = String(path).trim();
  // 先试整串当字面键名：有些接口真拿定价字段名当键（"pricing.per_image": 0.04）。
  if (source && typeof source === "object" && OWN(source, text)) return source[text];
  const parts = text.startsWith("/")
    ? text.slice(1).split("/").map(part => part.replace(/~1/g, "/").replace(/~0/g, "~"))
    : text.split(".");
  let current = source;
  for (const part of parts) {
    if (part === "") continue;
    const match = /^([^[\]]*)((?:\[\d+\])*)$/.exec(part);
    if (!match) return undefined;
    let key = match[1];
    if (key !== "") {
      if (current === null || current === undefined) return undefined;
      if (Array.isArray(current)) {
        const index = Number(key);
        if (!Number.isInteger(index)) return undefined;
        current = current[index];
      } else if (typeof current === "object") {
        if (!OWN(current, key)) return undefined;
        current = current[key];
      } else {
        return undefined;
      }
    }
    for (const indexText of match[2].match(/\d+/g) || []) {
      if (!Array.isArray(current)) return undefined;
      current = current[Number(indexText)];
    }
  }
  return current;
}

// ---------- 表达式 ----------

// 标识符允许带点路径（effective_pricing_usd.input_per_mtok_usd）和数组下标
// （intervals[0].output_per_mtok_usd），规则文档里就不用先取值再算。
const EXPRESSION_TOKEN = /\s*(?:(\d+(?:\.\d+)?|\.\d+)|([A-Za-z_][A-Za-z0-9_]*(?:(?:\.[A-Za-z_][A-Za-z0-9_]*)|(?:\[\d+\]))*)|([-+*/()]))/y;

export class PriceMapError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "PriceMapError";
    this.code = code;
  }
}

function tokenize(source) {
  const tokens = [];
  EXPRESSION_TOKEN.lastIndex = 0;
  let position = 0;
  while (position < source.length) {
    EXPRESSION_TOKEN.lastIndex = position;
    const match = EXPRESSION_TOKEN.exec(source);
    if (!match) {
      if (/^\s*$/.test(source.slice(position))) break;
      throw new PriceMapError("expr-syntax", `表达式无法解析：${source.slice(position)}`);
    }
    position = EXPRESSION_TOKEN.lastIndex;
    if (match[1] !== undefined) tokens.push({ kind: "number", value: Number(match[1]) });
    else if (match[2] !== undefined) tokens.push({ kind: "ident", value: match[2] });
    else tokens.push({ kind: "op", value: match[3] });
  }
  return tokens;
}

// 只认四则运算和括号。不用 eval，也不支持函数调用：
// 价格表达式被站点数据间接影响，求值器必须是白名单。
export function evalExpression(source, scope = {}) {
  if (typeof source === "number") return Number.isFinite(source) ? source : null;
  const text = String(source ?? "").trim();
  if (!text) return null;
  const tokens = tokenize(text);
  // 标识符先按整串查作用域（保留函数形式的惰性取值），查不到再当点路径下钻。
  const resolveIdent = (name) => {
    // 只认自己这一层真的有的键，原型链上的东西一律当不存在，
    // 免得 constructor 之类被当成取值函数执行掉。
    const direct = OWN(scope, name) ? scope[name] : undefined;
    const raw = typeof direct === "function" ? direct() : direct !== undefined ? direct : readPath(scope, name);
    if (raw === undefined || raw === null || raw === "") return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  };
  let cursor = 0;

  const peek = () => tokens[cursor];
  const eat = (value) => {
    const token = tokens[cursor];
    if (token && token.kind === "op" && token.value === value) {
      cursor += 1;
      return true;
    }
    return false;
  };

  function parseUnary() {
    const token = peek();
    if (token && token.kind === "op" && (token.value === "-" || token.value === "+")) {
      cursor += 1;
      const value = parseUnary();
      if (value === null) return null;
      return token.value === "-" ? -value : value;
    }
    return parsePrimary();
  }

  function parsePrimary() {
    const token = peek();
    if (!token) throw new PriceMapError("expr-syntax", `表达式不完整：${text}`);
    if (token.kind === "number") {
      cursor += 1;
      return token.value;
    }
    if (token.kind === "ident") {
      cursor += 1;
      // 表达式来自站点数据，标识符后面跟括号当函数调用处理，直接拒掉。
      if (peek() && peek().kind === "op" && peek().value === "(") {
        throw new PriceMapError("expr-syntax", `不支持函数调用：${text}`);
      }
      const raw = resolveIdent(token.value);
      if (raw === undefined || raw === null || raw === "") return null;
      const value = Number(raw);
      return Number.isFinite(value) ? value : null;
    }
    if (token.kind === "op" && token.value === "(") {
      cursor += 1;
      const value = parseSum();
      if (!eat(")")) throw new PriceMapError("expr-syntax", `括号不闭合：${text}`);
      return value;
    }
    throw new PriceMapError("expr-syntax", `表达式有意外符号：${token.value}`);
  }

  function parseProduct() {
    let value = parseUnary();
    if (value === null) return null;
    for (;;) {
      const token = peek();
      if (!token || token.kind !== "op" || (token.value !== "*" && token.value !== "/")) return value;
      cursor += 1;
      const right = parseUnary();
      if (right === null) return null;
      if (token.value === "/") {
        if (right === 0) return null;
        value /= right;
      } else {
        value *= right;
      }
    }
  }

  function parseSum() {
    let value = parseProduct();
    if (value === null) return null;
    for (;;) {
      const token = peek();
      if (!token || token.kind !== "op" || (token.value !== "+" && token.value !== "-")) return value;
      cursor += 1;
      const right = parseProduct();
      if (right === null) return null;
      value = token.value === "+" ? value + right : value - right;
    }
  }

  const result = parseSum();
  // 变量缺失时解析会提前收口，后面的 token 没被消费。这不算语法错误。
  if (result === null) return null;
  if (cursor !== tokens.length) throw new PriceMapError("expr-syntax", `表达式尾部多余：${text}`);
  return Number.isFinite(result) ? result : null;
}

// 表达式里的标识符一律按「模型条目上的路径」解析，所以 `model_ratio` 和
// `image_billing_rule.ratio` 都能写进同一个表达式。给了父级记录时，档位对象上
// 取不到的字段回落到父级——分档里只写各档系数、模型倍率留在外面的站点常用这个写法。
function scopeOf(...frames) {
  const lookup = key => {
    for (const frame of frames) {
      if (!frame || typeof frame !== "object") continue;
      const value = readPath(frame, key);
      if (value !== undefined && value !== null && value !== "") return value;
    }
    return undefined;
  };
  return new Proxy({}, {
    get: (_, key) => (typeof key === "string" ? lookup(key) : undefined),
    // 让 hasOwnProperty 对这个代理也成立，标识符白名单才查得到键；
    // 取值仍然只走上面那个 lookup，不会摸到任何原型方法。
    getOwnPropertyDescriptor: (_, key) => (typeof key === "string" && lookup(key) !== undefined
      ? { value: undefined, writable: false, enumerable: true, configurable: true }
      : undefined),
    has: () => true
  });
}

export function evalOnItem(source, item, fallback) {
  try {
    return evalExpression(source, scopeOf(item, fallback));
  } catch (error) {
    if (error instanceof PriceMapError) return null;
    throw error;
  }
}
// 一份价可以写成链：前一条算不出来（站点换过字段名、老模型只发旧字段）就试下一条。
// 链上全是 null 才返回 null，保证「没报价」和「报 0 价」分得开。
export function evalChain(source, item, fallback) {
  const sources = Array.isArray(source) ? source : [source];
  for (const candidate of sources) {
    const value = evalOnItem(candidate, item, fallback);
    if (value !== null) return value;
  }
  return null;
}

// ---------- 规则求值 ----------

function whenMatches(when, item) {
  if (!when) return true;
  if (Array.isArray(when)) return when.every(entry => whenMatches(entry, item));
  const value = readPath(item, when.path);
  if (OWN(when, "present")) {
    const present = value !== undefined && value !== null && value !== "";
    if (present !== Boolean(when.present)) return false;
  }
  if (OWN(when, "equals")) {
    const expected = when.equals;
    if (typeof expected === "number" ? Number(value) !== expected : String(value ?? "") !== String(expected)) return false;
  }
  if (OWN(when, "in")) {
    if (!Array.isArray(when.in) || !when.in.map(String).includes(String(value ?? ""))) return false;
  }
  if (OWN(when, "contains")) {
    const haystack = Array.isArray(value) ? value.map(item => String(item ?? "").trim().toLowerCase()) : [String(value ?? "").trim().toLowerCase()];
    if (!haystack.includes(String(when.contains).trim().toLowerCase())) return false;
  }
  if (OWN(when, "gt") && !(Number(value) > Number(when.gt))) return false;
  if (OWN(when, "gte") && !(Number(value) >= Number(when.gte))) return false;
  return true;
}

// 单位可能藏在几处不同的地方，按顺序试，第一个说得清的就是答案。
// `present` 的意思是「这个字段存在就代表单位是它」，用于 billing_usage_schema 那种声明式结构。
function resolveUnit(unit, item) {
  if (!unit) return null;
  if (typeof unit === "string") return unit;
  const candidates = Array.isArray(unit) ? unit : [unit];
  for (const candidate of candidates) {
    if (OWN(candidate, "present")) {
      const value = readPath(item, candidate.path);
      if (value !== undefined && value !== null && value !== "") return candidate.present;
      continue;
    }
    if (OWN(candidate, "fallback") && !candidate.map) return candidate.fallback;
    const raw = readPath(item, candidate.path);
    const values = Array.isArray(raw) ? raw : [raw];
    for (const value of values) {
      const key = String(value ?? "").trim().toLowerCase();
      if (key && candidate.map && OWN(candidate.map, key)) return candidate.map[key];
    }
    if (OWN(candidate, "fallback")) return candidate.fallback;
  }
  return null;
}

// 浮点乘除顺序不同会留下 0.017499999999999998 这种尾巴，统一收敛到 12 位有效数字。
const quantize = value => (value === null || value === undefined || !Number.isFinite(value) ? null : Number(value.toPrecision(12)));

function sizeTiersOf(spec, item) {
  if (!spec) return [];
  const raw = readPath(item, spec.path);
  if (!Array.isArray(raw)) return [];
  return raw
    .map(entry => {
      const name = String(readPath(entry, spec.nameField) ?? "").trim();
      const factor = Number(readPath(entry, spec.factorField));
      // 有的站点只给倍率，有的直接给这一档多少钱，两种都得认。
      const absolute = spec.priceField ? evalOnItem(spec.priceField, entry) : null;
      if (!name) return null;
      return {
        name,
        factor: Number.isFinite(factor) && factor > 0 ? factor : 1,
        price: absolute !== null && absolute > 0 ? absolute : null,
        raw: entry
      };
    })
    .filter(Boolean);
}

// 档位名要短：`≤272K`、`272K–1M` 这种，比 272000 好读，也不占表格宽度。
function compactTokens(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return "";
  if (number >= 1e6) return `${Number((number / 1e6).toFixed(2))}M`;
  if (number >= 1e3) return `${Number((number / 1e3).toFixed(1))}K`;
  return String(number);
}
// 站点的 model_ratio 是「官方价 ÷ ratioBase」，同为 New API 派生，有的站 1 元一个单位、
// 有的站 2 元一个单位，只有站点自己知道。把这个系数做成求值上下文里的 model_ratio，
// 规则表达式就只写 model_ratio，不必到处写 `model_ratio * 2`。
// 同一个常数写在四处字符串和 ratioBase 一处，改一边忘一边就会整站报低一半。
function scaledRatioItem(item, ratioBase) {
  const ratio = Number(readPath(item, "model_ratio"));
  if (!Number.isFinite(ratio)) return item;
  return { ...item, model_ratio: ratio * ratioBase };
}
// 上下文长度分档。档位数组里每一项都是独立的计价单元，表达式对着该项求值，
// 和规则本身用的是同一套语法：spec 上写 input / output / cacheRead / cacheWrite。
// 档位对象上取不到的字段回落到整条记录，所以「每档只给系数、模型倍率留在外面」
// 这种写法也能直接算。数组缺失或全空就退回单档，用规则自己的表达式求值。
function tokenCells(rule, item) {
  const spec = rule.tiers;
  const raw = spec ? readPath(item, spec.path) : null;
  if (Array.isArray(raw) && raw.length) {
    const cells = [];
    // 站点只给上限的分档（step_ratios 的 step_size）要自己补下限：上一档的上限。
    let lowerBound;
    for (const entry of raw) {
      if (!entry || typeof entry !== "object") continue;
      const input = spec.input ? evalChain(spec.input, entry, item) : null;
      const output = spec.output ? evalChain(spec.output, entry, item) : null;
      const upper = spec.upperField ? Number(readPath(entry, spec.upperField)) : NaN;
      const hasUpper = Number.isFinite(upper) && upper > 0;
      const previousBound = lowerBound;
      const minTokens = spec.minField ? readPath(entry, spec.minField)
        : hasUpper ? previousBound ?? 0 : undefined;
      const maxTokens = spec.maxField ? readPath(entry, spec.maxField)
        : hasUpper ? upper : undefined;
      if (hasUpper) lowerBound = upper;
      // 一档里入价出价都没有，说明这档没报价，跳过而不是补 0。
      if (input === null && output === null) continue;
      const name = spec.nameField ? String(readPath(entry, spec.nameField) ?? "").trim()
        : hasUpper ? `${previousBound ? `${compactTokens(previousBound)}–` : "≤"}${compactTokens(upper)}`
          : "";
      cells.push({
        input,
        output,
        cacheRead: spec.cacheRead ? evalChain(spec.cacheRead, entry, item) : null,
        cacheWrite: spec.cacheWrite ? evalChain(spec.cacheWrite, entry, item) : null,
        cacheWrite1h: spec.cacheWrite1h ? evalChain(spec.cacheWrite1h, entry, item) : null,
        imageInput: spec.imageInput ? evalChain(spec.imageInput, entry, item) : null,
        imageOutput: spec.imageOutput ? evalChain(spec.imageOutput, entry, item) : null,
        name,
        minTokens,
        maxTokens
      });
    }
    if (cells.length) return cells;
  }
  return [{
    input: evalChain(rule.input, item),
    output: rule.output ? evalChain(rule.output, item) : null,
    cacheRead: rule.cacheRead ? evalChain(rule.cacheRead, item) : null,
    cacheWrite: rule.cacheWrite ? evalChain(rule.cacheWrite, item) : null,
    cacheWrite1h: rule.cacheWrite1h ? evalChain(rule.cacheWrite1h, item) : null,
    imageInput: rule.imageInput ? evalChain(rule.imageInput, item) : null,
    imageOutput: rule.imageOutput ? evalChain(rule.imageOutput, item) : null,
    name: "",
    minTokens: undefined,
    maxTokens: undefined
  }];
}

export function rulesFor(item, rules = []) {
  return rules.filter(rule => whenMatches(rule.when, item));
}

// ---------- 应用 ----------

// 倍率可以写成链：一条条往下试，第一条命中且取到数的说了算。
// 站点常见的两种分叉——促销价压过常规价、图片走独立倍率——都能写成一条 `when`。
function chainRatio(chain, row, fallbackPath) {
  const candidates = Array.isArray(chain) ? chain : chain ? [chain] : [];
  for (const candidate of candidates) {
    const when = typeof candidate === "object" ? candidate.when : null;
    if (when && !whenMatches(when, row)) continue;
    const path = typeof candidate === "string" ? candidate : candidate?.path;
    if (!path) continue;
    const value = Number(readPath(row, path));
    if (Number.isFinite(value) && value >= 0) return value;
  }
  if (!fallbackPath) return null;
  const fallback = Number(readPath(row, fallbackPath));
  return Number.isFinite(fallback) && fallback >= 0 ? fallback : null;
}

function groupSelection(map, raw, item) {
  const spec = map.groups || {};
  // 外键查表：item 只带 group_id，分组名和倍率落在站点另一处的数组里。
  if (spec.lookupPath) {
    const table = readPath(raw, spec.lookupPath);
    const index = new Map(
      (Array.isArray(table) ? table : []).map(row => [String(readPath(row, spec.keyPath || "id") ?? ""), row])
    );
    // 外键可以是一个，也可以是一串：同一份价挂好几个分组，各自按自己的倍率出一行。
    const refs = readPath(item, spec.refPath || "group_id");
    const keys = (Array.isArray(refs) ? refs : [refs]).map(value => String(value ?? "")).filter(Boolean);
    const selected = [];
    for (const key of keys) {
      const found = index.get(key);
      if (!found) continue;
      const group = String(readPath(found, spec.namePath || "name") ?? "").trim();
      if (!group) continue;
      const ratio = chainRatio(spec.ratio, found, spec.ratioPath || "rate_multiplier");
      if (ratio === null) continue;
      selected.push({ group, ratio, mediaRatio: chainRatio(spec.mediaRatio, found) });
    }
    return selected;
  }
  const listed = readPath(item, spec.listPath || "enable_groups");
  let groups = (Array.isArray(listed) ? listed : [listed]).map(value => String(value ?? "").trim()).filter(Boolean);
  // 有的站每条的 enable_groups 是空数组，定价页也只报基准价、不说是哪个分组在卖。
  // 这时候拿倍率表的键乘一遍，等于给每个模型编出十几个它根本不在的分组。
  // 站点没说的就不编：按倍率 1 出一条基准价，分组名用 map 声明的占位符。
  if (!groups.length) {
    const unlisted = spec.unlisted;
    if (!unlisted) return [];
    const group = (typeof unlisted === "string" ? unlisted : String(unlisted.group ?? "")).trim();
    const ratio = typeof unlisted === "object" && Number.isFinite(unlisted.ratio) ? unlisted.ratio : 1;
    return group ? [{ group, ratio }] : [];
  }
  // item 自己带倍率时不用查表：分组广场的 token / 按次价已经在站内乘过分组倍率，
  // 映射声明里把它们标成 1，只有表达式那档才按分组 ratio 现乘。
  if (spec.ratioField) {
    const fieldRatio = Number(readPath(item, spec.ratioField));
    if (Number.isFinite(fieldRatio) && fieldRatio >= 0) return groups.map(group => ({ group, ratio: fieldRatio }));
  }
  const ratioTable = readPath(raw, spec.ratioPath || "/group_ratio");
  if (!ratioTable || typeof ratioTable !== "object") return groups.map(group => ({ group, ratio: 1 }));
  const usable = readPath(raw, spec.usablePath || "/usable_group");
  const usableKeys = usable && typeof usable === "object" && !Array.isArray(usable) ? Object.keys(usable) : null;
  const priced = groups.filter(group => OWN(ratioTable, group));
  const selected = usableKeys ? priced.filter(group => usableKeys.includes(group)) : priced;
  const finalGroups = selected.length ? selected : priced.length ? priced : groups;
  return finalGroups
    .map(group => ({ group, ratio: Number(ratioTable[group]) }))
    .filter(entry => Number.isFinite(entry.ratio) && entry.ratio >= 0);
}

function baseRowOf(rule, item, map, group) {
  const row = {
    model_name: String(readPath(item, map.nameField || "model_name") ?? "").trim(),
    model_display_name: String(readPath(item, map.labelField || map.nameField || "model_name") ?? "").trim(),
    price_currency: map.currency || "CNY",
    enable_groups: [group.group],
    proxy_group_name: group.group,
    group_ratio: group.ratio,
    evidence: "exact"
  };
  const mediaSpecs = rule.mediaSpecsPath ? readPath(item, rule.mediaSpecsPath) : null;
  if (mediaSpecs && typeof mediaSpecs === "object" && !Array.isArray(mediaSpecs)) row.media_specs = { ...mediaSpecs };
  const mediaType = resolveUnit(rule.mediaType, item);
  if (mediaType) row.media_type = mediaType;
  return row;
}

// `parseTiers` 由调用方注入：那段表达式语法是站点私有的，不归引擎管。
// 站点级的 ratioBase 是「一行报文里 model_ratio 一个单位值多少美元」。
// 声明可以写在映射顶层，也可以写在单条 token 规则上；顶层写法在这里下发，
// 于是「一个常数、一处声明」，表达式里不再出现 `model_ratio * 2`。
function withSiteRatioBase(map) {
  const base = Number(map?.ratioBase);
  if (!Number.isFinite(base) || base <= 0) return map;
  return { ...map, rules: (map.rules || []).map(rule => rule?.kind === "token" ? { ...rule, ratioBase: base } : rule) };
}

export function applyPriceMap(map, raw, { parseTiers } = {}) {
  // 站点级倍率先下发到 token 规则，后面照常按 map 求值。
  map = withSiteRatioBase(map);
  const items = readPath(raw, map.rootPath || "/data");
  const list = Array.isArray(items) ? items : [];
  const rows = [];
  const unresolved = [];

  for (const item of list) {
    const name = String(readPath(item, map.nameField || "model_name") ?? "").trim();
    if (!name) continue;
    const rule = rulesFor(item, map.rules || [])[0];
    if (!rule) {
      unresolved.push({ model: name, reason: "没有匹配的计费规则" });
      continue;
    }
    const groups = groupSelection(map, raw, item);
    if (!groups.length) {
      unresolved.push({ model: name, reason: "没有可用分组" });
      continue;
    }

    if (rule.kind === "expression") {
      const source = readPath(item, rule.exprPath || "billing_expr");
      const tiers = typeof parseTiers === "function" ? parseTiers(source) : [];
      if (!tiers.length) {
        unresolved.push({ model: name, reason: "计费表达式解析不出来", source: String(source ?? "") });
        continue;
      }
      const cacheRatio = Number(readPath(item, "cache_ratio"));
      const createRatio = Number(readPath(item, "create_cache_ratio"));
      for (const tier of tiers) {
        const billing = tier.billing || {};
        for (const group of groups) {
          const tokenPriced = tier.unit === "token";
          const inputPrice = tokenPriced ? quantize(tier.input * group.ratio) : null;
          const outputPrice = tokenPriced ? quantize(tier.output * group.ratio) : null;
          // 表达式自己带缓存系数时以它为准，站点顶层的 cache_ratio 只是兜底。
          const cacheRead = tokenPriced && billing.cacheRead > 0 ? quantize(billing.cacheRead * group.ratio)
            : inputPrice === null || !Number.isFinite(cacheRatio) ? null : quantize(inputPrice * cacheRatio);
          const cacheWrite = tokenPriced && billing.cacheWrite > 0 ? quantize(billing.cacheWrite * group.ratio)
            : inputPrice === null || !Number.isFinite(createRatio) ? null : quantize(inputPrice * createRatio);
          const row = baseRowOf(rule, item, map, group);
          // 表达式里的 unit 就是计费单位：按张计的行必须标成 image，否则会掉进文本榜。
          if (tier.unit === "image") row.media_type = "image";
          if (tier.unit === "second") row.request_unit = "second";
          rows.push({
            ...row,
            model_ratio: inputPrice === null ? 0 : quantize(inputPrice / 2),
            completion_ratio: inputPrice > 0 && outputPrice !== null ? quantize(outputPrice / inputPrice) : 1,
            input_price: inputPrice,
            output_price: outputPrice,
            cache_read_price: cacheRead,
            cache_write_price: cacheWrite,
            cache_write_1h_price: tokenPriced && billing.cacheWrite1h > 0 ? quantize(billing.cacheWrite1h * group.ratio) : null,
            request_price: tier.unit === "request" && tier.fixed !== null ? quantize(tier.fixed * group.ratio) : null,
            image_price: tier.unit === "image" && tier.fixed !== null ? quantize(tier.fixed * group.ratio) : null,
            tier_name: tier.name,
            ...(tier.minTokens !== null && tier.minTokens !== undefined ? { min_tokens: tier.minTokens } : {}),
            ...(tier.maxTokens !== null && tier.maxTokens !== undefined ? { max_tokens: tier.maxTokens } : {}),
            ...(tier.timeDiscount !== undefined ? { tier_time_discount: tier.timeDiscount, tier_time_condition: tier.timeCondition } : {}),
            ...(tier.billingConditions?.length ? { billing_conditions: tier.billingConditions } : {})
          });
        }
      }
      continue;
    }

    if (rule.kind === "request") {
      const price = evalChain(rule.price, item);
      const unit = resolveUnit(rule.unit, item);
      const tierAmounts = sizeTiersOf(rule.sizeTiers, item)
        .map(tier => ({ name: tier.name, amount: tier.price !== null ? tier.price : price === null ? null : price * tier.factor }))
        .filter(tier => Number.isFinite(tier.amount) && tier.amount > 0);
      // 档位自带绝对价时，顶层价只是兜底：站点可能只给分档价，不给统一价。
      if (!tierAmounts.length && (price === null || !(price > 0))) {
        unresolved.push({ model: name, reason: "按次价格缺失或非正数，无法给出单位价" });
        continue;
      }
      // 分档全是同一个价就并成一行，别把同一笔钱重复三遍。
      const redundant = tierAmounts.length > 1 && new Set(tierAmounts.map(cell => cell.amount)).size === 1;
      const sizeCells = tierAmounts.length && !redundant ? tierAmounts : [{ name: null, amount: price }];
      for (const tier of sizeCells) {
        for (const group of groups) {
          const isImage = unit === "image";
          // 站点给图片单开了倍率时，按张的钱走图片倍率，不走文本倍率。
          const scaled = quantize(tier.amount * (isImage ? group.mediaRatio ?? group.ratio : group.ratio));
          rows.push({
            ...baseRowOf(rule, item, map, group),
            model_ratio: 0,
            completion_ratio: 1,
            input_price: null,
            output_price: null,
            cache_read_price: null,
            cache_write_price: null,
            request_price: isImage ? null : scaled,
            image_price: isImage ? scaled : null,
            ...(tier.name ? { size_tier: tier.name } : {}),
            ...(unit === "second" ? { request_unit: "second" } : {}),
            ...(rule.tierName ? { tier_name: rule.tierName } : {})
          });
        }
      }
      continue;
    }

    // kind === "token"
    // 上下文长度分档：档位对象里通常直接带各档的绝对价，表达式对着档位对象求值。
    // 倍率换算是站点属性，先算出来：ratioBase 决定 model_ratio 一个单位值多少美元。
    // ratioBase 是「model_ratio 一个单位值多少美元」，缺省取系统基准（New API 家族
    // ratio 1 = $2/百万）；偏离这个基准的站点在自己的映射里声明。
    const ratioBase = Number(rule.ratioBase) > 0 ? Number(rule.ratioBase) : SYSTEM_BASE_PRICE_PER_1M;
    const cells = tokenCells(rule, scaledRatioItem(item, ratioBase));
    if (!cells.length) {
      unresolved.push({ model: name, reason: "输入价算不出来", source: rule.input });
      continue;
    }
    const declaredRatio = Number(readPath(item, "completion_ratio"));
    for (const cell of cells) {
      if (cell.input === null || cell.input < 0) {
        unresolved.push({ model: name, reason: "输入价算不出来", source: rule.input, ...(cell.name ? { tier: cell.name } : {}) });
        continue;
      }
      for (const group of groups) {
        const scaledInput = quantize(cell.input * group.ratio);
        // 图片 token 价可以走自己的倍率（站点里叫「图片独立倍率」）。
        const mediaRatio = group.mediaRatio ?? group.ratio;
        rows.push({
          ...baseRowOf(rule, item, map, group),
          // 站点把 model_ratio 当成折扣后的价来用，这里跟着折后价走；
          // 分组倍率是 1 的站点（价格已折好）算出来和折前一样。
          model_ratio: quantize(scaledInput / ratioBase),
          // 站点显式给了 completion_ratio 就用它，否则按出价除以入价推，别硬写 1。
          completion_ratio: Number.isFinite(declaredRatio) ? declaredRatio
            : cell.input > 0 && cell.output !== null ? quantize(cell.output / cell.input) : 1,
          input_price: scaledInput,
          output_price: cell.output === null ? null : quantize(cell.output * group.ratio),
          cache_read_price: cell.cacheRead === null ? null : quantize(cell.cacheRead * group.ratio),
          cache_write_price: cell.cacheWrite === null ? null : quantize(cell.cacheWrite * group.ratio),
          ...(cell.cacheWrite1h === null || cell.cacheWrite1h === undefined ? {} : { cache_write_1h_price: quantize(cell.cacheWrite1h * group.ratio) }),
          request_price: null,
          image_price: null,
          image_input_price: cell.imageInput === null || cell.imageInput === undefined ? null : quantize(cell.imageInput * mediaRatio),
          image_output_price: cell.imageOutput === null || cell.imageOutput === undefined ? null : quantize(cell.imageOutput * mediaRatio),
          ...(cell.name ? { tier_name: cell.name } : rule.tierName ? { tier_name: rule.tierName } : {}),
          ...(cell.minTokens !== null && cell.minTokens !== undefined ? { min_tokens: cell.minTokens } : {}),
          ...(cell.maxTokens !== null && cell.maxTokens !== undefined ? { max_tokens: cell.maxTokens } : {})
        });
      }
    }
  }

  return { rows, unresolved };
}
