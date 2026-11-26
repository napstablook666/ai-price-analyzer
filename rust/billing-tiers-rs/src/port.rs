//! The Rust port of `src/core/billing-tiers.js`（`parseBillingTiers` 一个导出，私有 helper 一并搬过来）。
//!
//! 全程在 UTF-16 code unit 上索引，和 JS 的 `expression[index]` / `slice` 逐位对齐：
//! `js::string_units` 拿 units，产出字符串时用 `js::utf16_string`（孤立代理项也能原样回吐）。
//!
//! 下面每个 `// JS:` 注明对应源码的哪一处正则或哪一行判断。JS 正则一律没有 `u` 标志，
//! 所以 `\d` 是 `[0-9]`、`\s` 是下面 `is_space` 那张表、`\b` 按 ASCII 词字符算——Rust 的
//! `\d`/`\s`/`\b` 是 Unicode 语义，直接照抄会多认阿拉伯数字和全角空格，所以这些全部手写。
//!
//! 已知差异：JS 的 `/i` 还会把开尔文符号 U+212A 当成 `k`、把 `ſ` 当成 `s`。计费表达式里
//! 不存在这些字符，`diff` 的 432 条用例里也没有，这里按 ASCII 大小写不敏感处理。

#![forbid(unsafe_code)]

use serde_json::{Map, Value};

use crate::js;

/// `src/shared/schema.js:11` 的 `SYSTEM_BASE_PRICE_PER_1M`。
/// `test/rust-billing-tiers-parity.test.js` 拿 JS 侧的值对照，任一边改了都会红。
const SYSTEM_BASE_PRICE_PER_1M: f64 = 2.0;

const LF: u16 = b'\n' as u16;
const CR: u16 = b'\r' as u16;
const TAB: u16 = b'\t' as u16;
const VT: u16 = 0x0b;
const FF: u16 = 0x0c;
const SPACE: u16 = b' ' as u16;
const QUOTE_DOUBLE: u16 = b'"' as u16;
const QUOTE_SINGLE: u16 = b'\'' as u16;
const BACKSLASH: u16 = b'\\' as u16;
const OPEN_PAREN: u16 = b'(' as u16;
const CLOSE_PAREN: u16 = b')' as u16;
const OPEN_BRACKET: u16 = b'[' as u16;
const CLOSE_BRACKET: u16 = b']' as u16;
const COMMA: u16 = b',' as u16;
const QUESTION: u16 = b'?' as u16;
const COLON: u16 = b':' as u16;
const STAR: u16 = b'*' as u16;
const SLASH: u16 = b'/' as u16;
const PLUS: u16 = b'+' as u16;
const MINUS: u16 = b'-' as u16;
const DOT: u16 = b'.' as u16;
const UNDERSCORE: u16 = b'_' as u16;

/// Port of `parseBillingTiers` (`src/core/billing-tiers.js:160`).
pub fn parse_billing_tiers(expression: Value) -> Result<Value, String> {
    // JS: `if (typeof expression !== "string" || !expression.includes("tier")) return [];`
    // 类型判断写进去之前先做——非字符串（null / 数字 / 数组 / 对象）一律空数组。
    let Some(units) = js::string_units(&expression) else {
        return Ok(Value::Array(Vec::new()));
    };
    if !contains_ascii(&units, "tier") {
        return Ok(Value::Array(Vec::new()));
    }
    Ok(Value::Array(tiers_of(&units)))
}

