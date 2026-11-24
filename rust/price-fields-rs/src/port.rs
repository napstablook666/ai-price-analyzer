//! The Rust port of `src/core/price-fields.js`.
//!
//! Replace each `unimplemented!` with the port of the source function. Return `Err` where
//! the source throws or raises: the caller gets an error there too. After changing a
//! signature, run `rust-anything refresh` to regenerate the bindings. `rust-anything diff` checks
//! behavior against what the source recorded.

#![forbid(unsafe_code)]

/// Port of `rawPriceValue` (`src/core/price-fields.js:16`).
///
/// `field.aliases.reduce((value, alias) => value ?? item?.[alias], undefined)`：按顺序取第一个
/// 非 null/undefined 的别名值，`??` 只认 null 与 undefined，0 和空字符串都算命中。
pub fn raw_price_value(
    item: serde_json::Value,
    field: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let aliases = match field.get("aliases") {
        Some(serde_json::Value::Array(list)) => list.clone(),
        Some(other) => vec![other.clone()],
        None => return Err("TypeError: field.aliases is undefined".to_string()),
    };
    for alias in aliases {
        let Some(name) = alias.as_str() else { continue };
        let Some(value) = item.get(name) else {
            continue;
        };
        if value.is_null() || crate::js::is_undefined(value) {
            continue;
        }
        return Ok(value.clone());
    }
    Ok(crate::js::undefined())
}
