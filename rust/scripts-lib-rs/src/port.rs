//! The Rust port of `scripts/lib/`.
//!
//! Replace each `unimplemented!` with the port of the source function. Return `Err` where
//! the source throws or raises: the caller gets an error there too. After changing a
//! signature, run `rust-anything refresh` to regenerate the bindings. `rust-anything diff` checks
//! behavior against what the source recorded.

#![forbid(unsafe_code)]

use regex::Regex;
use serde_json::{Value, json};
use std::sync::LazyLock;

static VERSION_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$")
        .expect("valid version pattern")
});

static NUMERIC_IDENTIFIER: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^\d+$").expect("valid numeric pattern"));

const MISSING_MIN_SHELL: &str = "缺少 updateMinShell：在 package.json 里写 \"updateMinShell\"（自更新协议的最低兼容版本），或用 --min-shell 显式传值";
const MIN_SHELL_ABOVE_VERSION: &str =
    "updateMinShell {source} 高于本版版本 {target}，没有哪一版能自更新到它";
const MIN_SHELL_EQUALS_VERSION: &str =
    "updateMinShell 等于本版版本 {target}：只有装这一版的人能自更新，更旧的版本只能手动下载";
const CLI_OVERRIDES: &str = "--min-shell {cli} 覆盖了 package.json 的 updateMinShell {field}";

fn fill(template: &str, parts: &[(&str, &str)]) -> String {
    let mut out = template.to_string();
    for (key, value) in parts {
        out = out.replace(&format!("{{{key}}}"), value);
    }
    out
}

/// Port of `resolveMinShell` (`scripts/lib/update-version.mjs:18`).
pub fn resolve_min_shell(arg0: Value) -> Result<Value, String> {
    let cli_value = defined(member(&arg0, "cliValue"));
    let package_json = defined(member(&arg0, "packageJson"));
    let version = defined(member(&arg0, "version"));

    let target = normalize(version.as_ref());
    if parse_version(&target).is_none() {
        let shown = if target.is_empty() { "(空)" } else { &target };
        return Err(format!("版本号不是语义化版本：{shown}"));
    }

    let from_cli = normalize(cli_value.as_ref());
    let from_package = normalize(defined(field(&package_json, "updateMinShell")).as_ref());
    let source = if from_cli.is_empty() {
        from_package.clone()
    } else {
        from_cli.clone()
    };

    if source.is_empty() {
        return Err(MISSING_MIN_SHELL.to_string());
    }
    if parse_version(&source).is_none() {
        return Err(format!("updateMinShell 不是语义化版本：{source}"));
    }
    let order = compare_versions(&source, &target);
    if order == Some(1) {
        return Err(fill(
            MIN_SHELL_ABOVE_VERSION,
            &[("source", &source), ("target", &target)],
        ));
    }

    let mut warnings: Vec<String> = Vec::new();
    if order == Some(0) {
        warnings.push(fill(MIN_SHELL_EQUALS_VERSION, &[("target", &target)]));
    }
    if !from_cli.is_empty() && !from_package.is_empty() && from_cli != from_package {
        warnings.push(fill(
            CLI_OVERRIDES,
            &[("cli", &from_cli), ("field", &from_package)],
        ));
    }

    Ok(json!({ "minShell": source, "warnings": warnings }))
}

/// Semver as `parseVersion` reads it: `major.minor.patch` with optional prerelease and build.
#[derive(Debug)]
struct Version {
    numbers: [f64; 3],
    prerelease: Vec<String>,
}

fn parse_version(value: &str) -> Option<Version> {
    let text = normalize_str(value);
    let captures = VERSION_RE.captures(&text)?;
    let number = |index: usize| {
        captures
            .get(index)
            .and_then(|group| group.as_str().parse::<f64>().ok())
            .unwrap_or(f64::NAN)
    };
    let prerelease = captures
        .get(4)
        .map(|group| group.as_str().split('.').map(str::to_string).collect())
        .unwrap_or_default();
    Some(Version {
        numbers: [number(1), number(2), number(3)],
        prerelease,
    })
}

fn compare_versions(left: &str, right: &str) -> Option<i32> {
    let a = parse_version(left)?;
    let b = parse_version(right)?;
    for index in 0..3 {
        if a.numbers[index] != b.numbers[index] {
            return Some(if a.numbers[index] < b.numbers[index] {
                -1
            } else {
                1
            });
        }
    }
    if a.prerelease.is_empty() && b.prerelease.is_empty() {
        return Some(0);
    }
    if a.prerelease.is_empty() {
        return Some(1);
    }
    if b.prerelease.is_empty() {
        return Some(-1);
    }
    Some(compare_prerelease(&a.prerelease, &b.prerelease))
}