fn tiers_of(expression: &[u16]) -> Vec<Value> {
    let branches = ternary_branches(expression);
    let mut tiers: Vec<Map<String, Value>> = Vec::new();
    // JS: `TIER_CALL_PATTERN.lastIndex = 0; while ((match = ...exec(expression)))`
    let mut cursor = 0usize;
    while let Some((call_start, after_paren)) = find_tier_call(expression, cursor) {
        // JS: `const span = balancedSpan(expression, TIER_CALL_PATTERN.lastIndex); if (!span) continue;`
        // 找不到配对的 `)` 时 `lastIndex` 停在原地，下一轮从右括号候选处接着找。
        let Some((body, end)) = balanced_span(expression, after_paren) else {
            cursor = after_paren;
            continue;
        };
        cursor = end + 1;
        // JS: `const [rawName, rawBody = ""] = splitArguments(span.body);`
        let (raw_name, raw_body) = split_arguments(body);
        let name = strip_quotes_and_trim(raw_name);
        let body = trim(raw_body);

        // JS: `.filter(item => item.start <= callStart && callStart < item.end).sort((a, b) => (a.end - a.start) - (b.end - b.start))[0]`
        // 取最短的包住 callStart 的分支：嵌套三元里最内层的那一个。
        // JS: `.filter(item => item.start <= callStart && callStart < item.end).sort(...)[0]`
        // 取最短的包住 callStart 的分支：嵌套三元里最内层的那一个。
        // `min_by` 在相等时保留先出现的那个，和 JS 稳定排序取 `[0]` 一致。
        let branch = branches
            .iter()
            .filter(|item| item.start <= call_start && call_start < item.end)
            .min_by(|left, right| {
                let left_span = left.end - left.start;
                let right_span = right.end - right.start;
                left_span.cmp(&right_span)
            });
        let boundary = boundary_of(branch.map(|item| &item.condition[..]));

        // JS: `const fixed = body.match(/^fixed\s*\(\s*(\d+(?:\.\d+)?|\.\d+)\s*\)$/i);`
        if let Some(price) = parse_fixed(body) {
            // JS: `const perImage = /^\s*\*\s*image_count\b/i.test(expression.slice(span.end + 1));`
            let per_image = starts_with_image_count(&expression[end + 1..]);
            let unit = if per_image { "image" } else { "request" };
            let mut tier = flat_tier_head(&name, unit, price);
            if !per_image {
                tier.insert("request".to_string(), js::number(price));
            }
            tiers.push(with_boundary(tier, &boundary));
            continue;
        }

        // JS: `const perSecond = body.match(/^u\s*\(\s*["']seconds["']\s*\)\s*\*\s*(\d+(?:\.\d+)?|\.\d+)$/i);`
        if let Some(per_second) = parse_per_second(body)
            && per_second > 0.0
        {
            let tier = flat_tier_head(&name, "second", per_second);
            tiers.push(with_boundary(tier, &boundary));
            continue;
        }
        // JS: `if (/\bu\s*\(/i.test(body)) continue;` 复合用量公式（u("x")*0.5 + u("y")*0.5）不猜单价。
        if has_call(body, &["u"]) {
            continue;
        }

        // JS: `const { body: priceBody, scale } = scaledBody(body);`
        let (price_body, scale) = scaled_body(body);
        let mut coefficients: Vec<(Vec<u16>, f64)> = Vec::new();
        // JS: `for (const term of priceBody.match(/[+-]?[^+-]+/g) || [])`
        for term in split_terms(&price_body) {
            // JS: `const parts = term.trim().match(/^([+-]?)\s*(?:(\d+(?:\.\d+)?|\.\d+)\s*\*\s*)?([a-z0-9]+)(?:\s*\*\s*(\d+(?:\.\d+)?|\.\d+))?$/i);`
            let Some((key, coefficient)) = parse_term(term) else {
                continue;
            };
            // JS: `coefficients[parts[3].toLowerCase()] = (coefficients[..] || 0) + coefficient;`
            match coefficients.iter_mut().find(|(name, _)| *name == key) {
                Some((_, total)) => *total += coefficient,
                None => coefficients.push((key, coefficient)),
            }
        }
        let coefficient = |name: &str| -> f64 {
            let needle: Vec<u16> = name.encode_utf16().collect();
            coefficients
                .iter()
                .find(|(key, _)| *key == needle)
                .map_or(0.0, |(_, value)| *value)
        };
        let input = coefficient("p") * scale;
        let output = coefficient("c") * scale;
        // JS: `if (input <= 0 && output <= 0) continue;` 注意 NaN 也走这条（比较恒为 false）。
        if input <= 0.0 && output <= 0.0 {
            continue;
        }
        let billing = object(vec![
            ("cacheRead", js::number(coefficient("cr") * scale)),
            ("cacheWrite", js::number(coefficient("cc") * scale)),
            ("cacheWrite1h", js::number(coefficient("cc1h") * scale)),
        ]);
        let tier = fields(vec![
            ("name", js::utf16_string(&name)),
            ("input", js::number(input)),
            ("output", js::number(output)),
            ("ratio", js::number(input / SYSTEM_BASE_PRICE_PER_1M)),
            // JS: `completion: input > 0 ? output / input : 1`
            (
                "completion",
                js::number(if input > 0.0 { output / input } else { 1.0 }),
            ),
            ("billing", billing),
            ("unit", Value::String("token".to_string())),
            ("fixed", Value::Null),
        ]);
        tiers.push(with_boundary(tier, &boundary));
    }

    // JS: 两个绝对价档按时间互斥切换，不能把低峰价当成无条件报价。
    let time_branch = if branches.len() == 1 {
        branches.first()
    } else {
        None
    };
    if tiers.len() == 2
        && let Some(time_branch) = time_branch
        && has_time_call(&time_branch.condition)
        && tiers.iter().all(|tier| {
            tier.get("minTokens") == Some(&Value::Null)
                && tier.get("maxTokens") == Some(&Value::Null)
        })
    {
        let negated: Vec<u16> = "!("
            .encode_utf16()
            .chain(time_branch.condition.iter().copied())
            .chain(")".encode_utf16())
            .collect();
        let time_rule = |expression: &[u16]| {
            Value::Array(vec![object(vec![
                ("type", Value::String("time".to_string())),
                ("expression", js::utf16_string(expression)),
            ])])
        };
        tiers[0].insert(
            "billingConditions".to_string(),
            time_rule(&time_branch.condition),
        );
        tiers[1].insert("billingConditions".to_string(), time_rule(&negated));
    }

    // JS: `for (const multiplierRule of expression.matchAll(TIER_MULTIPLIER_PATTERN))`
    for (condition, multiplier, fallback_multiplier) in multiplier_rules(expression) {
        let condition = trim(&condition);
        // JS: `const type = /\b(?:hour|weekday)\s*\(/i.test(condition) ? "time" : "context";`
        let kind = if has_time_call(condition) {
            "time"
        } else {
            "context"
        };
        for tier in tiers.iter_mut() {
            if kind == "time" {
                tier.insert("timeDiscount".to_string(), js::number(multiplier));
                tier.insert("timeCondition".to_string(), js::utf16_string(condition));
            }
            let rule = object(vec![
                ("type", Value::String(kind.to_string())),
                ("expression", js::utf16_string(condition)),
                ("multiplier", js::number(multiplier)),
                ("fallback_multiplier", js::number(fallback_multiplier)),
            ]);
            let entry = tier
                .entry("billingConditions".to_string())
                .or_insert_with(|| Value::Array(Vec::new()));
            if let Value::Array(items) = entry {
                items.push(rule);
            }
        }
    }

    // JS: 只有出现长度条件时才补区间下界，否则普通单档模型不该凭空多出 min_tokens。
    if tiers.iter().any(|tier| {
        tier.get("minTokens") != Some(&Value::Null) || tier.get("maxTokens") != Some(&Value::Null)
    }) {
        fill_gaps(&mut tiers);
    }

    tiers.into_iter().map(Value::Object).collect()
}

