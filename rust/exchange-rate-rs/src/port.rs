//! The Rust port of `src/core/exchange-rate.js`（`exchangeRateInfo` 一个导出；`fetchExchangeRate`
//! 走 fetch + AbortSignal，留在 JS）。
//!
//! 与源码逐条对应：`positiveRate`、`||` 的 falsy 回落、`Date.parse(date + "T00:00:00Z")` 的
//! 比较都是 JS 语义，不是 Rust 语义，下面每处都注明对应哪一行。

#![forbid(unsafe_code)]

use serde_json::{Map, Value};

/// `src/shared/schema.js:10` 的 `DEFAULT_EXCHANGE_RATE`。由 `test/rust-exchange-rate-parity.test.js`
/// 与 JS 侧对照，任一边改动都会红。
const DEFAULT_EXCHANGE_RATE: f64 = 7.3;
const DAY_MS: f64 = 86_400_000.0;

/// Port of `exchangeRateInfo` (`src/core/exchange-rate.js:48`).
pub fn exchange_rate_info(settings: Value, references: Value, now: Value) -> Result<Value, String> {
    // 源码里 `settings = {}` 的默认值只对 `undefined` 生效；显式传 `null` 时第一处属性访问就抛。
    let settings = bag(settings, "exchangeRateMode")?;
    if settings.get("exchangeRateMode").and_then(Value::as_str) == Some("manual")
        && let Some(rate) = settings.get("exchangeRate").and_then(positive_rate)
    {
        return Ok(report(rate, "manual", "手动指定", "", ""));
    }

    // 手动档已经在这里返回，`references` 的属性访问到这一行才发生，所以 null 也在这一行才抛。
    let references = bag(references, "exchangeRate")?;
    let rate = references.get("exchangeRate").and_then(positive_rate);
    let source = match string_field(&references, "exchangeRateSource") {
        Some(text) if !text.is_empty() => text,
        _ => "历史缓存（来源未记录）".to_string(),
    };
    let date = string_field(&references, "exchangeRateDate").unwrap_or_default();
    let rate_warning = first_rate_warning(&references)?;

    let Some(rate) = rate else {
        return Ok(report(
            DEFAULT_EXCHANGE_RATE,
            "fallback",
            "应急估算",
            "",
            "尚无可用参考汇率，暂用估算值，请刷新或手动指定",
        ));
    };

    let now_ms = now_ms(&now);
    let stale = date.is_empty()
        || !is_truthy(references.get("exchangeRateFetchedAt"))
        || now_ms.is_some_and(|now| {
            let fetched = js_number(references.get("exchangeRateFetchedAt")).unwrap_or(f64::NAN);
            now - fetched > 2.0 * DAY_MS
        })
        || match (now_ms, parse_iso_date_utc(&date)) {
            (Some(now), Some(day_start)) => now - day_start > 7.0 * DAY_MS,
            _ => false,
        };

    let warning = if !rate_warning.is_empty() {
        rate_warning
    } else if stale {
        "汇率缓存待更新，当前沿用上次成功值".to_string()
    } else {
        String::new()
    };
    Ok(report(rate, "auto", &source, &date, &warning))
}

fn report(rate: f64, mode: &str, source: &str, date: &str, warning: &str) -> Value {
    let mut out = Map::new();
    out.insert("rate".to_string(), Value::from(rate));
    out.insert("mode".to_string(), Value::from(mode));
    out.insert("source".to_string(), Value::from(source));
    out.insert("date".to_string(), Value::from(date));
    out.insert("warning".to_string(), Value::from(warning));
    Value::Object(out)
}

/// 一个「可以取属性」的袋子：`undefined`（默认参数生效）和非对象的原始值取属性都得 `undefined`，
/// 只有 `null` 会在源码里抛 TypeError，报的正是它第一处读的那个键。
fn bag(value: Value, first_key: &str) -> Result<Map<String, Value>, String> {
    match value {
        Value::Object(map) => Ok(map),
        Value::Null => Err(format!(
            "TypeError: Cannot read properties of null (reading '{first_key}')"
        )),
        _ => Ok(Map::new()),
    }
}

