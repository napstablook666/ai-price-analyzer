//! JS bindings for `src/shared/`: generated from the signatures in `port.rs` by rust-anything.
//! Regenerate with `rust-anything refresh` after changing them.

use wasm_bindgen::prelude::*;

pub mod js;
pub mod port;
pub mod wire;

#[allow(unused_imports)]
use serde_json::Value;
pub mod utf16;

/// `redactStation`.
fn redact_station_inner(station: String) -> Result<String, String> {
    let station = crate::js::from_json(&station)?;
    let out = port::redact_station(station)?;
    crate::js::to_json(&out)
}

#[wasm_bindgen(js_name = "redactStation")]
pub fn redact_station(station: String) -> Result<String, JsError> {
    redact_station_inner(station).map_err(|e| JsError::new(&e))
}

/// `stripModelDecoration`.
fn strip_model_decoration_inner(value: String) -> Result<String, String> {
    let value = crate::js::from_json(&value)?;
    let out = port::strip_model_decoration(value)?;
    crate::js::to_json(&out)
}

#[wasm_bindgen(js_name = "stripModelDecoration")]
pub fn strip_model_decoration(value: String) -> Result<String, JsError> {
    strip_model_decoration_inner(value).map_err(|e| JsError::new(&e))
}

/// `bareModelSpelling`.
fn bare_model_spelling_inner(id: String) -> Result<String, String> {
    let id = crate::js::from_json(&id)?;
    let out = port::bare_model_spelling(id)?;
    crate::js::to_json(&out)
}

#[wasm_bindgen(js_name = "bareModelSpelling")]
pub fn bare_model_spelling(id: String) -> Result<String, JsError> {
    bare_model_spelling_inner(id).map_err(|e| JsError::new(&e))
}

/// `canonicalModelKey`.
fn canonical_model_key_inner(value: String) -> Result<String, String> {
    let value = crate::js::from_json(&value)?;
    let out = port::canonical_model_key(value)?;
    crate::js::to_json(&out)
}

#[wasm_bindgen(js_name = "canonicalModelKey")]
pub fn canonical_model_key(value: String) -> Result<String, JsError> {
    canonical_model_key_inner(value).map_err(|e| JsError::new(&e))
}

/// `effectiveMonthlyCost`.
fn effective_monthly_cost_inner(row: String) -> Result<String, String> {
    let row = crate::js::from_json(&row)?;
    let out = port::effective_monthly_cost(row)?;
    crate::js::to_json(&out)
}

#[wasm_bindgen(js_name = "effectiveMonthlyCost")]
pub fn effective_monthly_cost(row: String) -> Result<String, JsError> {
    effective_monthly_cost_inner(row).map_err(|e| JsError::new(&e))
}

/// `providerLogoSlug`.
fn provider_logo_slug_inner(value: String) -> Result<String, String> {
    let value = crate::js::from_json(&value)?;
    let out = port::provider_logo_slug(value)?;
    crate::js::to_json(&out)
}

#[wasm_bindgen(js_name = "providerLogoSlug")]
pub fn provider_logo_slug(value: String) -> Result<String, JsError> {
    provider_logo_slug_inner(value).map_err(|e| JsError::new(&e))
}

/// `providerLogoFor`.
fn provider_logo_for_inner(values: String) -> Result<String, String> {
    let values = crate::js::from_json(&values)?;
    let out = port::provider_logo_for(values)?;
    crate::js::to_json(&out)
}

#[wasm_bindgen(js_name = "providerLogoFor")]
pub fn provider_logo_for(values: String) -> Result<String, JsError> {
    provider_logo_for_inner(values).map_err(|e| JsError::new(&e))
}

/// `providerIconMarkup`.
fn provider_icon_markup_inner(values: String, arg1: String) -> Result<String, String> {
    let values = crate::js::from_json(&values)?;
    let arg1 = crate::js::from_json(&arg1)?;
    let out = port::provider_icon_markup(values, arg1)?;
    crate::js::to_json(&out)
}

#[wasm_bindgen(js_name = "providerIconMarkup")]
pub fn provider_icon_markup(values: String, arg1: String) -> Result<String, JsError> {
    provider_icon_markup_inner(values, arg1).map_err(|e| JsError::new(&e))
}

/// `normalizeRechargePayments`.
fn normalize_recharge_payments_inner(input: String) -> Result<String, String> {
    let input = crate::js::from_json(&input)?;
    let out = port::normalize_recharge_payments(input)?;
    crate::js::to_json(&out)
}

#[wasm_bindgen(js_name = "normalizeRechargePayments")]
pub fn normalize_recharge_payments(input: String) -> Result<String, JsError> {
    normalize_recharge_payments_inner(input).map_err(|e| JsError::new(&e))
}

/// `rechargePaymentRate`.
fn recharge_payment_rate_inner(payment: String) -> Result<String, String> {
    let payment = crate::js::from_json(&payment)?;
    let out = port::recharge_payment_rate(payment)?;
    crate::js::to_json(&out)
}

#[wasm_bindgen(js_name = "rechargePaymentRate")]
pub fn recharge_payment_rate(payment: String) -> Result<String, JsError> {
    recharge_payment_rate_inner(payment).map_err(|e| JsError::new(&e))
}