/// `boundaryOf` 的结论。
struct Boundary {
    min_tokens: Option<f64>,
    max_tokens: Option<f64>,
    max_inclusive: bool,
}

/// 按次 / 按秒档的公共字段：价格全在 `fixed` 上，token 侧一律 0。
fn flat_tier_head(name: &[u16], unit: &str, price: f64) -> Map<String, Value> {
    fields(vec![
        ("name", js::utf16_string(name)),
        ("input", js::number(0.0)),
        ("output", js::number(0.0)),
        ("ratio", js::number(0.0)),
        ("completion", js::number(1.0)),
        ("billing", zero_billing()),
        ("unit", Value::String(unit.to_string())),
        ("fixed", js::number(price)),
    ])
}

/// 三档都带 `minTokens` / `maxTokens` / `maxInclusive`，`boundaryOf` 的结论原样落进去。
fn with_boundary(mut tier: Map<String, Value>, boundary: &Boundary) -> Map<String, Value> {
    tier.extend(fields(vec![
        (
            "minTokens",
            boundary.min_tokens.map_or(Value::Null, js::number),
        ),
        (
            "maxTokens",
            boundary.max_tokens.map_or(Value::Null, js::number),
        ),
        ("maxInclusive", Value::Bool(boundary.max_inclusive)),
    ]));
    tier
}

/// JS 里的对象字面量：`fields([...])` 是 `Map`，`object([...])` 是它的 `Value` 包装。
fn fields(pairs: Vec<(&str, Value)>) -> Map<String, Value> {
    pairs
        .into_iter()
        .map(|(key, value)| (key.to_string(), value))
        .collect()
}

fn object(pairs: Vec<(&str, Value)>) -> Value {
    Value::Object(fields(pairs))
}

fn zero_billing() -> Value {
    object(vec![
        ("cacheRead", js::number(0.0)),
        ("cacheWrite", js::number(0.0)),
        ("cacheWrite1h", js::number(0.0)),
    ])
}

/// JS: `balancedSpan(source, start)`（`start` 是开括号之后的位置）。
fn balanced_span(source: &[u16], start: usize) -> Option<(&[u16], usize)> {
    let mut depth = 1i64;
    let mut quote: Option<u16> = None;
    let mut index = start;
    while index < source.len() {
        let char = source[index];
        if let Some(active) = quote {
            if char == BACKSLASH {
                // JS 是 `index += 1` 后再走 for 的 `index += 1`，等价于跳过两个。
                index += 2;
                continue;
            }
            if char == active {
                quote = None;
            }
            index += 1;
            continue;
        }
        if char == QUOTE_DOUBLE || char == QUOTE_SINGLE {
            quote = Some(char);
            index += 1;
            continue;
        }
        if char == OPEN_PAREN {
            depth += 1;
        } else if char == CLOSE_PAREN {
            depth -= 1;
            if depth == 0 {
                return Some((&source[start..index], index));
            }
        }
        index += 1;
    }
    None
}

/// JS: `splitArguments(body)` 的前两段（源码只用 `[rawName, rawBody = ""]`）。
fn split_arguments(body: &[u16]) -> (&[u16], &[u16]) {
    let mut depth = 0i64;
    let mut quote: Option<u16> = None;
    let mut start = 0usize;
    let mut first_end: Option<usize> = None;
    for (index, &char) in body.iter().enumerate() {
        if let Some(active) = quote {
            if char == active {
                quote = None;
            }
            continue;
        }
        if char == QUOTE_DOUBLE || char == QUOTE_SINGLE {
            quote = Some(char);
            continue;
        }
        if char == OPEN_PAREN || char == OPEN_BRACKET {
            depth += 1;
        } else if char == CLOSE_PAREN || char == CLOSE_BRACKET {
            depth -= 1;
        }
        if char == COMMA && depth == 0 {
            match first_end {
                // 第二个顶层逗号就是 `rawBody` 的结尾，后面的参数源码用不到。
                Some(end) => return (&body[..end], &body[start..index]),
                None => {
                    first_end = Some(index);
                    start = index + 1;
                }
            }
        }
    }
    match first_end {
        Some(end) => (&body[..end], &body[start..]),
        // 没有逗号：`rawBody = ""`（解构默认值）。
        None => (body, &body[body.len()..]),
    }
}

