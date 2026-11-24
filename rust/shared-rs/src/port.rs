//! The Rust port of `src/shared/`.
//!
//! Replace each `unimplemented!` with the port of the source function. Return `Err` where
//! the source throws or raises: the caller gets an error there too. After changing a
//! signature, run `rust-anything refresh` to regenerate the bindings. `rust-anything diff` checks
//! behavior against what the source recorded.

#![forbid(unsafe_code)]

use regex::Regex;
use serde_json::{Map, Value, json};
use std::sync::LazyLock;

/// Logo tables, provider aliases and the default station, lifted out of the JavaScript sources by
/// `out/gen-shared-data.mjs`, so the port reads the same data the original does.
static DATA_JSON: &str = include_str!("data.json");

static DATA: LazyLock<Value> =
    LazyLock::new(|| serde_json::from_str(DATA_JSON).expect("bundled data parses"));

/// Matches JavaScript's `\s`: Rust's `\s` also takes U+0085 and drops U+FEFF.
const JS_SPACE: &str = "[\\t\\n\\x{0B}\\x{0C}\\r \\x{A0}\\x{1680}\\x{2000}-\\x{200A}\\x{2028}\\x{2029}\\x{202F}\\x{205F}\\x{3000}\\x{FEFF}]";

static SPACES_RUN: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(&format!("{JS_SPACE}+")).expect("valid space pattern"));

static LEADING_TILDES: LazyLock<Regex> =
    LazyLock::new(|| Regex::new("^~+").expect("valid tilde pattern"));

static NON_INITIALS: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new("[^A-Za-z0-9\\x{4E00}-\\x{9FA5}]").expect("valid initials pattern")
});

static LEADING_ALNUM: LazyLock<Regex> =
    LazyLock::new(|| Regex::new("^[A-Za-z0-9]+").expect("valid alnum pattern"));

static NAME_HINTS: LazyLock<Vec<(Regex, String)>> = LazyLock::new(|| {
    let Some(items) = DATA.get("nameHints").and_then(Value::as_array) else {
        return Vec::new();
    };
    items
        .iter()
        .filter_map(|item| {
            let source = item.get("source")?.as_str()?;
            let slug = item.get("slug")?.as_str()?.to_string();
            let flags = item.get("flags").and_then(Value::as_str).unwrap_or("");
            let pattern = if flags.contains('i') {
                format!("(?i){source}")
            } else {
                source.to_string()
            };
            Regex::new(&pattern).ok().map(|re| (re, slug))
        })
        .collect()
});

const MODEL_DECORATIONS: [&str; 6] = [
    r":(?:free|thinking|official|fast|online|extended|beta|none|auto|batch)$",
    r":peft:\d+$",
    r"@(?:eu|us|global|jp|au|in|cn|default|\d+)$",
    r"-v\d+(?::\d+)?$",
    r"-(?:19|20)\d{2}(?:0\d|1[0-2])?(?:[0-3]\d)?$",
    r"-(?:flare|sunburst)$",
];

static DECORATION_PATTERNS: LazyLock<Vec<Regex>> = LazyLock::new(|| {
    MODEL_DECORATIONS
        .iter()
        .map(|pattern| Regex::new(pattern).expect("valid decoration pattern"))
        .collect()
});

const TOKENS_PER_MILLION: f64 = 1_000_000.0;
const DEFAULT_EXCHANGE_RATE: f64 = 7.3;
const USAGE_DISPLAY_DIGITS: f64 = 1e4;

const USAGE_MATCH_FIELDS: [&str; 6] = [
    "requests",
    "input",
    "cacheRead",
    "cacheWrite",
    "cacheWrite1h",
    "output",
];

const PAYMENT_CHANNELS: [&str; 6] = ["wechat", "alipay", "card", "stripe", "crypto", "other"];
const PAYMENT_CURRENCIES: [&str; 3] = ["CNY", "USD", "CREDITS"];
const PLAN_CURRENCIES: [&str; 3] = ["CNY", "USD", "CREDITS"];
const PAYMENT_STATUSES: [&str; 5] = ["pending", "paid", "expired", "cancelled", "failed"];
const PLAN_KINDS: [&str; 4] = ["topup", "subscription", "carpool", "manual"];
const PLAN_AVAILABILITIES: [&str; 3] = ["self_service", "manual", "unknown"];
const BILLING_PROFILE_SOURCES: [&str; 3] = ["auto", "measured", "manual"];
const LOCAL_HTTP_HOSTS: [&str; 4] = ["localhost", "127.0.0.1", "::1", "[::1]"];
const ICON_FALLBACK: &str = "circle-help";

/// Built-in 30-day snapshot, used until a magpie sync replaces it.
const BUILTIN_30D_MONTHLY_VOLUME: [f64; 6] = [
    54378.0,
    326.81 * TOKENS_PER_MILLION,
    4434.31 * TOKENS_PER_MILLION,
    28.98 * TOKENS_PER_MILLION,
    1.91 * TOKENS_PER_MILLION,
    0.0,
];

// 与 src/shared/schema.js 里 BUILTIN_30D_MONTHLY_VOLUME 的键序一致，输出才和原来同序。
const USAGE_KEYS: [&str; 6] = [
    "requests",
    "input",
    "cacheRead",
    "output",
    "cacheWrite",
    "cacheWrite1h",
];

const BASELINE_USAGE: [f64; 6] = [0.0, 30.0 * TOKENS_PER_MILLION, 0.0, 6_000_000.0, 0.0, 0.0];

/// Port of `redactStation` (`src/shared/db.js:182`).
pub fn redact_station(station: Value) -> Result<Value, String> {
    let station = if is_undefined(&station) {
        json!({})
    } else if station.is_null() {
        return Err("Cannot read properties of null (reading 'auth')".to_string());
    } else {
        station
    };
    let auth = member(&station, "auth").unwrap_or_else(|| json!({}));
    let auth_type = match member(&auth, "type") {
        Some(item) if truthy(&item) => js_str(&item),
        _ => "none".to_string(),
    };
    let mut out = Map::new();
    for (key, value) in own_enumerable(&station) {
        if key != "auth" {
            out.insert(key, value);
        }
    }
    out.insert("auth".to_string(), json!({ "type": auth_type }));
    Ok(Value::Object(out))
}