/// `cheapestRechargePayment`.
fn cheapest_recharge_payment_inner(payments: String) -> Result<String, String> {
    let payments = crate::js::from_json(&payments)?;
    let out = port::cheapest_recharge_payment(payments)?;
    crate::js::to_json(&out)
}

#[wasm_bindgen(js_name = "cheapestRechargePayment")]
pub fn cheapest_recharge_payment(payments: String) -> Result<String, JsError> {
    cheapest_recharge_payment_inner(payments).map_err(|e| JsError::new(&e))
}

/// `representativeRechargePayment`.
fn representative_recharge_payment_inner(
    payments: String,
    face_spend: String,
) -> Result<String, String> {
    let payments = crate::js::from_json(&payments)?;
    let face_spend = crate::js::from_json(&face_spend)?;
    let out = port::representative_recharge_payment(payments, face_spend)?;
    crate::js::to_json(&out)
}

#[wasm_bindgen(js_name = "representativeRechargePayment")]
pub fn representative_recharge_payment(
    payments: String,
    face_spend: String,
) -> Result<String, JsError> {
    representative_recharge_payment_inner(payments, face_spend).map_err(|e| JsError::new(&e))
}

/// `normalizeRechargeTiers`.
fn normalize_recharge_tiers_inner(input: String) -> Result<String, String> {
    let input = crate::js::from_json(&input)?;
    let out = port::normalize_recharge_tiers(input)?;
    crate::js::to_json(&out)
}

#[wasm_bindgen(js_name = "normalizeRechargeTiers")]
pub fn normalize_recharge_tiers(input: String) -> Result<String, JsError> {
    normalize_recharge_tiers_inner(input).map_err(|e| JsError::new(&e))
}

/// `normalizeRechargePlans`.
fn normalize_recharge_plans_inner(input: String) -> Result<String, String> {
    let input = crate::js::from_json(&input)?;
    let out = port::normalize_recharge_plans(input)?;
    crate::js::to_json(&out)
}

#[wasm_bindgen(js_name = "normalizeRechargePlans")]
pub fn normalize_recharge_plans(input: String) -> Result<String, JsError> {
    normalize_recharge_plans_inner(input).map_err(|e| JsError::new(&e))
}

/// `convertRechargeAmount`.
fn convert_recharge_amount_inner(
    amount: String,
    from_currency: String,
    to_currency: String,
    exchange_rate: String,
) -> Result<String, String> {
    let amount = crate::js::from_json(&amount)?;
    let from_currency = crate::js::from_json(&from_currency)?;
    let to_currency = crate::js::from_json(&to_currency)?;
    let exchange_rate = crate::js::from_json(&exchange_rate)?;
    let out = port::convert_recharge_amount(amount, from_currency, to_currency, exchange_rate)?;
    crate::js::to_json(&out)
}

#[wasm_bindgen(js_name = "convertRechargeAmount")]
pub fn convert_recharge_amount(
    amount: String,
    from_currency: String,
    to_currency: String,
    exchange_rate: String,
) -> Result<String, JsError> {
    convert_recharge_amount_inner(amount, from_currency, to_currency, exchange_rate)
        .map_err(|e| JsError::new(&e))
}

/// `usagePresetUsage`.
fn usage_preset_usage_inner(id: String, magpie_sync: String) -> Result<String, String> {
    let id = crate::js::from_json(&id)?;
    let magpie_sync = crate::js::from_json(&magpie_sync)?;
    let out = port::usage_preset_usage(id, magpie_sync)?;
    crate::js::to_json(&out)
}

#[wasm_bindgen(js_name = "usagePresetUsage")]
pub fn usage_preset_usage(id: String, magpie_sync: String) -> Result<String, JsError> {
    usage_preset_usage_inner(id, magpie_sync).map_err(|e| JsError::new(&e))
}

/// `usagePresetOptions`.
fn usage_preset_options_inner(magpie_sync: String) -> Result<String, String> {
    let magpie_sync = crate::js::from_json(&magpie_sync)?;
    let out = port::usage_preset_options(magpie_sync)?;
    crate::js::to_json(&out)
}

#[wasm_bindgen(js_name = "usagePresetOptions")]
pub fn usage_preset_options(magpie_sync: String) -> Result<String, JsError> {
    usage_preset_options_inner(magpie_sync).map_err(|e| JsError::new(&e))
}

/// `usagePresetId`.
fn usage_preset_id_inner(usage: String, magpie_sync: String) -> Result<String, String> {
    let usage = crate::js::from_json(&usage)?;
    let magpie_sync = crate::js::from_json(&magpie_sync)?;
    let out = port::usage_preset_id(usage, magpie_sync)?;
    crate::js::to_json(&out)
}

#[wasm_bindgen(js_name = "usagePresetId")]
pub fn usage_preset_id(usage: String, magpie_sync: String) -> Result<String, JsError> {
    usage_preset_id_inner(usage, magpie_sync).map_err(|e| JsError::new(&e))
}

/// `isSecureRemoteUrl`.
fn is_secure_remote_url_inner(value: String) -> Result<String, String> {
    let value = crate::js::from_json(&value)?;
    let out = port::is_secure_remote_url(value)?;
    crate::js::to_json(&out)
}

#[wasm_bindgen(js_name = "isSecureRemoteUrl")]
pub fn is_secure_remote_url(value: String) -> Result<String, JsError> {
    is_secure_remote_url_inner(value).map_err(|e| JsError::new(&e))
}