/// JS: `TIER_CALL_PATTERN = /tier\s*\(/gi` 的循环：返回 `(调用起点, 开括号之后的位置)`。
fn find_tier_call(expression: &[u16], from: usize) -> Option<(usize, usize)> {
    let mut index = from;
    while index < expression.len() {
        if let Some(after) = match_ascii_ci(expression, index, "tier") {
            let paren = skip_space(expression, after);
            if expression.get(paren) == Some(&OPEN_PAREN) {
                return Some((index, paren + 1));
            }
        }
        index += 1;
    }
    None
}

/// JS: `String(rawName || "").replace(/["']/g, "").trim()`
fn strip_quotes_and_trim(value: &[u16]) -> Vec<u16> {
    let stripped: Vec<u16> = value
        .iter()
        .copied()
        .filter(|char| *char != QUOTE_DOUBLE && *char != QUOTE_SINGLE)
        .collect();
    trim(&stripped).to_vec()
}

/// `conditionBefore(expression, questionAt)`：往回找这个 `?` 所属的条件表达式。
fn condition_before(expression: &[u16], question_at: usize) -> Vec<u16> {
    let mut depth = 0i64;
    let mut quote: Option<u16> = None;
    let mut index = question_at as i64 - 1;
    while index >= 0 {
        let char = expression[index as usize];
        if let Some(active) = quote {
            if char == active {
                quote = None;
            }
            index -= 1;
            continue;
        }
        if char == QUOTE_DOUBLE || char == QUOTE_SINGLE {
            quote = Some(char);
            index -= 1;
            continue;
        }
        if char == CLOSE_PAREN {
            depth += 1;
            index -= 1;
            continue;
        }
        if char == OPEN_PAREN {
            if depth == 0 {
                break;
            }
            depth -= 1;
            index -= 1;
            continue;
        }
        if depth > 0 {
            index -= 1;
            continue;
        }
        if char == QUESTION || char == COLON || char == COMMA {
            break;
        }
        index -= 1;
    }
    trim(&expression[(index + 1) as usize..question_at]).to_vec()
}

/// 三元链里的一个分支。
struct Branch {
    condition: Vec<u16>,
    start: usize,
    end: usize,
}

/// JS: `ternaryBranches(expression)`。分支按 `:` 出现的顺序入列，与源码一致。
fn ternary_branches(expression: &[u16]) -> Vec<Branch> {
    let mut branches: Vec<Branch> = Vec::new();
    let mut open: Vec<usize> = Vec::new();
    let mut quote: Option<u16> = None;
    for (index, &char) in expression.iter().enumerate() {
        if let Some(active) = quote {
            if char == active {
                quote = None;
            }
            continue;
        }
        if char == QUOTE_DOUBLE || char == QUOTE_SINGLE {
            quote = Some(char);
            continue;
        }
        // 括号只影响分支边界，源码在这个函数里维护 depth 却从不读它；
        // 分支的 start/end 用的是 `?` 和 `:` 的下标，所以这里不需要 depth。
        if char == OPEN_PAREN
            || char == OPEN_BRACKET
            || char == CLOSE_PAREN
            || char == CLOSE_BRACKET
        {
            continue;
        }
        if char == QUESTION {
            open.push(index);
            continue;
        }
        if char != COLON || open.is_empty() {
            continue;
        }
        let question_at = open.pop().expect("open 非空已判过");
        branches.push(Branch {
            condition: condition_before(expression, question_at),
            start: question_at + 1,
            end: index,
        });
    }
    for question_at in open {
        branches.push(Branch {
            condition: condition_before(expression, question_at),
            start: question_at + 1,
            end: expression.len(),
        });
    }
    branches
}

/// JS: `boundaryOf(condition)`，`undefined` 的 condition 走 `String(condition || "")`。
fn boundary_of(condition: Option<&[u16]>) -> Boundary {
    // JS 返回 `{}`：三个字段都是 undefined，落到 `?? null` / `?? true`。
    let silent = Boundary {
        min_tokens: None,
        max_tokens: None,
        max_inclusive: true,
    };
    let Some((operator, value)) = boundary_match(condition.unwrap_or_default()) else {
        return silent;
    };
    if !value.is_finite() {
        return silent;
    }
    // JS: `if (operator.startsWith("<")) return { maxTokens: value, maxInclusive: operator === "<=" };`
    if operator.starts_with('<') {
        return Boundary {
            max_tokens: Some(value),
            max_inclusive: operator == "<=",
            ..silent
        };
    }
    Boundary {
        min_tokens: Some(if operator == ">=" { value } else { value + 1.0 }),
        ..silent
    }
}

