//! JS bindings for `src/core/exchange-rate.js`: generated from the signatures in `port.rs` by rust-anything.
//! Regenerate with `rust-anything refresh` after changing them.

use wasm_bindgen::prelude::*;

pub mod js;
pub mod port;
pub mod wire;

#[allow(unused_imports)]
use serde_json::Value;
pub mod utf16;

/// `exchangeRateInfo`.
fn exchange_rate_info_inner(
    settings: String,
    references: String,
    now: String,
) -> Result<String, String> {
    let settings = crate::js::from_json(&settings)?;
    let references = crate::js::from_json(&references)?;
    let now = crate::js::from_json(&now)?;
    let out = port::exchange_rate_info(settings, references, now)?;
    crate::js::to_json(&out)
}

#[wasm_bindgen(js_name = "exchangeRateInfo")]
pub fn exchange_rate_info(
    settings: String,
    references: String,
    now: String,
) -> Result<String, JsError> {
    exchange_rate_info_inner(settings, references, now).map_err(|e| JsError::new(&e))
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

static S_EXCHANGE_RATE_INFO_0: wire::Schema = wire::Schema::Dyn;
static S_EXCHANGE_RATE_INFO_1: wire::Schema = wire::Schema::Dyn;
static S_EXCHANGE_RATE_INFO_2: wire::Schema = wire::Schema::Dyn;
static S_EXCHANGE_RATE_INFO_OUT: wire::Schema = wire::Schema::Dyn;

/// `exchangeRateInfo` over the binary wire.
#[wasm_bindgen(js_name = "exchangeRateInfoWire")]
pub fn exchange_rate_info_wire(len: u32) -> Result<u32, JsError> {
    wire_io(len, |r, w| {
        let settings: Value = wire::read_value(r, &S_EXCHANGE_RATE_INFO_0)?;
        let references: Value = wire::read_value(r, &S_EXCHANGE_RATE_INFO_1)?;
        let now: Value = wire::read_value(r, &S_EXCHANGE_RATE_INFO_2)?;
        let out = &port::exchange_rate_info(settings, references, now)?;
        wire::write_value(w, out, &S_EXCHANGE_RATE_INFO_OUT)?;
        Ok(())
    })
}