/// `currentSiteOrigin`.
fn current_site_origin_inner(value: String) -> Result<String, String> {
    let value = crate::js::from_json(&value)?;
    let out = port::current_site_origin(value)?;
    crate::js::to_json(&out)
}

#[wasm_bindgen(js_name = "currentSiteOrigin")]
pub fn current_site_origin(value: String) -> Result<String, JsError> {
    current_site_origin_inner(value).map_err(|e| JsError::new(&e))
}

/// `normalizeBillingProfile`.
fn normalize_billing_profile_inner(input: String) -> Result<String, String> {
    let input = crate::js::from_json(&input)?;
    let out = port::normalize_billing_profile(input)?;
    crate::js::to_json(&out)
}

#[wasm_bindgen(js_name = "normalizeBillingProfile")]
pub fn normalize_billing_profile(input: String) -> Result<String, JsError> {
    normalize_billing_profile_inner(input).map_err(|e| JsError::new(&e))
}

/// `cloneDefaultStation`.
fn clone_default_station_inner() -> Result<String, String> {
    let out = port::clone_default_station()?;
    crate::js::to_json(&out)
}

#[wasm_bindgen(js_name = "cloneDefaultStation")]
pub fn clone_default_station() -> Result<String, JsError> {
    clone_default_station_inner().map_err(|e| JsError::new(&e))
}

/// `normalizeUrl`.
fn normalize_url_inner(value: String) -> Result<String, String> {
    let value = crate::js::from_json(&value)?;
    let out = port::normalize_url(value)?;
    crate::js::to_json(&out)
}

#[wasm_bindgen(js_name = "normalizeUrl")]
pub fn normalize_url(value: String) -> Result<String, JsError> {
    normalize_url_inner(value).map_err(|e| JsError::new(&e))
}

/// `siteLogoUrl`.
fn site_logo_url_inner(id: String) -> Result<String, String> {
    let id = crate::js::from_json(&id)?;
    let out = port::site_logo_url(id)?;
    crate::js::to_json(&out)
}

#[wasm_bindgen(js_name = "siteLogoUrl")]
pub fn site_logo_url(id: String) -> Result<String, JsError> {
    site_logo_url_inner(id).map_err(|e| JsError::new(&e))
}

/// `siteIconMarkup`.
fn site_icon_markup_inner(id: String, name: String, arg2: String) -> Result<String, String> {
    let id = crate::js::from_json(&id)?;
    let name = crate::js::from_json(&name)?;
    let arg2 = crate::js::from_json(&arg2)?;
    let out = port::site_icon_markup(id, name, arg2)?;
    crate::js::to_json(&out)
}

#[wasm_bindgen(js_name = "siteIconMarkup")]
pub fn site_icon_markup(id: String, name: String, arg2: String) -> Result<String, JsError> {
    site_icon_markup_inner(id, name, arg2).map_err(|e| JsError::new(&e))
}

/// `siteLogoFor`.
fn site_logo_for_inner(id: String) -> Result<String, String> {
    let id = crate::js::from_json(&id)?;
    let out = port::site_logo_for(id)?;
    crate::js::to_json(&out)
}

#[wasm_bindgen(js_name = "siteLogoFor")]
pub fn site_logo_for(id: String) -> Result<String, JsError> {
    site_logo_for_inner(id).map_err(|e| JsError::new(&e))
}

/// `siteInitial`.
fn site_initial_inner(name: String) -> Result<String, String> {
    let name = crate::js::from_json(&name)?;
    let out = port::site_initial(name)?;
    crate::js::to_json(&out)
}

#[wasm_bindgen(js_name = "siteInitial")]
pub fn site_initial(name: String) -> Result<String, JsError> {
    site_initial_inner(name).map_err(|e| JsError::new(&e))
}

/// `escapeHtml`.
fn escape_html_inner(value: String) -> Result<String, String> {
    let value = crate::js::from_json(&value)?;
    let out = port::escape_html(value)?;
    crate::js::to_json(&out)
}

#[wasm_bindgen(js_name = "escapeHtml")]
pub fn escape_html(value: String) -> Result<String, JsError> {
    escape_html_inner(value).map_err(|e| JsError::new(&e))
}

/// `icon`.
fn icon_inner(name: String, arg1: String) -> Result<String, String> {
    let name = crate::js::from_json(&name)?;
    let arg1 = crate::js::from_json(&arg1)?;
    let out = port::icon(name, arg1)?;
    crate::js::to_json(&out)
}

#[wasm_bindgen(js_name = "icon")]
pub fn icon(name: String, arg1: String) -> Result<String, JsError> {
    icon_inner(name, arg1).map_err(|e| JsError::new(&e))
}

/// `formatMoney`.
fn format_money_inner(value: String, currency: Option<String>) -> Result<String, String> {
    let value = crate::js::from_json(&value)?;
    let out = port::format_money(value, currency)?;
    crate::js::to_json(&out)
}

#[wasm_bindgen(js_name = "formatMoney")]
pub fn format_money(value: String, currency: Option<String>) -> Result<String, JsError> {
    format_money_inner(value, currency).map_err(|e| JsError::new(&e))
}

/// `formatRefreshSummary`.
fn format_refresh_summary_inner(summary: String) -> Result<String, String> {
    let summary = crate::js::from_json(&summary)?;
    let out = port::format_refresh_summary(summary)?;
    crate::js::to_json(&out)
}

