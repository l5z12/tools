// SPDX-License-Identifier: AGPL-3.0-only
mod cargo;
mod source;
mod wasm;
use serde_json::Value;

pub fn execute(id: &str, bytes: &[u8], options: &Value) -> Result<Value, String> {
    if id.starts_with("wasm-") {
        return wasm::execute(id, bytes);
    }
    let text = std::str::from_utf8(bytes).map_err(|_| "Input must be UTF-8 text.")?;
    if id.starts_with("cargo-") {
        cargo::execute(id, text, options)
    } else {
        source::execute(id, text, options)
    }
}
