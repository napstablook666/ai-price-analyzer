// 给 billing-tiers-rs 生成真实输入用例：真实站点 payload 里的每一条计费表达式 + 手工边界表达式。
// 用法：node scripts/gen-billing-inputs.mjs
//      rust-anything record rust/billing-tiers-rs --inputs rust/billing-tiers-rs/cases-inputs.jsonl
import { readdirSync, readFileSync, writeFileSync } from "node:fs";

const FIXTURES = new URL("../test/fixtures/", import.meta.url);
const expressions = new Set();

// 真实 payload：把 JSON 里任何含 `tier(` 的字符串都当用例，不看字段名——
// 站点把表达式放在 billing_expr / expression / 嵌套 details 里都有。
function collect(value) {
  if (typeof value === "string") {
    if (value.includes("tier(")) expressions.add(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collect(item);
    return;
  }
  if (value && typeof value === "object") for (const item of Object.values(value)) collect(item);
}

for (const name of readdirSync(FIXTURES)) {
  if (!name.endsWith(".json")) continue;
  collect(JSON.parse(readFileSync(new URL(name, FIXTURES), "utf8")));
}

// 手工边界：把源码里每个分支和每处 `if (!…) continue` 都踩一遍。
const HANDWRITTEN = [
  // 非字符串与空表达式
  "", "   ", "plain price", "tier", "tiertier(",
  // 完整形态
  'tier("standard", p * 2 + c * 10)',
  'tier("standard", p*2+c*10+cr*0.1+cc*2.5+cc1h*5)',
  'tier("off_peak", p * 4.5 + c * 13.5) * 0.5',
  '(tier("standard", p * 2 + c * 10)) * 0.6',
  // 外层括号 + 顶层倍率（scaledBody 的两段循环）
  'tier("a", (p*2+c*8+cr*0.04))',
  'tier("a", (p*2+c*8+cr*0.04)*0.5)',
  'tier("a", ((p*2+c*8))*0.5/2)',
  'tier("a", (p*2+c*8)/0)',
  'tier("a", (p*2+c*8)*0)',
  'tier("a", ((p*2+c*8))',
  // fixed：按次 vs 按张
  'tier("request", fixed(0.06))',
  'tier("request", fixed(0.06)) * image_count',
  'tier("request", fixed(.5))',
  'tier("request", fixed(0))',
  'tier("request", FIXED(1.25))',
  'tier("request", fixed(0.06) * 2)',
  // 按秒
  'tier("480P", u("seconds") * 0.15)',
  "tier('720P', u('seconds')*0.3)",
  'tier("x", u("input_video_seconds") * 0.5 + u("seconds") * 0.5)',
  'tier("x", u("seconds") * 0)',
  // 长度区间：开闭、双括号、中间档写在最后
  'len <= 272000 ? tier("standard", p * 2 + c * 10) : tier("long_context", p * 4 + c * 15)',
  '((p <= 250000)) ? (tier("request", fixed(0.06))) : (tier("request", fixed(0.1)))',
  'len <= 250000 ? 0.06 : (len >= 500000 ? 0.2 : 0.1)',
  'len < 100 ? tier("a", p*1+c*2) : (len >= 100 ? tier("b", p*2+c*3) : tier("c", p*3+c*4))',
  'tokens >= 1000 ? tier("a", p*2) : tier("b", p*4)',
  'input_tokens > 500 ? tier("a", p*2+c*8) : tier("b", p*4+c*16)',
  // 时间条件 + 倍率
  '(tier("night", p * 3 + c * 9)) * (hour("Asia/Shanghai") >= 22 || hour("Asia/Shanghai") < 8 ? 0.5 : 1)',
  'hour("Asia/Shanghai") >= 9 && hour("Asia/Shanghai") < 18 ? tier("peak", p * 9 + c * 27) : tier("off_peak", p * 4.5 + c * 13.5)',
  'weekday("Asia/Shanghai") == 0 ? tier("a", p*2+c*4) : tier("b", p*4+c*8)',
  'tier("a", p*2+c*8) * (param("service_tier") == "fast" ? 2 : 1) * (param("service_tier") == "priority" ? 2.5 : 1)',
  // 系数形态：符号、乘号两侧、大写、未知键、纯负数
  'tier("a", -p*2 + c*8)',
  'tier("a", p*2 - c*8)',
  'tier("a", 2*p)',
  'tier("a", P*2 + C*8)',
  'tier("a", p*2 + c*8 + unknown*3)',
  'tier("a", -p*2 - c*8)',
  'tier("a", p * 0 + c * 0)',
  'tier("a", p*0.5 + c*0.5 + cr*1.25)',
  // 名字与参数解析：引号剥离、逗号在括号内、空 body、多余参数
  'tier("a,b", p*2+c*4)',
  "tier('name with space', p*2)",
  'tier(p*2+c*4)',
  'tier("only name")',
  'tier("a", p*2, extra)',
  'tier("a", tierx(1))',
  // 不平衡括号、引号里带转义与括号
  'tier("a", p*2',
  'tier("a(", p*2+c*4)',
  'tier("a", p*2+c*4) )',
  'tier("a\\"b", p*2+c*4)',
  // 多个 tier、大小写
  'TIER("a", p*2)',
  'Tier ("a", p*2)',
  'tier("a", p*2) + tier("b", c*4)',
  'tierx("a", p*2)'
];

for (const expression of HANDWRITTEN) expressions.add(expression);

const rows = [];
for (const expression of expressions) rows.push({ fn: "parseBillingTiers", args: [expression] });
// 非字符串入参：源码第一行就是类型守卫，这几个必须录。
for (const value of [null, undefined, 0, 42, true, false, [], {}, ["tier("], { tier: 1 }]) {
  rows.push({ fn: "parseBillingTiers", args: [value] });
}
rows.push({ fn: "parseBillingTiers", args: [] });

writeFileSync(new URL("../rust/billing-tiers-rs/cases-inputs.jsonl", import.meta.url), rows.map(row => JSON.stringify(row)).join("\n") + "\n");
console.log(`rows ${rows.length}（fixtures ${rows.length - HANDWRITTEN.length - 10} 条去重后）`);