/// Port of `stripModelDecoration` (`src/shared/model-name.js:11`).
pub fn strip_model_decoration(value: Value) -> Result<Value, String> {
    let mut current = js_str(&or_empty(&value))
        .to_lowercase()
        .trim_matches(is_js_space)
        .to_string();
    for _ in 0..3 {
        let before = current.clone();
        for pattern in DECORATION_PATTERNS.iter() {
            current = pattern.replace_all(&current, "").into_owned();
        }
        if current == before {
            break;
        }
    }
    Ok(Value::String(current))
}

/// Port of `bareModelSpelling` (`src/shared/model-name.js:21`).
pub fn bare_model_spelling(id: Value) -> Result<Value, String> {
    let text = js_str(&or_empty(&id)).to_lowercase();
    let trimmed = text.trim_matches(is_js_space);
    let last = trimmed
        .split('/')
        .rfind(|segment| !segment.is_empty())
        .unwrap_or("")
        .to_string();
    strip_model_decoration(Value::String(last))
}

/// Port of `canonicalModelKey` (`src/shared/model-name.js:26`).
pub fn canonical_model_key(value: Value) -> Result<Value, String> {
    let text = js_str(&or_empty(&value))
        .trim_matches(is_js_space)
        .to_string();
    let base = strip_leading_brackets(&text);
    let spelling = bare_model_spelling(Value::String(base))?;
    let spelling = js_str(&spelling);
    let mut key = String::with_capacity(spelling.len());
    for ch in spelling.chars() {
        match ch {
            ' ' | '\t' | '\n' | '\r' | '.' | '_' => key.push('-'),
            _ => key.push(ch),
        }
    }
    let key = collapse_hyphens(&key);
    Ok(Value::String(key.trim_matches('-').to_string()))
}

/// Port of `effectiveMonthlyCost` (`src/shared/monthly-cost.js:2`).
pub fn effective_monthly_cost(row: Value) -> Result<Value, String> {
    if let Some(paid) = member(&row, "monthlyCostPaid")
        && is_finite_number(&paid)
    {
        return Ok(paid);
    }
    Ok(member(&row, "monthlyCost").unwrap_or_else(undefined))
}

/// Port of `providerLogoSlug` (`src/shared/provider-icons.js:100`).
pub fn provider_logo_slug(value: Value) -> Result<Value, String> {
    let key = normalize_slug(&js_str(&or_empty(&value)));
    if key.is_empty() {
        return Ok(Value::String(String::new()));
    }
    if let Some(alias) = table("aliases").get(&key) {
        return Ok(alias.clone());
    }
    if table("providerLogos").get(&key).is_some() {
        return Ok(Value::String(key));
    }
    let haystack = js_str(&or_empty(&value));
    for (pattern, slug) in NAME_HINTS.iter() {
        if pattern.is_match(&haystack) {
            return Ok(Value::String(slug.clone()));
        }
    }
    Ok(Value::String(String::new()))
}

/// Port of `providerLogoFor` (`src/shared/provider-icons.js:111`).
pub fn provider_logo_for(values: Value) -> Result<Value, String> {
    for value in concat(&values) {
        let slug = provider_logo_slug(value)?;
        let slug = js_str(&slug);
        if !slug.is_empty() && table("providerLogos").get(&slug).is_some() {
            return Ok(Value::String(slug));
        }
    }
    Ok(Value::String(String::new()))
}

/// Port of `providerIconMarkup` (`src/shared/provider-icons.js:131`).
pub fn provider_icon_markup(values: Value, arg1: Value) -> Result<Value, String> {
    let options = options_argument(arg1, "size")?;
    let size = match member(&options, "size") {
        Some(value) if truthy(&value) => js_str(&value),
        _ => "17".to_string(),
    };
    let label = match member(&options, "label") {
        Some(item) if truthy(&item) => js_str(&item),
        _ => String::new(),
    };
    let list = concat(&values);
    let slug = js_str(&provider_logo_for(Value::Array(list.clone()))?);
    let logo = if slug.is_empty() {
        Value::Null
    } else {
        table("providerLogos")
            .get(&slug)
            .cloned()
            .unwrap_or(Value::Null)
    };
    if !truthy(&logo) {
        let source = list
            .iter()
            .find(|item| !js_str(&or_empty(item)).trim_matches(is_js_space).is_empty())
            .cloned()
            .unwrap_or_else(|| json!(""));
        let initials = escape_attr(&fallback_initials(&js_str(&or_empty(&source))));
        return Ok(Value::String(format!(
            "<span class=\"model-logo is-neutral\" aria-hidden=\"true\"><span>{initials}</span></span>"
        )));
    }
    let title = escape_attr(&if label.is_empty() {
        js_str(&member(&logo, "title").unwrap_or_else(undefined))
    } else {
        label
    });
    let hex = member(&logo, "hex").unwrap_or(Value::Null);
    let style = if truthy(&hex) {
        format!(" style=\"--brand:{}\"", js_str(&hex))
    } else {
        String::new()
    };
    let paths = match member(&logo, "paths").and_then(|item| item.as_array().cloned()) {
        Some(items) => items
            .iter()
            .map(|item| format!("<path d=\"{}\"></path>", js_str(item)))
            .collect::<Vec<_>>()
            .join(""),
        None => String::new(),
    };
    let view_box = js_str(&member(&logo, "viewBox").unwrap_or_else(undefined));
    Ok(Value::String(format!(
        "<span class=\"model-logo\"{style} title=\"{title}\" aria-hidden=\"true\"><svg viewBox=\"{view_box}\" width=\"{size}\" height=\"{size}\" fill=\"currentColor\" aria-hidden=\"true\">{paths}</svg></span>"
    )))
}