/// JS: `/(?:^|[^a-z0-9_])(?:len|length|tokens?|input_tokens?|p)\s*(<=|<|>=|>)\s*(\d+(?:\.\d+)?)[\s)]*$/i`
///
/// `/i` 下 `[^a-z0-9_]` 连大写也排掉，所以这里是 `[^a-zA-Z0-9_]`。整条正则锚在结尾，
/// 于是「最左边的能一路匹配到结尾的起点」就是 JS 的结果；捕获组只有运算符和数字，
/// 关键字用哪个分支不影响返回值，所以这里只判断「有没有一条能走通」。
fn boundary_match(text: &[u16]) -> Option<(&'static str, f64)> {
    const KEYWORDS: [&str; 5] = ["len", "length", "tokens", "input_tokens", "p"];
    for start in 0..text.len() {
        let allowed = start == 0 || !is_word_char(text[start - 1]);
        if !allowed {
            continue;
        }
        for keyword in KEYWORDS {
            let Some(after_keyword) = match_ascii_ci(text, start, keyword) else {
                continue;
            };
            // `tokens?` / `input_tokens?`：末尾的 `s` 可有可无，正则里已经是贪婪的，
            // 但两种情况都要试，因为 `token` 后面还可能直接跟 `\s*(<=…)`。
            for candidate in keyword_variants(start, keyword, after_keyword) {
                if let Some(found) = boundary_tail(text, candidate) {
                    return Some(found);
                }
            }
        }
    }
    None
}

/// 关键字后面允许的落点：`tokens?` 与 `input_tokens?` 各有「带 s」和「不带 s」两个位置。
fn keyword_variants(start: usize, keyword: &'static str, after_keyword: usize) -> Vec<usize> {
    let mut out = vec![after_keyword];
    if matches!(keyword, "tokens" | "input_tokens") {
        let trimmed = keyword.trim_end_matches('s');
        out.push(start + trimmed.len());
    }
    out
}

/// `\s*(<=|<|>=|>)\s*(\d+(?:\.\d+)?)[\s)]*$` 从 `from` 开始。
fn boundary_tail(text: &[u16], from: usize) -> Option<(&'static str, f64)> {
    let mut index = from;
    index = skip_space(text, index);
    // 顺序照抄正则的交替顺序：`<=` / `>=` 必须先于 `<` / `>` 试。
    let operator = ["<=", ">=", "<", ">"]
        .into_iter()
        .find_map(|operator| match_ascii_ci(text, index, operator).map(|end| (operator, end)))?;
    let (operator, mut index) = operator;
    index = skip_space(text, index);
    // `\d+` 必须有，`.` 后面也要有数字；`\d+(?:\.\d+)?` 先贪心再决定带不带小数。
    let (integer, mut index) = match_digits(text, index)?;
    let mut value_units: Vec<u16> = integer.to_vec();
    if index < text.len()
        && text[index] == DOT
        && let Some((fraction, after_fraction)) = match_digits(text, index + 1)
    {
        value_units.push(DOT);
        value_units.extend_from_slice(fraction);
        index = after_fraction;
    }
    if index < text.len() && (is_space(text[index]) || text[index] == CLOSE_PAREN) {
        // `[\s)]*$`：数字后面只允许空格和右括号，且必须一路到结尾。
        let mut rest = index;
        while rest < text.len() && (is_space(text[rest]) || text[rest] == CLOSE_PAREN) {
            rest += 1;
        }
        if rest != text.len() {
            return None;
        }
    } else if index != text.len() {
        return None;
    }
    Some((operator, parse_number(&value_units)))
}

/// `^name\s*\(\s*` 之后的位置。
fn open_call(text: &[u16], name: &str) -> Option<usize> {
    let end = match_ascii_ci(text, 0, name)?;
    let index = skip_space(text, end);
    require_char(text, index, OPEN_PAREN)
}

/// 跳过空白后要求恰好是 `char`，返回它之后的位置。
fn require_char(text: &[u16], from: usize, char: u16) -> Option<usize> {
    let index = skip_space(text, from);
    (text.get(index) == Some(&char)).then_some(index + 1)
}

/// JS: `body.match(/^fixed\s*\(\s*(\d+(?:\.\d+)?|\.\d+)\s*\)$/i)`
fn parse_fixed(body: &[u16]) -> Option<f64> {
    let (digits, after_digits) = match_number(body, open_call(body, "fixed")?)?;
    let index = require_char(body, after_digits, CLOSE_PAREN)?;
    (index == body.len()).then(|| parse_number(digits))
}

/// JS: `/^\s*\*\s*image_count\b/i.test(expression.slice(span.end + 1))`
fn starts_with_image_count(rest: &[u16]) -> bool {
    let mut index = skip_space(rest, 0);
    if rest.get(index) != Some(&STAR) {
        return false;
    }
    index = skip_space(rest, index + 1);
    let Some(end) = match_ascii_ci(rest, index, "image_count") else {
        return false;
    };
    // `\b`：结尾或非 ASCII 词字符。没加 `u`，所以 `\b` 只看 [A-Za-z0-9_]。
    end == rest.len() || !is_word_char(rest[end])
}

/// JS: `/^u\s*\(\s*["']seconds["']\s*\)\s*\*\s*(\d+(?:\.\d+)?|\.\d+)$/i`
fn parse_per_second(body: &[u16]) -> Option<f64> {
    let index = open_call(body, "u")?;
    let quote = *body.get(index)?;
    if quote != QUOTE_DOUBLE && quote != QUOTE_SINGLE {
        return None;
    }
    let after_seconds = match_ascii_ci(body, index + 1, "seconds")?;
    let after_quote = require_char(body, after_seconds, quote)?;
    let after_paren = require_char(body, after_quote, CLOSE_PAREN)?;
    let after_star = require_char(body, after_paren, STAR)?;
    let (digits, after_digits) = match_number(body, skip_space(body, after_star))?;
    (after_digits == body.len()).then(|| parse_number(digits))
}