#[wasm_bindgen(js_name = "formatRefreshSummary")]
pub fn format_refresh_summary(summary: String) -> Result<String, JsError> {
    format_refresh_summary_inner(summary).map_err(|e| JsError::new(&e))
}

// ---- the binary wire ------------------------------------------------------------------------

thread_local! {
    static WIRE_IN: std::cell::RefCell<Vec<u8>> = const { std::cell::RefCell::new(Vec::new()) };
    static WIRE_OUT: std::cell::RefCell<Vec<u8>> = const { std::cell::RefCell::new(Vec::new()) };
}

/// This module's memory, where `index.cjs` reads and writes the wire buffers.
#[wasm_bindgen(js_name = "rustAnythingWireMemory")]
pub fn rust_anything_wire_memory() -> JsValue {
    wasm_bindgen::memory()
}

/// The address of an argument buffer of `len` bytes.
#[wasm_bindgen(js_name = "rustAnythingWireIn")]
pub fn rust_anything_wire_in(len: u32) -> u32 {
    WIRE_IN.with(|b| {
        let mut b = b.borrow_mut();
        b.resize(len as usize, 0);
        b.as_mut_ptr() as usize as u32
    })
}

/// The address of the last result.
#[wasm_bindgen(js_name = "rustAnythingWireOut")]
pub fn rust_anything_wire_out() -> u32 {
    WIRE_OUT.with(|b| b.borrow().as_ptr() as usize as u32)
}

/// Reads `len` argument bytes, runs `f`, and keeps its result for `rustAnythingWireOut`.
fn wire_io(
    len: u32,
    f: impl FnOnce(&mut wire::Reader, &mut wire::Writer) -> Result<(), String>,
) -> Result<u32, JsError> {
    let input = WIRE_IN.with(|b| std::mem::take(&mut *b.borrow_mut()));
    let mut w = wire::Writer::default();
    let result = f(
        &mut wire::Reader::new(&input[..(len as usize).min(input.len())]),
        &mut w,
    );
    WIRE_IN.with(|b| *b.borrow_mut() = input);
    match result {
        // A result of another shape than the TS type: JS runs the call through JSON.
        Err(e) if e.starts_with(wire::MISMATCH) => return Ok(u32::MAX),
        other => other.map_err(|e| JsError::new(&e))?,
    }
    let n = w.0.len();
    WIRE_OUT.with(|b| *b.borrow_mut() = w.0);
    Ok(u32::try_from(n).unwrap_or(u32::MAX))
}

static S_REDACT_STATION_0: wire::Schema = wire::Schema::Dyn;
static S_REDACT_STATION_OUT: wire::Schema = wire::Schema::Dyn;

/// `redactStation` over the binary wire.
#[wasm_bindgen(js_name = "redactStationWire")]
pub fn redact_station_wire(len: u32) -> Result<u32, JsError> {
    wire_io(len, |r, w| {
        let station: Value = wire::read_value(r, &S_REDACT_STATION_0)?;
        let out = &port::redact_station(station)?;
        wire::write_value(w, out, &S_REDACT_STATION_OUT)?;
        Ok(())
    })
}

static S_STRIP_MODEL_DECORATION_0: wire::Schema = wire::Schema::Dyn;
static S_STRIP_MODEL_DECORATION_OUT: wire::Schema = wire::Schema::Dyn;

/// `stripModelDecoration` over the binary wire.
#[wasm_bindgen(js_name = "stripModelDecorationWire")]
pub fn strip_model_decoration_wire(len: u32) -> Result<u32, JsError> {
    wire_io(len, |r, w| {
        let value: Value = wire::read_value(r, &S_STRIP_MODEL_DECORATION_0)?;
        let out = &port::strip_model_decoration(value)?;
        wire::write_value(w, out, &S_STRIP_MODEL_DECORATION_OUT)?;
        Ok(())
    })
}

static S_BARE_MODEL_SPELLING_0: wire::Schema = wire::Schema::Dyn;
static S_BARE_MODEL_SPELLING_OUT: wire::Schema = wire::Schema::Dyn;

/// `bareModelSpelling` over the binary wire.
#[wasm_bindgen(js_name = "bareModelSpellingWire")]
pub fn bare_model_spelling_wire(len: u32) -> Result<u32, JsError> {
    wire_io(len, |r, w| {
        let id: Value = wire::read_value(r, &S_BARE_MODEL_SPELLING_0)?;
        let out = &port::bare_model_spelling(id)?;
        wire::write_value(w, out, &S_BARE_MODEL_SPELLING_OUT)?;
        Ok(())
    })
}

static S_CANONICAL_MODEL_KEY_0: wire::Schema = wire::Schema::Dyn;
static S_CANONICAL_MODEL_KEY_OUT: wire::Schema = wire::Schema::Dyn;

/// `canonicalModelKey` over the binary wire.
#[wasm_bindgen(js_name = "canonicalModelKeyWire")]
pub fn canonical_model_key_wire(len: u32) -> Result<u32, JsError> {
    wire_io(len, |r, w| {
        let value: Value = wire::read_value(r, &S_CANONICAL_MODEL_KEY_0)?;
        let out = &port::canonical_model_key(value)?;
        wire::write_value(w, out, &S_CANONICAL_MODEL_KEY_OUT)?;
        Ok(())
    })
}

