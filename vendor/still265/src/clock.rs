// SPDX-License-Identifier: GPL-2.0-or-later
// Native statistics retain wall-clock timing. Browser workers do not expose
// std::time::Instant; timing statistics are unused by our WASM encoder.
#[cfg(not(target_arch = "wasm32"))]
pub(crate) use std::time::Instant;

#[cfg(target_arch = "wasm32")]
#[derive(Clone, Copy)]
pub(crate) struct Instant;

#[cfg(target_arch = "wasm32")]
impl Instant {
    pub(crate) fn now() -> Self {
        Self
    }
    pub(crate) fn elapsed(&self) -> std::time::Duration {
        std::time::Duration::ZERO
    }
}