/// Port of `normalizeRechargePayments` (`src/shared/recharge-payments.js:7`).
pub fn normalize_recharge_payments(input: Value) -> Result<Value, String> {
    let Some(items) = input.as_array() else {
        return Ok(json!([]));
    };
    let mut seen: Vec<String> = Vec::new();
    let mut payments: Vec<Value> = Vec::new();
    for raw in items {
        if !is_plain_object(raw) {
            continue;
        }
        let face_amount = js_num(&member(raw, "faceAmount").unwrap_or_else(undefined));
        if !face_amount.is_finite() || face_amount <= 0.0 {
            continue;
        }
        let pay_amount = js_num(&member(raw, "payAmount").unwrap_or_else(undefined));
        if !pay_amount.is_finite() || pay_amount <= 0.0 {
            continue;
        }
        let channel_raw = js_str(&or_empty(&member(raw, "channel").unwrap_or_else(undefined)))
            .trim_matches(is_js_space)
            .to_lowercase();
        if !PAYMENT_CHANNELS.contains(&channel_raw.as_str()) {
            continue;
        }
        let currency_raw = js_str(&or_empty(
            &member(raw, "currency").unwrap_or_else(undefined),
        ))
        .trim_matches(is_js_space)
        .to_uppercase();
        let status_raw = js_str(&or_empty(&member(raw, "status").unwrap_or_else(undefined)))
            .trim_matches(is_js_space)
            .to_lowercase();
        if !status_raw.is_empty() && !PAYMENT_STATUSES.contains(&status_raw.as_str()) {
            continue;
        }
        if !PAYMENT_CURRENCIES.contains(&currency_raw.as_str()) {
            continue;
        }
        let explicit = js_num(&member(raw, "paidRmb").unwrap_or_else(undefined));
        let paid_rmb: Option<f64> = if !status_raw.is_empty() && status_raw != "paid" {
            None
        } else if explicit.is_finite() && explicit > 0.0 {
            Some(explicit)
        } else if currency_raw == "CNY" {
            Some(pay_amount)
        } else {
            None
        };
        let key = format!("{channel_raw}:{}:{currency_raw}", to_fixed(face_amount, 6));
        if seen.contains(&key) {
            continue;
        }
        seen.push(key);
        let fee_rate = js_num(&member(raw, "feeRate").unwrap_or_else(undefined));
        let at = slice_utf16(
            js_str(&or_empty(&member(raw, "at").unwrap_or_else(undefined)))
                .trim_matches(is_js_space),
            0,
            32,
        );
        let note = slice_utf16(
            js_str(&or_empty(&member(raw, "note").unwrap_or_else(undefined)))
                .trim_matches(is_js_space),
            0,
            240,
        );
        let mut payment = Map::new();
        payment.insert("channel".to_string(), json!(channel_raw));
        payment.insert("faceAmount".to_string(), number_value(face_amount));
        payment.insert("payAmount".to_string(), number_value(pay_amount));
        payment.insert("currency".to_string(), json!(currency_raw));
        payment.insert(
            "paidRmb".to_string(),
            match paid_rmb {
                Some(value) => number_value(crate::js::math_round(value * 100.0) / 100.0),
                None => Value::Null,
            },
        );
        if !status_raw.is_empty() {
            payment.insert("status".to_string(), json!(status_raw));
        }
        if fee_rate.is_finite() && (0.0..1.0).contains(&fee_rate) {
            payment.insert("feeRate".to_string(), number_value(fee_rate));
        }
        if !at.is_empty() {
            payment.insert("at".to_string(), json!(at));
        }
        if !note.is_empty() {
            payment.insert("note".to_string(), json!(note));
        }
        payments.push(Value::Object(payment));
    }
    payments.sort_by(|left, right| {
        let left_channel = js_str(&member(left, "channel").unwrap_or_else(undefined));
        let right_channel = js_str(&member(right, "channel").unwrap_or_else(undefined));
        left_channel.cmp(&right_channel).then_with(|| {
            js_num(&member(left, "faceAmount").unwrap_or_else(undefined))
                .partial_cmp(&js_num(
                    &member(right, "faceAmount").unwrap_or_else(undefined),
                ))
                .unwrap_or(std::cmp::Ordering::Equal)
        })
    });
    Ok(Value::Array(payments))
}

/// Port of `rechargePaymentRate` (`src/shared/recharge-payments.js:52`).
pub fn recharge_payment_rate(payment: Value) -> Result<Value, String> {
    let face_amount = js_num(&member(&payment, "faceAmount").unwrap_or_else(undefined));
    let status = js_str(&or_empty(
        &member(&payment, "status").unwrap_or_else(undefined),
    ))
    .trim_matches(is_js_space)
    .to_lowercase();
    if !status.is_empty() && status != "paid" {
        return Ok(Value::Null);
    }
    let paid_rmb = js_num(&member(&payment, "paidRmb").unwrap_or_else(undefined));
    if !face_amount.is_finite() || face_amount <= 0.0 {
        return Ok(Value::Null);
    }
    if !paid_rmb.is_finite() || paid_rmb <= 0.0 {
        return Ok(Value::Null);
    }
    Ok(number_value(paid_rmb / face_amount))
}

/// Port of `cheapestRechargePayment` (`src/shared/recharge-payments.js:63`).
pub fn cheapest_recharge_payment(payments: Value) -> Result<Value, String> {
    let Some(items) = payments.as_array() else {
        return Ok(Value::Null);
    };
    let mut best = Value::Null;
    let mut best_rate = f64::INFINITY;
    for payment in items {
        let rate = recharge_payment_rate(payment.clone())?;
        if rate.is_null() {
            continue;
        }
        let rate = js_num(&rate);
        if rate >= best_rate {
            continue;
        }
        best = payment.clone();
        best_rate = rate;
    }
    Ok(best)
}

/// Port of `representativeRechargePayment` (`src/shared/recharge-payments.js:80`).
pub fn representative_recharge_payment(
    payments: Value,
    face_spend: Option<Value>,
) -> Result<Value, String> {
    let Some(items) = payments.as_array() else {
        return Ok(Value::Null);
    };
    let spend = js_num(&face_spend.unwrap_or_else(undefined));
    let payable = if spend > 0.0 {
        payable_at_spend(items, spend)?
    } else {
        cheapest_recharge_payment(Value::Array(items.clone()))?
    };
    if truthy(&payable) {
        return Ok(payable);
    }
    let mut best = Value::Null;
    for payment in items {
        let face = js_num(&member(payment, "faceAmount").unwrap_or_else(undefined));
        let best_face = js_num(&member(&best, "faceAmount").unwrap_or_else(undefined));
        if !truthy(&best) || face > best_face {
            best = payment.clone();
        }
    }
    Ok(best)
}