static S_EFFECTIVE_MONTHLY_COST_0: wire::Schema = wire::Schema::Dyn;
static S_EFFECTIVE_MONTHLY_COST_OUT: wire::Schema = wire::Schema::Dyn;

/// `effectiveMonthlyCost` over the binary wire.
#[wasm_bindgen(js_name = "effectiveMonthlyCostWire")]
pub fn effective_monthly_cost_wire(len: u32) -> Result<u32, JsError> {
    wire_io(len, |r, w| {
        let row: Value = wire::read_value(r, &S_EFFECTIVE_MONTHLY_COST_0)?;
        let out = &port::effective_monthly_cost(row)?;
        wire::write_value(w, out, &S_EFFECTIVE_MONTHLY_COST_OUT)?;
        Ok(())
    })
}

static S_PROVIDER_LOGO_SLUG_0: wire::Schema = wire::Schema::Dyn;
static S_PROVIDER_LOGO_SLUG_OUT: wire::Schema = wire::Schema::Dyn;

/// `providerLogoSlug` over the binary wire.
#[wasm_bindgen(js_name = "providerLogoSlugWire")]
pub fn provider_logo_slug_wire(len: u32) -> Result<u32, JsError> {
    wire_io(len, |r, w| {
        let value: Value = wire::read_value(r, &S_PROVIDER_LOGO_SLUG_0)?;
        let out = &port::provider_logo_slug(value)?;
        wire::write_value(w, out, &S_PROVIDER_LOGO_SLUG_OUT)?;
        Ok(())
    })
}

static S_PROVIDER_LOGO_FOR_0: wire::Schema = wire::Schema::Dyn;
static S_PROVIDER_LOGO_FOR_OUT: wire::Schema = wire::Schema::Dyn;

/// `providerLogoFor` over the binary wire.
#[wasm_bindgen(js_name = "providerLogoForWire")]
pub fn provider_logo_for_wire(len: u32) -> Result<u32, JsError> {
    wire_io(len, |r, w| {
        let values: Value = wire::read_value(r, &S_PROVIDER_LOGO_FOR_0)?;
        let out = &port::provider_logo_for(values)?;
        wire::write_value(w, out, &S_PROVIDER_LOGO_FOR_OUT)?;
        Ok(())
    })
}

static S_PROVIDER_ICON_MARKUP_0: wire::Schema = wire::Schema::Dyn;
static S_PROVIDER_ICON_MARKUP_1: wire::Schema = wire::Schema::Dyn;
static S_PROVIDER_ICON_MARKUP_OUT: wire::Schema = wire::Schema::Dyn;

/// `providerIconMarkup` over the binary wire.
#[wasm_bindgen(js_name = "providerIconMarkupWire")]
pub fn provider_icon_markup_wire(len: u32) -> Result<u32, JsError> {
    wire_io(len, |r, w| {
        let values: Value = wire::read_value(r, &S_PROVIDER_ICON_MARKUP_0)?;
        let arg1: Value = wire::read_value(r, &S_PROVIDER_ICON_MARKUP_1)?;
        let out = &port::provider_icon_markup(values, arg1)?;
        wire::write_value(w, out, &S_PROVIDER_ICON_MARKUP_OUT)?;
        Ok(())
    })
}

static S_NORMALIZE_RECHARGE_PAYMENTS_0: wire::Schema = wire::Schema::Dyn;
static S_NORMALIZE_RECHARGE_PAYMENTS_OUT: wire::Schema = wire::Schema::Dyn;

/// `normalizeRechargePayments` over the binary wire.
#[wasm_bindgen(js_name = "normalizeRechargePaymentsWire")]
pub fn normalize_recharge_payments_wire(len: u32) -> Result<u32, JsError> {
    wire_io(len, |r, w| {
        let input: Value = wire::read_value(r, &S_NORMALIZE_RECHARGE_PAYMENTS_0)?;
        let out = &port::normalize_recharge_payments(input)?;
        wire::write_value(w, out, &S_NORMALIZE_RECHARGE_PAYMENTS_OUT)?;
        Ok(())
    })
}

static S_RECHARGE_PAYMENT_RATE_0: wire::Schema = wire::Schema::Dyn;
static S_RECHARGE_PAYMENT_RATE_OUT: wire::Schema = wire::Schema::Dyn;

/// `rechargePaymentRate` over the binary wire.
#[wasm_bindgen(js_name = "rechargePaymentRateWire")]
pub fn recharge_payment_rate_wire(len: u32) -> Result<u32, JsError> {
    wire_io(len, |r, w| {
        let payment: Value = wire::read_value(r, &S_RECHARGE_PAYMENT_RATE_0)?;
        let out = &port::recharge_payment_rate(payment)?;
        wire::write_value(w, out, &S_RECHARGE_PAYMENT_RATE_OUT)?;
        Ok(())
    })
}

static S_CHEAPEST_RECHARGE_PAYMENT_0: wire::Schema = wire::Schema::Dyn;
static S_CHEAPEST_RECHARGE_PAYMENT_OUT: wire::Schema = wire::Schema::Dyn;