/// `positiveRate`：`typeof value === "number" && Number.isFinite(value) && value > 0`。字符串 `"7.3"`
/// 在源码里不算数，这里也不算。
fn positive_rate(value: &Value) -> Option<f64> {
    value
        .as_f64()
        .filter(|rate| rate.is_finite() && *rate > 0.0)
}

fn string_field(map: &Map<String, Value>, key: &str) -> Option<String> {
    match map.get(key)? {
        Value::String(text) => Some(text.clone()),
        _ => None,
    }
}

/// `references.warnings` 里的第一条 `startsWith("汇率")`。`warnings` 不是数组时源码抛 TypeError。
fn first_rate_warning(references: &Map<String, Value>) -> Result<String, String> {
    let warnings = match references.get("warnings") {
        None | Some(Value::Null) => return Ok(String::new()),
        Some(Value::Array(items)) => items,
        Some(_) => return Err("TypeError: references.warnings.find is not a function".to_string()),
    };
    for item in warnings {
        if let Some(text) = item.as_str()
            && text.starts_with("汇率")
        {
            return Ok(text.to_string());
        }
    }
    Ok(String::new())
}

/// JS 的 `!value`：`0`、`""`、`null`、`undefined`、`false`、`NaN` 都是 falsy。
fn is_truthy(value: Option<&Value>) -> bool {
    match value {
        None | Some(Value::Null) => false,
        Some(Value::Bool(flag)) => *flag,
        Some(Value::String(text)) => !text.is_empty(),
        Some(Value::Number(_)) => {
            js_number(value).is_some_and(|number| number != 0.0 && !number.is_nan())
        }
        Some(Value::Array(_)) | Some(Value::Object(_)) => true,
    }
}

/// JS 的数字强制转换；`undefined`/`null` 在减法里分别是 `NaN`/`0`，这里由调用点决定。
fn js_number(value: Option<&Value>) -> Option<f64> {
    match value? {
        Value::Number(number) => number.as_f64(),
        Value::Bool(flag) => Some(if *flag { 1.0 } else { 0.0 }),
        Value::String(text) => {
            let trimmed = text.trim();
            if trimmed.is_empty() {
                Some(0.0)
            } else {
                trimmed.parse::<f64>().ok()
            }
        }
        _ => None,
    }
}

/// `now = Date.now()`：省略或传 `undefined` 时取当前时间，其余按 JS 的数值规则读。
fn now_ms(now: &Value) -> Option<f64> {
    // 默认参数只对 undefined 生效；显式 null 参与减法时按 0 算，不是「取当前时间」。
    if crate::js::is_undefined(now) {
        return Some(system_now_ms());
    }
    js_number(Some(now))
}

fn system_now_ms() -> f64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0.0, |elapsed| elapsed.as_millis() as f64)
}

/// `Date.parse(date + "T00:00:00Z")`：只有 `YYYY-MM-DD` 能解析出这一天的 UTC 零点。
fn parse_iso_date_utc(date: &str) -> Option<f64> {
    let bytes = date.as_bytes();
    if bytes.len() != 10 || bytes[4] != b'-' || bytes[7] != b'-' {
        return None;
    }
    let year: i64 = date.get(0..4)?.parse().ok()?;
    let month: i64 = date.get(5..7)?.parse().ok()?;
    let day: i64 = date.get(8..10)?.parse().ok()?;
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return None;
    }
    let days = days_from_civil(year, month, day);
    Some(days as f64 * DAY_MS)
}

/// Howard Hinnant 的 days_from_civil：公历日期到 1970-01-01 的天数。
fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let year = if month <= 2 { year - 1 } else { year };
    let era = if year >= 0 { year } else { year - 399 } / 400;
    let year_of_era = year - era * 400;
    let day_of_year = (153 * (if month > 2 { month - 3 } else { month + 9 }) + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    era * 146_097 + day_of_era - 719_468
}