fn compare_prerelease(left: &[String], right: &[String]) -> i32 {
    for index in 0..left.len().max(right.len()) {
        let (Some(a), Some(b)) = (left.get(index), right.get(index)) else {
            return if left.get(index).is_none() { -1 } else { 1 };
        };
        let a_numeric = NUMERIC_IDENTIFIER.is_match(a);
        let b_numeric = NUMERIC_IDENTIFIER.is_match(b);
        if a_numeric && b_numeric {
            let diff = a.parse::<f64>().unwrap_or(f64::NAN) - b.parse::<f64>().unwrap_or(f64::NAN);
            if diff != 0.0 {
                return if diff < 0.0 { -1 } else { 1 };
            }
            continue;
        }
        if a_numeric {
            return -1;
        }
        if b_numeric {
            return 1;
        }
        if a == b {
            continue;
        }
        return if a < b { -1 } else { 1 };
    }
    0
}

fn member(value: &Value, key: &str) -> Option<Value> {
    match value {
        Value::Object(map) => map.get(key).cloned(),
        _ => None,
    }
}
/// `value?.key`: a property of an object, or nothing when the value is missing or not an object.
fn field(value: &Option<Value>, key: &str) -> Option<Value> {
    value.as_ref().and_then(|item| member(item, key))
}

/// Drops `undefined`, so `?? ""` in the source sees a missing value.
fn defined(value: Option<Value>) -> Option<Value> {
    value.filter(|item| !crate::js::is_undefined(item))
}

fn normalize(value: Option<&Value>) -> String {
    normalize_str(&normalize_text(value))
}

/// `String(value ?? "")`: null and undefined become empty, everything else prints as JS prints it.
fn normalize_text(value: Option<&Value>) -> String {
    match value {
        None | Some(Value::Null) => String::new(),
        Some(item) if crate::js::is_undefined(item) => String::new(),
        Some(item) => js_string(item),
    }
}

/// `.trim().replace(/^v/i, "")`
fn normalize_str(text: &str) -> String {
    let trimmed = text.trim_matches(is_js_space);
    match trimmed.chars().next() {
        Some('v') | Some('V') => trimmed[1..].to_string(),
        _ => trimmed.to_string(),
    }
}

fn is_js_space(ch: char) -> bool {
    matches!(ch,
        '\u{9}'..='\u{d}'
        | '\u{20}'
        | '\u{a0}'
        | '\u{1680}'
        | '\u{2000}'..='\u{200a}'
        | '\u{2028}'
        | '\u{2029}'
        | '\u{202f}'
        | '\u{205f}'
        | '\u{3000}'
        | '\u{feff}')
}

fn js_string(value: &Value) -> String {
    match value {
        Value::Null => "null".to_string(),
        Value::Bool(flag) => flag.to_string(),
        Value::Number(number) => number_to_string(number.as_f64().unwrap_or(f64::NAN)),
        Value::String(text) => text.clone(),
        Value::Array(items) => items
            .iter()
            .map(|item| match item {
                Value::Null => String::new(),
                other if crate::js::is_undefined(other) => String::new(),
                other => js_string(other),
            })
            .collect::<Vec<_>>()
            .join(","),
        Value::Object(_) => "[object Object]".to_string(),
    }
}

/// JS `Number.prototype.toString()`, as `${n}` prints it.
fn number_to_string(x: f64) -> String {
    if x.is_nan() {
        return "NaN".into();
    }
    if x.is_infinite() {
        return if x > 0.0 { "Infinity" } else { "-Infinity" }.into();
    }
    if x == 0.0 {
        return "0".into();
    }
    if x.fract() == 0.0 && x.abs() < 9007199254740992.0 {
        return (x as i64).to_string();
    }
    let json = serde_json::to_string(&x).unwrap_or_default();
    let (sign, json) = match json.strip_prefix('-') {
        Some(rest) => ("-", rest),
        None => ("", json.as_str()),
    };
    let (mantissa, exponent) = match json.find(['e', 'E']) {
        Some(index) => (
            &json[..index],
            json[index + 1..].parse::<i64>().unwrap_or(0),
        ),
        None => (json, 0),
    };
    let (int, frac) = mantissa.split_once('.').unwrap_or((mantissa, ""));
    let all = format!("{int}{frac}");
    let lead = all.len() - all.trim_start_matches('0').len();
    let digits = all[lead..].trim_end_matches('0');
    let k = digits.len() as i64;
    let n = int.len() as i64 - lead as i64 + exponent;
    let mut out = String::with_capacity(digits.len() + 8);
    out.push_str(sign);
    if k <= n && n <= 21 {
        out.push_str(digits);
        out.extend(std::iter::repeat_n('0', (n - k) as usize));
    } else if 0 < n && n <= 21 {
        out.push_str(&digits[..n as usize]);
        out.push('.');
        out.push_str(&digits[n as usize..]);
    } else if -6 < n && n <= 0 {
        out.push_str("0.");
        out.extend(std::iter::repeat_n('0', (-n) as usize));
        out.push_str(digits);
    } else {
        let e = n - 1;
        out.push_str(&digits[..1]);
        if k > 1 {
            out.push('.');
            out.push_str(&digits[1..]);
        }
        out.push('e');
        out.push(if e < 0 { '-' } else { '+' });
        out.push_str(&e.abs().to_string());
    }
    out
}