/// `cheapestRechargePayment` over the binary wire.
#[wasm_bindgen(js_name = "cheapestRechargePaymentWire")]
pub fn cheapest_recharge_payment_wire(len: u32) -> Result<u32, JsError> {
    wire_io(len, |r, w| {
        let payments: Value = wire::read_value(r, &S_CHEAPEST_RECHARGE_PAYMENT_0)?;
        let out = &port::cheapest_recharge_payment(payments)?;
        wire::write_value(w, out, &S_CHEAPEST_RECHARGE_PAYMENT_OUT)?;
        Ok(())
    })
}

static S_REPRESENTATIVE_RECHARGE_PAYMENT_0: wire::Schema = wire::Schema::Dyn;
static S_REPRESENTATIVE_RECHARGE_PAYMENT_OUT: wire::Schema = wire::Schema::Dyn;

/// `representativeRechargePayment` over the binary wire.
#[wasm_bindgen(js_name = "representativeRechargePaymentWire")]
pub fn representative_recharge_payment_wire(len: u32) -> Result<u32, JsError> {
    wire_io(len, |r, w| {
        let payments: Value = wire::read_value(r, &S_REPRESENTATIVE_RECHARGE_PAYMENT_0)?;
        let face_spend: Option<Value> = wire::read_dyn_opt(r)?;
        let out = &port::representative_recharge_payment(payments, face_spend)?;
        wire::write_value(w, out, &S_REPRESENTATIVE_RECHARGE_PAYMENT_OUT)?;
        Ok(())
    })
}

static S_NORMALIZE_RECHARGE_TIERS_0: wire::Schema = wire::Schema::Dyn;
static S_NORMALIZE_RECHARGE_TIERS_OUT: wire::Schema = wire::Schema::Dyn;

/// `normalizeRechargeTiers` over the binary wire.
#[wasm_bindgen(js_name = "normalizeRechargeTiersWire")]
pub fn normalize_recharge_tiers_wire(len: u32) -> Result<u32, JsError> {
    wire_io(len, |r, w| {
        let input: Value = wire::read_value(r, &S_NORMALIZE_RECHARGE_TIERS_0)?;
        let out = &port::normalize_recharge_tiers(input)?;
        wire::write_value(w, out, &S_NORMALIZE_RECHARGE_TIERS_OUT)?;
        Ok(())
    })
}

static S_NORMALIZE_RECHARGE_PLANS_0: wire::Schema = wire::Schema::Dyn;
static S_NORMALIZE_RECHARGE_PLANS_OUT: wire::Schema = wire::Schema::Dyn;

/// `normalizeRechargePlans` over the binary wire.
#[wasm_bindgen(js_name = "normalizeRechargePlansWire")]
pub fn normalize_recharge_plans_wire(len: u32) -> Result<u32, JsError> {
    wire_io(len, |r, w| {
        let input: Value = wire::read_value(r, &S_NORMALIZE_RECHARGE_PLANS_0)?;
        let out = &port::normalize_recharge_plans(input)?;
        wire::write_value(w, out, &S_NORMALIZE_RECHARGE_PLANS_OUT)?;
        Ok(())
    })
}

static S_CONVERT_RECHARGE_AMOUNT_0: wire::Schema = wire::Schema::Dyn;
static S_CONVERT_RECHARGE_AMOUNT_1: wire::Schema = wire::Schema::Dyn;
static S_CONVERT_RECHARGE_AMOUNT_2: wire::Schema = wire::Schema::Dyn;
static S_CONVERT_RECHARGE_AMOUNT_OUT: wire::Schema = wire::Schema::Dyn;

/// `convertRechargeAmount` over the binary wire.
#[wasm_bindgen(js_name = "convertRechargeAmountWire")]
pub fn convert_recharge_amount_wire(len: u32) -> Result<u32, JsError> {
    wire_io(len, |r, w| {
        let amount: Value = wire::read_value(r, &S_CONVERT_RECHARGE_AMOUNT_0)?;
        let from_currency: Value = wire::read_value(r, &S_CONVERT_RECHARGE_AMOUNT_1)?;
        let to_currency: Value = wire::read_value(r, &S_CONVERT_RECHARGE_AMOUNT_2)?;
        let exchange_rate: Option<Value> = wire::read_dyn_opt(r)?;
        let out =
            &port::convert_recharge_amount(amount, from_currency, to_currency, exchange_rate)?;
        wire::write_value(w, out, &S_CONVERT_RECHARGE_AMOUNT_OUT)?;
        Ok(())
    })
}

static S_USAGE_PRESET_USAGE_0: wire::Schema = wire::Schema::Dyn;
static S_USAGE_PRESET_USAGE_OUT: wire::Schema = wire::Schema::Dyn;

/// `usagePresetUsage` over the binary wire.
#[wasm_bindgen(js_name = "usagePresetUsageWire")]
pub fn usage_preset_usage_wire(len: u32) -> Result<u32, JsError> {
    wire_io(len, |r, w| {
        let id: Value = wire::read_value(r, &S_USAGE_PRESET_USAGE_0)?;
        let magpie_sync: Option<Value> = wire::read_dyn_opt(r)?;
        let out = &port::usage_preset_usage(id, magpie_sync)?;
        wire::write_value(w, out, &S_USAGE_PRESET_USAGE_OUT)?;
        Ok(())
    })
}

static S_USAGE_PRESET_OPTIONS_OUT: wire::Schema = wire::Schema::Dyn;

