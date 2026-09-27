# still265 0.6.0

Source: https://crates.io/crates/still265/0.6.0

Vendored under the accompanying GPL-2.0-or-later license. This encoder is compiled into the application's Rust WASM module.

Local browser adaptations:

- Route profiling timers through `clock.rs`. Native builds use the standard clock; WASM builds disable timing statistics because `std::time::Instant` panics on wasm32-unknown-unknown. Encoding decisions do not use these statistics.
- Use one encoder thread on wasm32, inside the application's existing image worker.

The HEVC encoder and HEIF writer algorithms are unchanged. Only the `std` feature is enabled in the application's Cargo dependency; optional SIMD and Rayon features are disabled.
