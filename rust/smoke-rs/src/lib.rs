use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn smoke_add(a: u32, b: u32) -> u32 {
    a.wrapping_add(b)
}