/// `usagePresetOptions` over the binary wire.
#[wasm_bindgen(js_name = "usagePresetOptionsWire")]
pub fn usage_preset_options_wire(len: u32) -> Result<u32, JsError> {
    wire_io(len, |r, w| {
        let magpie_sync: Option<Value> = wire::read_dyn_opt(r)?;
        let out = &port::usage_preset_options(magpie_sync)?;
        wire::write_value(w, out, &S_USAGE_PRESET_OPTIONS_OUT)?;
        Ok(())
    })
}

static S_USAGE_PRESET_ID_0: wire::Schema = wire::Schema::Dyn;
static S_USAGE_PRESET_ID_OUT: wire::Schema = wire::Schema::Dyn;

/// `usagePresetId` over the binary wire.
#[wasm_bindgen(js_name = "usagePresetIdWire")]
pub fn usage_preset_id_wire(len: u32) -> Result<u32, JsError> {
    wire_io(len, |r, w| {
        let usage: Value = wire::read_value(r, &S_USAGE_PRESET_ID_0)?;
        let magpie_sync: Option<Value> = wire::read_dyn_opt(r)?;
        let out = &port::usage_preset_id(usage, magpie_sync)?;
        wire::write_value(w, out, &S_USAGE_PRESET_ID_OUT)?;
        Ok(())
    })
}

static S_IS_SECURE_REMOTE_URL_0: wire::Schema = wire::Schema::Dyn;
static S_IS_SECURE_REMOTE_URL_OUT: wire::Schema = wire::Schema::Dyn;

/// `isSecureRemoteUrl` over the binary wire.
#[wasm_bindgen(js_name = "isSecureRemoteUrlWire")]
pub fn is_secure_remote_url_wire(len: u32) -> Result<u32, JsError> {
    wire_io(len, |r, w| {
        let value: Value = wire::read_value(r, &S_IS_SECURE_REMOTE_URL_0)?;
        let out = &port::is_secure_remote_url(value)?;
        wire::write_value(w, out, &S_IS_SECURE_REMOTE_URL_OUT)?;
        Ok(())
    })
}

static S_CURRENT_SITE_ORIGIN_0: wire::Schema = wire::Schema::Dyn;
static S_CURRENT_SITE_ORIGIN_OUT: wire::Schema = wire::Schema::Dyn;

/// `currentSiteOrigin` over the binary wire.
#[wasm_bindgen(js_name = "currentSiteOriginWire")]
pub fn current_site_origin_wire(len: u32) -> Result<u32, JsError> {
    wire_io(len, |r, w| {
        let value: Value = wire::read_value(r, &S_CURRENT_SITE_ORIGIN_0)?;
        let out = &port::current_site_origin(value)?;
        wire::write_value(w, out, &S_CURRENT_SITE_ORIGIN_OUT)?;
        Ok(())
    })
}

static S_NORMALIZE_BILLING_PROFILE_0: wire::Schema = wire::Schema::Dyn;
static S_NORMALIZE_BILLING_PROFILE_OUT: wire::Schema = wire::Schema::Dyn;

/// `normalizeBillingProfile` over the binary wire.
#[wasm_bindgen(js_name = "normalizeBillingProfileWire")]
pub fn normalize_billing_profile_wire(len: u32) -> Result<u32, JsError> {
    wire_io(len, |r, w| {
        let input: Value = wire::read_value(r, &S_NORMALIZE_BILLING_PROFILE_0)?;
        let out = &port::normalize_billing_profile(input)?;
        wire::write_value(w, out, &S_NORMALIZE_BILLING_PROFILE_OUT)?;
        Ok(())
    })
}

static S_CLONE_DEFAULT_STATION_OUT: wire::Schema = wire::Schema::Dyn;

/// `cloneDefaultStation` over the binary wire.
#[wasm_bindgen(js_name = "cloneDefaultStationWire")]
pub fn clone_default_station_wire(len: u32) -> Result<u32, JsError> {
    wire_io(len, |_r, w| {
        let out = &port::clone_default_station()?;
        wire::write_value(w, out, &S_CLONE_DEFAULT_STATION_OUT)?;
        Ok(())
    })
}

static S_NORMALIZE_URL_0: wire::Schema = wire::Schema::Dyn;
static S_NORMALIZE_URL_OUT: wire::Schema = wire::Schema::Dyn;

/// `normalizeUrl` over the binary wire.
#[wasm_bindgen(js_name = "normalizeUrlWire")]
pub fn normalize_url_wire(len: u32) -> Result<u32, JsError> {
    wire_io(len, |r, w| {
        let value: Value = wire::read_value(r, &S_NORMALIZE_URL_0)?;
        let out = &port::normalize_url(value)?;
        wire::write_value(w, out, &S_NORMALIZE_URL_OUT)?;
        Ok(())
    })
}

static S_SITE_LOGO_URL_0: wire::Schema = wire::Schema::Dyn;
static S_SITE_LOGO_URL_OUT: wire::Schema = wire::Schema::Dyn;

/// `siteLogoUrl` over the binary wire.
#[wasm_bindgen(js_name = "siteLogoUrlWire")]
pub fn site_logo_url_wire(len: u32) -> Result<u32, JsError> {
    wire_io(len, |r, w| {
        let id: Value = wire::read_value(r, &S_SITE_LOGO_URL_0)?;
        let out = &port::site_logo_url(id)?;
        wire::write_value(w, out, &S_SITE_LOGO_URL_OUT)?;
        Ok(())
    })
}

