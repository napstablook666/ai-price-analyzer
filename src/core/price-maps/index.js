// 价格映射注册表：把「站点差异」和「映射引擎」分开。
//
// 为什么要有这一层：同形状的站点（TokenFlux / NewCodex / AllRouter / Star API / 星芽 …）
// 以前各写一份 price-maps/<id>.js，再在 normalizers.js 里各写一个 12 行的 strategy 类，
// 最后在 response-formats.js 里各占一个枚举值。三处加起来四十多行，业务差异只有两三个字段。
// 那些类的 parse() 全是一行 super.parse()，canParse() 只比 responseFormat 字符串。
//
// 现在站点只声明差异：{ base: "tokenflux", source: "xingya", currency: "USD", ratioBase: 1 }。
// ratioBase 是「一行报文里 model_ratio 一个单位值多少美元」，引擎会把它乘进求值上下文，
// 所以老站点（1 = $2 的那批）不必再复制一份映射、也不必在表达式里写 `* 2`。
// 引擎按 base 取内置映射，把声明里的键覆盖上去，交回 applyPriceMap 求值。
// 新增一个同形状站点不再需要动扩展代码。

import { tokenfluxPriceMap } from "./tokenflux.js";
import { stellaislePriceMap, stellaislePlazaPriceMap } from "./stellaisle.js";
import { stellaisleCarpoolPriceMap } from "./stellaisle-carpool.js";
import { cheapRouterPriceMap } from "./cheaprouter.js";
import { trueSotaPriceMap } from "./true-sota.js";
import { sidrunePriceMap } from "./sidrune.js";
import { relayRouterPriceMap } from "./relayrouter.js";
import { directPriceMap } from "./direct.js";
import { allrouterPriceMap } from "./allrouter.js";

// base 名 → 完整映射。名字就是站点 id，也允许按报文形状起的俗名。
export const PRICE_MAP_BASES = Object.freeze({
  tokenflux: tokenfluxPriceMap,
  allrouter: allrouterPriceMap,
  stellaisle: stellaislePriceMap,
  "stellaisle-plaza": stellaislePlazaPriceMap,
  "stellaisle-carpool": stellaisleCarpoolPriceMap,
  cheaprouter: cheapRouterPriceMap,
  "true-sota": trueSotaPriceMap,
  sidrune: sidrunePriceMap,
  relayrouter: relayRouterPriceMap,
  direct: directPriceMap
});

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

// 把声明式规格解析成完整映射。失败返回 { error }，调用方当「采不到价」处理，
// 不要抛——一个站点的映射写错不该让整轮采集停掉。
export function resolvePriceMap(spec, seen = new Set()) {
  if (!spec) return { error: "价格映射声明为空" };
  if (typeof spec === "string") {
    const base = PRICE_MAP_BASES[spec];
    return base ? { map: base } : { error: `未知的价格映射 base：${spec}` };
  }
  if (!isPlainObject(spec)) return { error: "价格映射声明必须是对象或 base 字符串" };

  const baseName = spec.base === undefined ? null : String(spec.base);
  let base = null;
  if (baseName) {
    if (seen.has(baseName)) return { error: `价格映射 base 循环引用：${baseName}` };
    const resolved = resolvePriceMap(baseName, new Set([...seen, baseName]));
    if (resolved.error) return resolved;
    base = resolved.map;
  }

  const overrides = { ...spec };
  delete overrides.base;
  if (!base) {
    // 没有 base 就是完全自定义：至少要自己给 rules 和 rootPath。
    if (!Array.isArray(overrides.rules)) return { error: "价格映射没有 base 时必须自带 rules 数组" };
    return { map: overrides };
  }

  const map = { ...base, ...overrides };
  if (isPlainObject(overrides.groups)) map.groups = { ...(base.groups || {}), ...overrides.groups };
  else if (base.groups) map.groups = base.groups;
  // rules 是数组，声明里给的数组整体替换（站点可能整套换掉计费模式）。
  map.rules = Array.isArray(overrides.rules) ? overrides.rules : base.rules;
  // ratioBase 留在映射顶层，由 applyPriceMap 下发到 token 规则（声明里只写一次）。
  return { map };
}

// 声明里有没有真正需要扩展处理的差异，便于体检脚本判断「这个站能不能只靠数据接进来」。
export function priceMapDiffKeys(spec) {
  if (!isPlainObject(spec) || !spec.base) return [];
  return Object.keys(spec).filter(key => key !== "base").sort();
}
