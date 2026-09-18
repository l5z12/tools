// SPDX-License-Identifier: AGPL-3.0-only
use serde_json::Value;
use std::cell::Cell;
use wasm_bindgen::prelude::*;

thread_local! {
    static BYPASS: Cell<bool> = const { Cell::new(false) };
}

#[wasm_bindgen]
pub fn set_bypass_limits(enabled: bool) {
    BYPASS.with(|flag| flag.set(enabled));
}

pub fn from_options(opts: &Value) {
    set_bypass_limits(opts["bypassLimits"] == true);
}

pub fn enabled() -> bool {
    BYPASS.with(|flag| flag.get())
}

pub fn over(current: usize, max: usize) -> bool {
    !enabled() && current > max
}

pub fn at_least(current: usize, max: usize) -> bool {
    !enabled() && current >= max
}

pub fn check(current: usize, max: usize, message: &str) -> Result<(), String> {
    if over(current, max) {
        Err(message.into())
    } else {
        Ok(())
    }
}

pub fn cap(max: usize) -> usize {
    if enabled() {
        usize::MAX
    } else {
        max
    }
}