static S_SITE_ICON_MARKUP_0: wire::Schema = wire::Schema::Dyn;
static S_SITE_ICON_MARKUP_1: wire::Schema = wire::Schema::Dyn;
static S_SITE_ICON_MARKUP_2: wire::Schema = wire::Schema::Dyn;
static S_SITE_ICON_MARKUP_OUT: wire::Schema = wire::Schema::Dyn;

/// `siteIconMarkup` over the binary wire.
#[wasm_bindgen(js_name = "siteIconMarkupWire")]
pub fn site_icon_markup_wire(len: u32) -> Result<u32, JsError> {
    wire_io(len, |r, w| {
        let id: Value = wire::read_value(r, &S_SITE_ICON_MARKUP_0)?;
        let name: Value = wire::read_value(r, &S_SITE_ICON_MARKUP_1)?;
        let arg2: Value = wire::read_value(r, &S_SITE_ICON_MARKUP_2)?;
        let out = &port::site_icon_markup(id, name, arg2)?;
        wire::write_value(w, out, &S_SITE_ICON_MARKUP_OUT)?;
        Ok(())
    })
}

static S_SITE_LOGO_FOR_0: wire::Schema = wire::Schema::Dyn;
static S_SITE_LOGO_FOR_OUT: wire::Schema = wire::Schema::Dyn;

/// `siteLogoFor` over the binary wire.
#[wasm_bindgen(js_name = "siteLogoForWire")]
pub fn site_logo_for_wire(len: u32) -> Result<u32, JsError> {
    wire_io(len, |r, w| {
        let id: Value = wire::read_value(r, &S_SITE_LOGO_FOR_0)?;
        let out = &port::site_logo_for(id)?;
        wire::write_value(w, out, &S_SITE_LOGO_FOR_OUT)?;
        Ok(())
    })
}

static S_SITE_INITIAL_0: wire::Schema = wire::Schema::Dyn;
static S_SITE_INITIAL_OUT: wire::Schema = wire::Schema::Dyn;

/// `siteInitial` over the binary wire.
#[wasm_bindgen(js_name = "siteInitialWire")]
pub fn site_initial_wire(len: u32) -> Result<u32, JsError> {
    wire_io(len, |r, w| {
        let name: Value = wire::read_value(r, &S_SITE_INITIAL_0)?;
        let out = &port::site_initial(name)?;
        wire::write_value(w, out, &S_SITE_INITIAL_OUT)?;
        Ok(())
    })
}

static S_ESCAPE_HTML_0: wire::Schema = wire::Schema::Dyn;
static S_ESCAPE_HTML_OUT: wire::Schema = wire::Schema::Dyn;

/// `escapeHtml` over the binary wire.
#[wasm_bindgen(js_name = "escapeHtmlWire")]
pub fn escape_html_wire(len: u32) -> Result<u32, JsError> {
    wire_io(len, |r, w| {
        let value: Value = wire::read_value(r, &S_ESCAPE_HTML_0)?;
        let out = &port::escape_html(value)?;
        wire::write_value(w, out, &S_ESCAPE_HTML_OUT)?;
        Ok(())
    })
}

static S_ICON_0: wire::Schema = wire::Schema::Dyn;
static S_ICON_1: wire::Schema = wire::Schema::Dyn;
static S_ICON_OUT: wire::Schema = wire::Schema::Dyn;

/// `icon` over the binary wire.
#[wasm_bindgen(js_name = "iconWire")]
pub fn icon_wire(len: u32) -> Result<u32, JsError> {
    wire_io(len, |r, w| {
        let name: Value = wire::read_value(r, &S_ICON_0)?;
        let arg1: Value = wire::read_value(r, &S_ICON_1)?;
        let out = &port::icon(name, arg1)?;
        wire::write_value(w, out, &S_ICON_OUT)?;
        Ok(())
    })
}

static S_FORMAT_MONEY_0: wire::Schema = wire::Schema::Dyn;
static S_FORMAT_MONEY_OUT: wire::Schema = wire::Schema::Dyn;

/// `formatMoney` over the binary wire.
#[wasm_bindgen(js_name = "formatMoneyWire")]
pub fn format_money_wire(len: u32) -> Result<u32, JsError> {
    wire_io(len, |r, w| {
        let value: Value = wire::read_value(r, &S_FORMAT_MONEY_0)?;
        let currency: Option<String> = r.opt_js(|r| r.string16())?;
        let out = &port::format_money(value, currency)?;
        wire::write_value(w, out, &S_FORMAT_MONEY_OUT)?;
        Ok(())
    })
}

static S_FORMAT_REFRESH_SUMMARY_0: wire::Schema = wire::Schema::Dyn;
static S_FORMAT_REFRESH_SUMMARY_OUT: wire::Schema = wire::Schema::Dyn;

/// `formatRefreshSummary` over the binary wire.
#[wasm_bindgen(js_name = "formatRefreshSummaryWire")]
pub fn format_refresh_summary_wire(len: u32) -> Result<u32, JsError> {
    wire_io(len, |r, w| {
        let summary: Value = wire::read_value(r, &S_FORMAT_REFRESH_SUMMARY_0)?;
        let out = &port::format_refresh_summary(summary)?;
        wire::write_value(w, out, &S_FORMAT_REFRESH_SUMMARY_OUT)?;
        Ok(())
    })
}