fn payable_at_spend(items: &[Value], spend: f64) -> Result<Value, String> {
    let mut payable: Vec<Value> = Vec::new();
    for payment in items {
        if !recharge_payment_rate(payment.clone())?.is_null() {
            payable.push(payment.clone());
        }
    }
    if payable.is_empty() {
        return Ok(Value::Null);
    }
    let faces: Vec<f64> = payable
        .iter()
        .map(|payment| js_num(&member(payment, "faceAmount").unwrap_or_else(undefined)))
        .collect();
    let affordable: Vec<f64> = faces
        .iter()
        .copied()
        .filter(|face| *face <= spend)
        .collect();
    let target = if !affordable.is_empty() {
        affordable.iter().copied().fold(f64::NEG_INFINITY, f64::max)
    } else {
        faces.iter().copied().fold(f64::INFINITY, f64::min)
    };
    let target: Vec<Value> = payable
        .into_iter()
        .filter(|payment| {
            js_num(&member(payment, "faceAmount").unwrap_or_else(undefined)) == target
        })
        .collect();
    cheapest_recharge_payment(Value::Array(target))
}

/// Port of `normalizeRechargeTiers` (`src/shared/recharge-tiers.js:3`).
pub fn normalize_recharge_tiers(input: Value) -> Result<Value, String> {
    let Some(items) = input.as_array() else {
        return Ok(json!([]));
    };
    let mut seen: Vec<String> = Vec::new();
    let mut tiers: Vec<(f64, f64)> = Vec::new();
    for raw in items {
        let amount = js_num(&member(raw, "amount").unwrap_or_else(undefined));
        let discount = js_num(&member(raw, "discount").unwrap_or_else(undefined));
        if !amount.is_finite() || amount <= 0.0 {
            continue;
        }
        if !discount.is_finite() || discount <= 0.0 || discount > 1.0 {
            continue;
        }
        let key = to_fixed(amount, 6);
        if seen.contains(&key) {
            continue;
        }
        seen.push(key);
        tiers.push((amount, discount));
    }
    tiers.sort_by(|left, right| {
        left.0
            .partial_cmp(&right.0)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    Ok(Value::Array(
        tiers
            .into_iter()
            .map(|(amount, discount)| {
                json!({ "amount": number_value(amount), "discount": number_value(discount) })
            })
            .collect(),
    ))
}

/// Port of `normalizeRechargePlans` (`src/shared/recharge-tiers.js:26`).
pub fn normalize_recharge_plans(input: Value) -> Result<Value, String> {
    let Some(items) = input.as_array() else {
        return Ok(json!([]));
    };
    let mut plans: Vec<Value> = Vec::new();
    for raw in items {
        if !is_plain_object(raw) {
            continue;
        }
        let amount = js_num(&member(raw, "amount").unwrap_or_else(undefined));
        if !amount.is_finite() || amount <= 0.0 {
            continue;
        }
        let credits = js_num(&member(raw, "credits").unwrap_or_else(undefined));
        let raw_discount = member(raw, "discount").unwrap_or_else(undefined);
        let discount: Option<f64> = if is_undefined(&raw_discount)
            || raw_discount.is_null()
            || raw_discount.as_str() == Some("")
        {
            None
        } else {
            Some(js_num(&raw_discount))
        };
        if let Some(value) = discount
            && (!value.is_finite() || value <= 0.0 || value > 1.0)
        {
            continue;
        }
        let currency_source = js_str(&or_empty(
            &member(raw, "currency").unwrap_or_else(undefined),
        ))
        .trim_matches(is_js_space)
        .to_uppercase();
        let currency = if PLAN_CURRENCIES.contains(&currency_source.as_str()) {
            currency_source.clone()
        } else {
            "CNY".to_string()
        };
        let kind = match member(raw, "kind") {
            Some(item) => {
                let text = js_str(&item);
                if PLAN_KINDS.contains(&text.as_str()) {
                    text
                } else {
                    "topup".to_string()
                }
            }
            None => "topup".to_string(),
        };
        let availability = match member(raw, "availability") {
            Some(item) => {
                let text = js_str(&item);
                if PLAN_AVAILABILITIES.contains(&text.as_str()) {
                    text
                } else {
                    "unknown".to_string()
                }
            }
            None => "unknown".to_string(),
        };
        let period = slice_utf16(
            js_str(&or_empty(&member(raw, "period").unwrap_or_else(undefined)))
                .trim_matches(is_js_space),
            0,
            32,
        );
        let note = slice_utf16(
            js_str(&or_empty(&member(raw, "note").unwrap_or_else(undefined)))
                .trim_matches(is_js_space),
            0,
            240,
        );
        let mut plan = Map::new();
        plan.insert("kind".to_string(), json!(kind));
        plan.insert("amount".to_string(), number_value(amount));
        if credits.is_finite() && credits > 0.0 {
            plan.insert("credits".to_string(), number_value(credits));
        }
        if let Some(value) = discount {
            plan.insert("discount".to_string(), number_value(value));
        }
        plan.insert("currency".to_string(), json!(currency));
        plan.insert("availability".to_string(), json!(availability));
        if !period.is_empty() {
            plan.insert("period".to_string(), json!(period));
        }
        plan.insert(
            "recurring".to_string(),
            json!(is_true(&member(raw, "recurring"))),
        );
        plan.insert(
            "accumulates".to_string(),
            json!(is_true(&member(raw, "accumulates"))),
        );
        plan.insert(
            "verified".to_string(),
            json!(is_true(&member(raw, "verified"))),
        );
        if !note.is_empty() {
            plan.insert("note".to_string(), json!(note));
        }
        plans.push(Value::Object(plan));
    }
    Ok(Value::Array(plans))
}

/// Port of `convertRechargeAmount` (`src/shared/schema.js:12`).
pub fn convert_recharge_amount(
    amount: Value,
    from_currency: Value,
    to_currency: Value,
    exchange_rate: Option<Value>,
) -> Result<Value, String> {
    let value = js_num(&amount);
    if !value.is_finite() || value < 0.0 {
        return Ok(Value::Null);
    }
    let configured_rate = js_num(&exchange_rate.unwrap_or_else(undefined));
    let rate = if configured_rate.is_finite() && configured_rate > 0.0 {
        configured_rate
    } else {
        DEFAULT_EXCHANGE_RATE
    };
    let rmb = value
        * if js_str(&from_currency) == "USD" {
            rate
        } else {
            1.0
        };
    Ok(number_value(if js_str(&to_currency) == "USD" {
        rmb / rate
    } else {
        rmb
    }))
}

/// Port of `usagePresetUsage` (`src/shared/schema.js:37`).
pub fn usage_preset_usage(id: Value, magpie_sync: Option<Value>) -> Result<Value, String> {
    let id = js_str(&id);
    if id == "baseline" {
        let mut usage = usage_object(&BUILTIN_30D_MONTHLY_VOLUME);
        merge_usage(&mut usage, &BASELINE_USAGE);
        return Ok(Value::Object(usage));
    }
    if id != "recent30d" {
        return Ok(Value::Null);
    }
    let mut usage = usage_object(&BUILTIN_30D_MONTHLY_VOLUME);
    let sync = magpie_sync.unwrap_or(Value::Null);
    if let Some(measured) = member(&sync, "recent30d")
        .and_then(|item| member(&item, "usage"))
        .filter(truthy)
    {
        for (index, key) in USAGE_KEYS.iter().enumerate() {
            let _ = index;
            let value = js_num(&member(&measured, key).unwrap_or_else(undefined));
            if value.is_finite() {
                usage.insert(key.to_string(), number_value(value));
            }
        }
    }
    Ok(Value::Object(usage))
}

/// Port of `usagePresetOptions` (`src/shared/schema.js:43`).
pub fn usage_preset_options(magpie_sync: Option<Value>) -> Result<Value, String> {
    let sync = magpie_sync.unwrap_or(Value::Null);
    let stamp = |id: &str| -> String {
        let synced_at = js_num(
            &member(&sync, id)
                .and_then(|item| member(&item, "syncedAt"))
                .unwrap_or_else(undefined),
        );
        let synced_at = if synced_at == 0.0 || synced_at.is_nan() {
            0.0
        } else {
            synced_at
        };
        if synced_at == 0.0 {
            return "内置快照".to_string();
        }
        let (month, day) = local_month_day(synced_at);
        format!("{} 月 {} 日同步", month + 1, day)
    };
    Ok(json!([
        { "id": "recent30d", "label": format!("magpie-30天（{}）", stamp("recent30d")) },
        { "id": "baseline", "label": "基础估算（3000 万输入 / 600 万输出）" },
        { "id": "custom", "label": "自定义" },
    ]))
}

/// Port of `usagePresetId` (`src/shared/schema.js:86`).
pub fn usage_preset_id(usage: Value, magpie_sync: Option<Value>) -> Result<Value, String> {
    let recent = usage_preset_usage(json!("recent30d"), magpie_sync)?;
    if usage_matches_preset(&usage, &recent) {
        return Ok(json!("recent30d"));
    }
    let baseline = usage_object(&BASELINE_USAGE);
    if usage_matches_preset(&usage, &Value::Object(baseline)) {
        return Ok(json!("baseline"));
    }
    Ok(json!("custom"))
}

/// Port of `isSecureRemoteUrl` (`src/shared/schema.js:93`).
pub fn is_secure_remote_url(value: Value) -> Result<Value, String> {
    Ok(json!(is_secure(&js_str(&value))))
}

/// Port of `currentSiteOrigin` (`src/shared/schema.js:101`).
pub fn current_site_origin(value: Value) -> Result<Value, String> {
    let text = js_str(&or_empty(&value));
    if !is_secure(&text) {
        return Ok(json!(""));
    }
    match parse_url(&text) {
        Some(url) => Ok(json!(url_field(&url, "origin"))),
        None => Ok(json!("")),
    }
}

/// Port of `normalizeBillingProfile` (`src/shared/schema.js:115`).
pub fn normalize_billing_profile(input: Value) -> Result<Value, String> {
    let tokens_per_request = js_num(&member(&input, "tokensPerRequest").unwrap_or_else(undefined));
    if !tokens_per_request.is_finite() || tokens_per_request <= 0.0 {
        return Ok(json!({ "tokensPerRequest": 0, "source": "auto" }));
    }
    let source = match member(&input, "source") {
        Some(item) => {
            let text = js_str(&item);
            if BILLING_PROFILE_SOURCES.contains(&text.as_str()) {
                if text == "auto" {
                    "manual".to_string()
                } else {
                    text
                }
            } else {
                "manual".to_string()
            }
        }
        None => "manual".to_string(),
    };
    Ok(json!({ "tokensPerRequest": number_value(tokens_per_request), "source": source }))
}

/// Port of `cloneDefaultStation` (`src/shared/schema.js:206`).
pub fn clone_default_station() -> Result<Value, String> {
    Ok(table("defaultStation").clone())
}

/// Port of `normalizeUrl` (`src/shared/schema.js:286`).
pub fn normalize_url(value: Value) -> Result<Value, String> {
    let text = js_str(&or_empty(&value));
    if parse_url(&text).is_none() {
        return Err("TypeError: Invalid URL".to_string());
    }
    if !is_secure(&text) {
        return Err("Error: 远程地址必须使用 HTTPS；仅允许 localhost 使用 HTTP".to_string());
    }
    let Some(url) = parse_url(&text) else {
        return Err("TypeError: Invalid URL".to_string());
    };
    for field in ["hash", "search"] {
        let _ = js_sys::Reflect::set(&url, &JsValue::from_str(field), &JsValue::from_str(""));
    }
    let rendered = url_field(&url, "href");
    Ok(json!(rendered.strip_suffix('/').unwrap_or(&rendered)))
}

/// Port of `siteLogoUrl` (`src/shared/site-icon.js:16`).
pub fn site_logo_url(id: Value) -> Result<Value, String> {
    let file = js_str(&site_logo_for(id)?);
    Ok(json!(if file.is_empty() {
        String::new()
    } else {
        format!("{}{file}", extension_base())
    }))
}

/// Port of `siteIconMarkup` (`src/shared/site-icon.js:22`).
pub fn site_icon_markup(id: Value, name: Value, arg2: Value) -> Result<Value, String> {
    let options = options_argument(arg2, "size")?;
    let size = match member(&options, "size") {
        Some(item) if truthy(&item) => js_str(&item),
        _ => "16".to_string(),
    };
    let label = match member(&options, "label") {
        Some(item) if truthy(&item) => js_str(&item),
        _ => String::new(),
    };
    let url = js_str(&site_logo_url(id.clone())?);
    let chosen = if !label.is_empty() {
        Value::String(label)
    } else if truthy(&name) {
        name.clone()
    } else if truthy(&id) {
        id.clone()
    } else {
        Value::String(String::new())
    };
    let title = escape_attr(&js_str(&or_empty(&chosen)));
    let box_style = format!("width:{size}px;height:{size}px");
    if url.is_empty() {
        let initials_source = if truthy(&name) {
            name.clone()
        } else {
            id.clone()
        };
        let initial = escape_attr(&js_str(&site_initial(or_empty(&initials_source))?));
        return Ok(Value::String(format!(
            "<span class=\"site-logo is-neutral\" style=\"{box_style}\" title=\"{title}\" aria-hidden=\"true\">{initial}</span>"
        )));
    }
    Ok(Value::String(format!(
        "<img class=\"site-logo\" src=\"{}\" style=\"{box_style}\" width=\"{size}\" height=\"{size}\" alt=\"\" title=\"{title}\" loading=\"lazy\" decoding=\"async\">",
        escape_attr(&url)
    )))
}

/// Port of `siteLogoFor` (`src/shared/site-logos.js:65`).
pub fn site_logo_for(id: Value) -> Result<Value, String> {
    let key = js_str(&or_empty(&id));
    Ok(table("siteLogos")
        .get(&key)
        .cloned()
        .unwrap_or_else(|| json!("")))
}

/// Port of `siteInitial` (`src/shared/site-logos.js:69`).
pub fn site_initial(name: Value) -> Result<Value, String> {
    let chars = js_str(&or_empty(&name))
        .trim_matches(is_js_space)
        .to_string();
    let units = crate::utf16::units(&chars);
    if units.is_empty() {
        return Ok(json!("?"));
    }
    let first = crate::utf16::slice(&units, 0, 1);
    Ok(json!(js_to_upper(&first)))
}

/// Port of `escapeHtml` (`src/shared/ui.js:75`).
pub fn escape_html(value: Value) -> Result<Value, String> {
    let text = match &value {
        Value::Null => String::new(),
        item if is_undefined(item) => String::new(),
        item => js_str(item),
    };
    let mut out = String::with_capacity(text.len());
    for ch in text.chars() {
        match ch {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&#039;"),
            _ => out.push(ch),
        }
    }
    Ok(Value::String(out))
}

/// Port of `icon` (`src/shared/ui.js:84`).
pub fn icon(name: Value, arg1: Value) -> Result<Value, String> {
    let options = options_argument(arg1, "size")?;
    let size = match member(&options, "size") {
        Some(item) if truthy(&item) => js_str(&item),
        _ => "16".to_string(),
    };
    let class_name = match member(&options, "className") {
        Some(item) if truthy(&item) => js_str(&item),
        _ => "icon".to_string(),
    };
    let label = match member(&options, "label") {
        Some(item) if truthy(&item) => js_str(&item),
        _ => String::new(),
    };
    let title = if label.is_empty() {
        String::new()
    } else {
        format!(
            "<title>{}</title>",
            js_str(&escape_html(json!(label.clone()))?)
        )
    };
    let fallback = table("iconPaths")
        .get(ICON_FALLBACK)
        .cloned()
        .unwrap_or_else(|| json!(""));
    let path = table("iconPaths")
        .get(js_str(&name).as_str())
        .cloned()
        .unwrap_or(fallback);
    Ok(Value::String(format!(
        "<svg class=\"lucide {class_name}\" width=\"{size}\" height=\"{size}\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"{}\"{}>{title}{}</svg>",
        if label.is_empty() { "true" } else { "false" },
        if label.is_empty() {
            ""
        } else {
            " role=\"img\""
        },
        js_str(&path)
    )))
}

/// Port of `formatMoney` (`src/shared/ui.js:99`).
pub fn format_money(value: Value, currency: Option<String>) -> Result<Value, String> {
    let currency = currency.unwrap_or_else(|| "¥".to_string());
    if value.is_null() || is_undefined(&value) || value.as_str() == Some("") {
        return Ok(json!("—"));
    }
    let number = js_num(&value);
    if !number.is_finite() {
        return Ok(json!("—"));
    }
    Ok(json!(format!("{currency}{}", to_fixed(number, 4))))
}

/// Port of `formatRefreshSummary` (`src/shared/ui.js:104`).
pub fn format_refresh_summary(summary: Value) -> Result<Value, String> {
    let summary = if is_undefined(&summary) {
        json!({})
    } else if summary.is_null() {
        return Err("Cannot read properties of null (reading 'comparisonLabel')".to_string());
    } else {
        summary
    };
    let label = js_str(&member(&summary, "comparisonLabel").unwrap_or_else(undefined));
    let group = if truthy(&member(&summary, "comparisonLabel").unwrap_or_else(undefined)) {
        format!("{label}刷新")
    } else {
        "查询".to_string()
    };
    let total = js_num(&member(&summary, "total").unwrap_or_else(undefined));
    if !truthy(&member(&summary, "total").unwrap_or_else(undefined)) {
        return Ok(json!(
            if truthy(&member(&summary, "comparisonLabel").unwrap_or_else(undefined)) {
                format!("{label}没有启用的站点，未发起刷新")
            } else {
                "没有启用的站点可查询".to_string()
            }
        ));
    }
    let duration = js_num(&member(&summary, "durationMs").unwrap_or_else(undefined));
    let duration = if duration.is_finite() {
        format!(" · {} 秒", to_fixed(duration / 1000.0, 1))
    } else {
        String::new()
    };
    let count = |key: &str| -> f64 {
        let value = js_num(&member(&summary, key).unwrap_or_else(undefined));
        if truthy(&member(&summary, key).unwrap_or_else(undefined)) {
            value
        } else {
            0.0
        }
    };
    let _ = total;
    Ok(json!(format!(
        "{group}完成：{} 成功，{} 部分成功，{} 失败，共 {} 个模型{duration}",
        js_number_text(count("successCount")),
        js_number_text(count("partialCount")),
        js_number_text(count("errorCount")),
        js_number_text(count("totalModels"))
    )))
}

// ---------------------------------------------------------------------------
// JavaScript value semantics
// ---------------------------------------------------------------------------

fn undefined() -> Value {
    crate::js::undefined()
}

fn is_undefined(value: &Value) -> bool {
    crate::js::is_undefined(value)
}

fn member(value: &Value, key: &str) -> Option<Value> {
    match value {
        Value::Object(map) => map.get(key).cloned(),
        _ => None,
    }
}

fn table(name: &str) -> Value {
    DATA.get(name).cloned().unwrap_or_else(|| json!({}))
}

/// A destructured options argument: `undefined` takes the default, `null` throws as JS does.
fn options_argument(value: Value, field: &str) -> Result<Value, String> {
    if is_undefined(&value) {
        return Ok(json!({}));
    }
    if value.is_null() {
        return Err(format!(
            "Cannot read properties of null (reading '{field}')"
        ));
    }
    Ok(value)
}

/// `Object.keys` as spreading sees it: an object's own keys, an array's indexes, a string's units.
fn own_enumerable(value: &Value) -> Vec<(String, Value)> {
    match value {
        Value::Object(map) => map.iter().map(|(k, v)| (k.clone(), v.clone())).collect(),
        Value::Array(items) => items
            .iter()
            .enumerate()
            .map(|(index, item)| (index.to_string(), item.clone()))
            .collect(),
        Value::String(text) => text
            .chars()
            .enumerate()
            .map(|(index, ch)| (index.to_string(), Value::String(ch.to_string())))
            .collect(),
        _ => Vec::new(),
    }
}

fn is_plain_object(value: &Value) -> bool {
    matches!(value, Value::Object(_))
}

fn is_true(value: &Option<Value>) -> bool {
    matches!(value, Some(Value::Bool(true)))
}

fn truthy(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(flag) => *flag,
        Value::Number(number) => number.as_f64().is_some_and(|x| x != 0.0 && !x.is_nan()),
        Value::String(text) => !text.is_empty(),
        Value::Array(_) => true,
        Value::Object(_) => !is_undefined(value),
    }
}

/// `String(value)`.
fn js_str(value: &Value) -> String {
    match value {
        Value::Null => "null".to_string(),
        Value::Bool(flag) => flag.to_string(),
        Value::Number(number) => crate::js::number_to_string(number.as_f64().unwrap_or(f64::NAN)),
        Value::String(text) => text.clone(),
        Value::Array(items) => items
            .iter()
            .map(|item| {
                if item.is_null() || is_undefined(item) {
                    String::new()
                } else {
                    js_str(item)
                }
            })
            .collect::<Vec<_>>()
            .join(","),
        Value::Object(map) => {
            if is_undefined(value) {
                "undefined".to_string()
            } else if let Some(text) = map.get("$num").and_then(Value::as_str) {
                match text {
                    "-0" => "0".to_string(),
                    other => other.to_string(),
                }
            } else {
                "[object Object]".to_string()
            }
        }
    }
}

/// `String(value || "")`.
fn or_empty(value: &Value) -> Value {
    if truthy(value) {
        value.clone()
    } else {
        json!("")
    }
}

/// `Number(value)`.
fn js_num(value: &Value) -> f64 {
    match value {
        Value::Null => 0.0,
        Value::Bool(flag) => {
            if *flag {
                1.0
            } else {
                0.0
            }
        }
        Value::Number(number) => number.as_f64().unwrap_or(f64::NAN),
        Value::String(text) => parse_js_number(text),
        Value::Array(items) => match items.len() {
            0 => 0.0,
            1 => js_num(&items[0]),
            _ => f64::NAN,
        },
        Value::Object(_) => crate::js::as_number(value).unwrap_or(f64::NAN),
    }
}

fn parse_js_number(text: &str) -> f64 {
    let trimmed = text.trim_matches(is_js_space);
    if trimmed.is_empty() {
        return 0.0;
    }
    match trimmed {
        "Infinity" | "+Infinity" => return f64::INFINITY,
        "-Infinity" => return f64::NEG_INFINITY,
        _ => {}
    }
    if let Some(hex) = trimmed
        .strip_prefix("0x")
        .or_else(|| trimmed.strip_prefix("0X"))
    {
        return i64::from_str_radix(hex, 16).map_or(f64::NAN, |n| n as f64);
    }
    trimmed.parse::<f64>().unwrap_or(f64::NAN)
}

/// `Number.isFinite(value)`, which is `typeof value === "number"` and finite.
fn is_finite_number(value: &Value) -> bool {
    match value {
        Value::Number(_) => crate::js::as_number(value).is_some_and(f64::is_finite),
        _ => false,
    }
}

fn number_value(x: f64) -> Value {
    crate::js::number(x)
}

fn js_number_text(x: f64) -> String {
    crate::js::number_to_string(x)
}

/// `String.prototype.slice(0, end)` on UTF-16 units.
fn slice_utf16(text: &str, start: usize, end: usize) -> String {
    let units = crate::utf16::units(text);
    if units.len() <= end {
        return text.to_string();
    }
    crate::utf16::slice(&units, start, end)
}

fn js_to_upper(text: &str) -> String {
    text.to_uppercase()
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

/// `String(value).trim().toLowerCase().replace(/^~+/, "").replace(/\s+/g, "-")`.
fn normalize_slug(text: &str) -> String {
    let trimmed = text.trim_matches(is_js_space).to_lowercase();
    let untilded = LEADING_TILDES.replace(&trimmed, "");
    SPACES_RUN.replace_all(&untilded, "-").into_owned()
}

/// `escapeAttr` from `site-icon.js` and `provider-icons.js`: `String(value || "")` then the entities.
fn escape_attr(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for ch in text.chars() {
        match ch {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&#39;"),
            _ => out.push(ch),
        }
    }
    out
}

fn fallback_initials(value: &str) -> String {
    let trimmed = LEADING_TILDES.replace(value, "");
    let text = NON_INITIALS.replace_all(&trimmed, "").into_owned();
    if text.is_empty() {
        return "?".to_string();
    }
    if let Some(found) = LEADING_ALNUM.find(&text) {
        let units = crate::utf16::units(found.as_str());
        return js_to_upper(&crate::utf16::slice(&units, 0, 2));
    }
    let units = crate::utf16::units(&text);
    js_to_upper(&crate::utf16::slice(&units, 0, 1))
}

/// `[].concat(value)`: an array is spread one level, anything else becomes a single element.
fn concat(value: &Value) -> Vec<Value> {
    match value {
        Value::Array(items) => items.clone(),
        other => vec![other.clone()],
    }
}

/// `value.replace(/[\s._]+/g, "-")` then `/-+/g` then trim hyphens, as `canonicalModelKey` does.
fn collapse_hyphens(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut last_hyphen = false;
    for ch in text.chars() {
        if ch == '-' {
            if last_hyphen {
                continue;
            }
            last_hyphen = true;
            out.push('-');
        } else {
            last_hyphen = false;
            out.push(ch);
        }
    }
    out
}

/// `^(?:[\[【][^\]】]*[\]】]\s*)+` without a match on the empty string.
fn strip_leading_brackets(text: &str) -> String {
    let mut rest = text;
    loop {
        let mut chars = rest.chars();
        match chars.next() {
            Some('[') | Some('【') => {}
            _ => return rest.to_string(),
        }
        let opener_len = rest.chars().next().map_or(0, char::len_utf8);
        let tail = &rest[opener_len..];
        let Some(end) = tail.find([']', '】']) else {
            return rest.to_string();
        };
        let close_len = tail[end..].chars().next().map_or(1, char::len_utf8);
        let after = &tail[end + close_len..];
        rest = after.trim_start_matches(is_js_space);
    }
}

/// `Number.prototype.toFixed(digits)` for finite numbers.
fn to_fixed(value: f64, digits: usize) -> String {
    if !value.is_finite() {
        return js_number_text(value);
    }
    let rendered = format!("{:.*}", digits, value);
    if rendered == "-0" || (digits == 0 && rendered == "-0") {
        return "0".to_string();
    }
    if let Some(stripped) = rendered.strip_prefix("-")
        && stripped.chars().all(|ch| ch == '0' || ch == '.')
    {
        return stripped.to_string();
    }
    rendered
}

// URL 解析交给运行时的 `new URL`，与 JS 侧同一个解析器，边界行为不用猜。
fn parse_url(text: &str) -> Option<JsValue> {
    let ctor = js_sys::Reflect::get(&js_sys::global(), &JsValue::from_str("URL")).ok()?;
    if !ctor.is_function() {
        return None;
    }
    js_sys::Reflect::construct(&ctor.into(), &js_sys::Array::of1(&JsValue::from_str(text))).ok()
}

fn url_field(url: &JsValue, name: &str) -> String {
    js_sys::Reflect::get(url, &JsValue::from_str(name))
        .ok()
        .and_then(|value| value.as_string())
        .unwrap_or_default()
}

fn is_secure(text: &str) -> bool {
    let Some(url) = parse_url(text) else {
        return false;
    };
    match url_field(&url, "protocol").as_str() {
        "https:" => true,
        "http:" => LOCAL_HTTP_HOSTS.contains(&url_field(&url, "hostname").as_str()),
        _ => false,
    }
}

/// The `chrome-extension://<id>/` prefix a packaged page needs, read off the page's own globals.
fn extension_base() -> String {
    let Ok(chrome) = js_sys::Reflect::get(&js_sys::global(), &JsValue::from_str("chrome")) else {
        return String::new();
    };
    if chrome.is_undefined() || chrome.is_null() {
        return String::new();
    }
    let Ok(runtime) = js_sys::Reflect::get(&chrome, &JsValue::from_str("runtime")) else {
        return String::new();
    };
    if runtime.is_undefined() || runtime.is_null() {
        return String::new();
    }
    let Ok(get_url) = js_sys::Reflect::get(&runtime, &JsValue::from_str("getURL")) else {
        return String::new();
    };
    let Ok(function) = get_url.dyn_into::<js_sys::Function>() else {
        return String::new();
    };
    function
        .call1(&runtime, &JsValue::from_str(""))
        .ok()
        .and_then(|value| value.as_string())
        .unwrap_or_default()
}

/// `{ requests, input, cacheRead, cacheWrite, cacheWrite1h, output }` from a tuple in that order.
fn usage_object(values: &[f64; 6]) -> Map<String, Value> {
    let mut usage = Map::new();
    for (index, key) in USAGE_KEYS.iter().enumerate() {
        usage.insert(key.to_string(), number_value(values[index]));
    }
    usage
}

fn merge_usage(target: &mut Map<String, Value>, values: &[f64; 6]) {
    for (index, key) in USAGE_KEYS.iter().enumerate() {
        target.insert(key.to_string(), number_value(values[index]));
    }
}

fn usage_match_value(field: &str, value: &Value) -> f64 {
    let raw = js_num(value);
    // JS 侧是 `Number(value) || 0`：NaN 落成 0，其余原样参与运算。
    let raw = if raw.is_nan() { 0.0 } else { raw };
    if field == "requests" {
        return crate::js::math_round(raw);
    }
    crate::js::math_round((raw / TOKENS_PER_MILLION) * USAGE_DISPLAY_DIGITS) / USAGE_DISPLAY_DIGITS
        * TOKENS_PER_MILLION
}

fn usage_matches_preset(usage: &Value, preset: &Value) -> bool {
    USAGE_MATCH_FIELDS.iter().all(|field| {
        usage_match_value(field, &member(preset, field).unwrap_or_else(undefined))
            == usage_match_value(field, &member(usage, field).unwrap_or_else(undefined))
    })
}

/// `new Date(ms).getMonth()` and `.getDate()` in the page's own time zone.
fn local_month_day(ms: f64) -> (u32, u32) {
    let date = js_sys::Date::new(&JsValue::from_f64(ms));
    (date.get_month(), date.get_date())
}

use wasm_bindgen::{JsCast, JsValue};