/// JS 的 `\b(?:关键词)\s*\(`——`u("x")` 与 `hour(` / `weekday(` 共用这一个扫描器。
fn has_call(text: &[u16], keywords: &[&str]) -> bool {
    (0..text.len()).any(|index| {
        let Some(end) = keywords
            .iter()
            .find_map(|keyword| match_ascii_ci(text, index, keyword))
        else {
            return false;
        };
        (index == 0 || !is_word_char(text[index - 1]))
            && text.get(skip_space(text, end)) == Some(&OPEN_PAREN)
    })
}

/// JS: `/\b(?:hour|weekday)\s*\(/i.test(condition)`
fn has_time_call(condition: &[u16]) -> bool {
    has_call(condition, &["hour", "weekday"])
}

/// JS: `scaledBody(text)`：剥掉外层括号与顶层倍率，返回 `{ body, scale }`。
fn scaled_body(text: &[u16]) -> (Vec<u16>, f64) {
    let mut value = trim(text).to_vec();
    let mut scale = 1.0f64;
    // JS: `/^(\([\s\S]*\))\s*([*/])\s*(\d+(?:\.\d+)?|\.\d+)$/`
    // `[\s\S]*` 是贪婪的，所以从最右边的 `)` 往左找第一个能整段匹配的。
    while let Some((body_end, operator, factor)) = match_scale_suffix(&value) {
        if !factor.is_finite() || factor == 0.0 {
            break;
        }
        scale *= if operator == SLASH {
            1.0 / factor
        } else {
            factor
        };
        value = trim(&value[..=body_end]).to_vec();
    }
    // JS: 再剥纯外层括号，只有配对到结尾才算外层。
    loop {
        if value.first() != Some(&OPEN_PAREN) {
            break;
        }
        let Some((body, end)) = balanced_span(&value, 1) else {
            break;
        };
        if end + 1 != value.len() {
            break;
        }
        value = trim(body).to_vec();
    }
    (value, scale)
}

/// `^(\([\s\S]*\))\s*([*/])\s*(num)$`：返回 `(右括号下标, 运算符, 倍率)`。
fn match_scale_suffix(value: &[u16]) -> Option<(usize, u16, f64)> {
    if value.first() != Some(&OPEN_PAREN) {
        return None;
    }
    // 贪婪的 `\([\s\S]*\)`：先试最右边的 `)`，依次往左。
    for body_end in (1..value.len()).rev() {
        if value[body_end] != CLOSE_PAREN {
            continue;
        }
        let mut index = skip_space(value, body_end + 1);
        let Some(&operator) = value.get(index) else {
            continue;
        };
        if operator != STAR && operator != SLASH {
            continue;
        }
        index = skip_space(value, index + 1);
        let (digits, after_digits) = match match_number(value, index) {
            Some(found) => found,
            None => continue,
        };
        if after_digits != value.len() {
            continue;
        }
        return Some((body_end, operator, parse_number(digits)));
    }
    None
}

/// JS: `priceBody.match(/[+-]?[^+-]+/g) || []`
fn split_terms(price_body: &[u16]) -> Vec<&[u16]> {
    let mut terms = Vec::new();
    let mut index = 0usize;
    while index < price_body.len() {
        let mut start = index;
        if price_body[start] == PLUS || price_body[start] == MINUS {
            start += 1;
        }
        // 符号后面必须还有非符号字符，否则这个位置不算匹配，整体右移一格。
        if start >= price_body.len() || price_body[start] == PLUS || price_body[start] == MINUS {
            index += 1;
            continue;
        }
        let mut end = start;
        while end < price_body.len() && price_body[end] != PLUS && price_body[end] != MINUS {
            end += 1;
        }
        terms.push(&price_body[index..end]);
        index = end;
    }
    terms
}

/// JS: `/^([+-]?)\s*(?:(\d+(?:\.\d+)?|\.\d+)\s*\*\s*)?([a-z0-9]+)(?:\s*\*\s*(\d+(?:\.\d+)?|\.\d+))?$/i`
/// 返回 `(小写后的键, 系数)`。
fn parse_term(term: &[u16]) -> Option<(Vec<u16>, f64)> {
    let term = trim(term);
    let mut index = 0usize;
    let sign = if term.first() == Some(&MINUS) {
        index = 1;
        -1.0
    } else {
        if term.first() == Some(&PLUS) {
            index = 1;
        }
        1.0
    };
    index = skip_space(term, index);
    // 可选的前置 `数字 *`
    let mut leading: Option<f64> = None;
    let restore = index;
    if let Some((digits, after_digits)) = match_number(term, index) {
        let mut probe = skip_space(term, after_digits);
        if term.get(probe) == Some(&STAR) {
            probe = skip_space(term, probe + 1);
            leading = Some(parse_number(digits));
            index = probe;
        }
    }
    if leading.is_none() {
        index = restore;
    }
    // `([a-z0-9]+)`：至少一个 ASCII 字母或数字，贪婪。
    let name_start = index;
    while index < term.len() && is_ascii_alnum(term[index]) {
        index += 1;
    }
    if index == name_start {
        return None;
    }
    let name: Vec<u16> = term[name_start..index]
        .iter()
        .map(|char| ascii_lower(*char))
        .collect();
    // 可选的 `* 数字`，且必须正好到结尾。
    let mut trailing: Option<f64> = None;
    let probe = skip_space(term, index);
    if term.get(probe) == Some(&STAR) {
        let after_star = skip_space(term, probe + 1);
        if let Some((digits, after_digits)) = match_number(term, after_star)
            && after_digits == term.len()
        {
            trailing = Some(parse_number(digits));
            index = after_digits;
        }
    }
    if index != term.len() {
        return None;
    }
    let coefficient = leading.or(trailing).unwrap_or(1.0) * sign;
    Some((name, coefficient))
}

/// JS: `for (const multiplierRule of expression.matchAll(TIER_MULTIPLIER_PATTERN))`
/// `/\*\s*\(\s*([^?]*?)\?\s*(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)\s*\)/gi`
fn multiplier_rules(expression: &[u16]) -> Vec<(Vec<u16>, f64, f64)> {
    let mut rules = Vec::new();
    let mut cursor = 0usize;
    while cursor < expression.len() {
        let Some(star) = position_of(expression, STAR, cursor) else {
            break;
        };
        let spanned = (|| {
            let mut index = skip_space(expression, star + 1);
            if expression.get(index) != Some(&OPEN_PAREN) {
                return None;
            }
            index = skip_space(expression, index + 1);
            // `[^?]*?` 不能含 `?`，所以这个 `?` 只能是后面的第一个。
            let question = position_of(expression, QUESTION, index)?;
            let condition: Vec<u16> = expression[index..question].to_vec();
            let mut at = skip_space(expression, question + 1);
            let (first_digits, after_first) = match_number(expression, at)?;
            at = skip_space(expression, after_first);
            if expression.get(at) != Some(&COLON) {
                return None;
            }
            at = skip_space(expression, at + 1);
            let (second_digits, after_second) = match_number(expression, at)?;
            at = skip_space(expression, after_second);
            if expression.get(at) != Some(&CLOSE_PAREN) {
                return None;
            }
            Some((
                condition,
                parse_number(first_digits),
                parse_number(second_digits),
                at + 1,
            ))
        })();
        match spanned {
            Some((condition, multiplier, fallback, next)) => {
                rules.push((condition, multiplier, fallback));
                cursor = next;
            }
            // 这个 `*` 走不通，从它后面一格继续找下一个。
            None => cursor = star + 1,
        }
    }
    rules
}

/// JS: 区间补全——先按已知下界排骨架，再把无边界档填进空隙。
fn fill_gaps(tiers: &mut [Map<String, Value>]) {
    let min_of = |tier: &Map<String, Value>| tier.get("minTokens").and_then(Value::as_f64);
    let max_of = |tier: &Map<String, Value>| tier.get("maxTokens").and_then(Value::as_f64);
    let inclusive_of = |tier: &Map<String, Value>| {
        tier.get("maxInclusive")
            .and_then(Value::as_bool)
            .unwrap_or(true)
    };
    // JS: `const upperAfter = tier => (tier.maxTokens === null ? Infinity : tier.maxInclusive === false ? tier.maxTokens : tier.maxTokens + 1);`
    let upper_after = |tier: &Map<String, Value>| -> f64 {
        match max_of(tier) {
            None => f64::INFINITY,
            Some(max) => {
                if !inclusive_of(tier) {
                    max
                } else {
                    max + 1.0
                }
            }
        }
    };

    // JS: `const skeleton = tiers.filter(...).sort((a, b) => (a.minTokens ?? 0) - (b.minTokens ?? 0));`
    let mut skeleton: Vec<usize> = (0..tiers.len())
        .filter(|index| min_of(&tiers[*index]).is_some() || max_of(&tiers[*index]).is_some())
        .collect();
    skeleton.sort_by(|left, right| {
        let left_key = min_of(&tiers[*left]).unwrap_or(0.0);
        let right_key = min_of(&tiers[*right]).unwrap_or(0.0);
        left_key
            .partial_cmp(&right_key)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    let mut cursor = 0.0f64;
    for &index in &skeleton {
        if min_of(&tiers[index]).is_none() {
            tiers[index].insert("minTokens".to_string(), js::number(cursor));
        }
        cursor = upper_after(&tiers[index]);
    }

    // JS: `const gaps = []` —— 每段空隙记 start/end，末尾那段 end 是 null。
    let mut gaps: Vec<(f64, Option<f64>)> = Vec::new();
    let mut gap_start = 0.0f64;
    for &index in &skeleton {
        let start = min_of(&tiers[index]).unwrap_or(0.0);
        if start > gap_start {
            gaps.push((gap_start, Some(start - 1.0)));
        }
        let next = upper_after(&tiers[index]);
        if next.is_infinite() {
            gap_start = f64::INFINITY;
            break;
        }
        gap_start = next;
    }
    if !gap_start.is_infinite() {
        gaps.push((gap_start, None));
    }

    let floating: Vec<usize> = (0..tiers.len())
        .filter(|index| min_of(&tiers[*index]).is_none() && max_of(&tiers[*index]).is_none())
        .collect();
    for (position, &index) in floating.iter().enumerate() {
        let Some(&(start, end)) = gaps.get(position) else {
            continue;
        };
        tiers[index].insert("minTokens".to_string(), js::number(start));
        tiers[index].insert("maxTokens".to_string(), end.map_or(Value::Null, js::number));
    }

    // JS: `if (floating.length) tiers.sort((a, b) => (a.minTokens ?? 0) - (b.minTokens ?? 0));`
    if !floating.is_empty() {
        js::sort(tiers, |left, right| {
            let left_key = min_of(left).unwrap_or(0.0);
            let right_key = min_of(right).unwrap_or(0.0);
            left_key - right_key
        });
    }
}

// ---- 字符与数字工具 -------------------------------------------------------------------------

/// JS 的 `\s`（`[\f\n\r\t\v\u0020\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]`）。
fn is_space(char: u16) -> bool {
    matches!(
        char,
        TAB | LF
            | VT
            | FF
            | CR
            | SPACE
            | 0x00a0
            | 0x1680
            | 0x2028
            | 0x2029
            | 0x202f
            | 0x205f
            | 0x3000
            | 0xfeff
    ) || (0x2000..=0x200a).contains(&char)
}

/// JS 的 `\b` 与 `[a-z0-9_]`：只算 ASCII。
fn is_word_char(char: u16) -> bool {
    char == UNDERSCORE || is_ascii_alnum(char)
}
fn is_ascii_alnum(char: u16) -> bool {
    char < 0x80 && u8::try_from(char).is_ok_and(|byte| byte.is_ascii_alphanumeric())
}

/// `u16` 上没有 `u8` 的那套 ASCII 判定，这里补两个，避免每次都 `try_from`。
fn is_ascii_digit(char: u16) -> bool {
    (b'0' as u16..=b'9' as u16).contains(&char)
}

/// ASCII 小写化（JS 的 `/i` 对 ASCII 部分就是这个语义）。
fn ascii_lower(char: u16) -> u16 {
    if (b'A' as u16..=b'Z' as u16).contains(&char) {
        char + 32
    } else {
        char
    }
}

fn trim(value: &[u16]) -> &[u16] {
    let mut start = 0usize;
    let mut end = value.len();
    while start < end && is_space(value[start]) {
        start += 1;
    }
    while end > start && is_space(value[end - 1]) {
        end -= 1;
    }
    &value[start..end]
}

fn skip_space(text: &[u16], from: usize) -> usize {
    let mut index = from;
    while index < text.len() && is_space(text[index]) {
        index += 1;
    }
    index
}

fn contains_ascii(haystack: &[u16], needle: &str) -> bool {
    let needle: Vec<u16> = needle.encode_utf16().collect();
    haystack
        .windows(needle.len())
        .any(|window| window == needle.as_slice())
}

fn position_of(text: &[u16], char: u16, from: usize) -> Option<usize> {
    text.get(from..)?
        .iter()
        .position(|found| *found == char)
        .map(|at| from + at)
}

/// 大小写不敏感的 ASCII 匹配（JS 的 `/i` 对 ASCII 部分就是这个语义）。
fn match_ascii_ci(text: &[u16], from: usize, literal: &str) -> Option<usize> {
    let expected: Vec<u16> = literal.encode_utf16().map(ascii_lower).collect();
    if text.len() < from + expected.len() {
        return None;
    }
    let matched = text[from..from + expected.len()]
        .iter()
        .zip(expected.iter())
        .all(|(char, want)| ascii_lower(*char) == *want);
    if matched {
        Some(from + expected.len())
    } else {
        None
    }
}

/// `[0-9]+`，返回 `(数字片段, 之后的位置)`。
fn match_digits(text: &[u16], from: usize) -> Option<(&[u16], usize)> {
    let mut index = from;
    while index < text.len() && is_ascii_digit(text[index]) {
        index += 1;
    }
    if index == from {
        return None;
    }
    Some((&text[from..index], index))
}

/// `(\d+(?:\.\d+)?|\.\d+)`，返回 `(整个数字片段, 之后的位置)`。
fn match_number(text: &[u16], from: usize) -> Option<(&[u16], usize)> {
    if let Some((_, after_integer)) = match_digits(text, from) {
        let mut index = after_integer;
        if text.get(index) == Some(&DOT)
            && let Some((_, after_fraction)) = match_digits(text, index + 1)
        {
            index = after_fraction;
        }
        return Some((&text[from..index], index));
    }
    // 只有 `.5` 这种形态：小数点后必须有数字。
    if text.get(from) == Some(&DOT)
        && let Some((_, after_fraction)) = match_digits(text, from + 1)
    {
        return Some((&text[from..after_fraction], after_fraction));
    }
    None
}

/// JS `Number(text)`，只用在纯数字片段上。
fn parse_number(units: &[u16]) -> f64 {
    let text: String = units
        .iter()
        .map(|char| char::from_u32(u32::from(*char)).unwrap_or('?'))
        .collect();
    text.parse::<f64>().unwrap_or(f64::NAN)
}
