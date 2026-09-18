// SPDX-License-Identifier: AGPL-3.0-only
// FingerprintJS 3.4.2 and CreepJS compatibility; upstream MIT notices in vendor/.
use sha2::{Digest, Sha256};
use wasm_bindgen::prelude::*;

fn avalanche(mut value: u64) -> u64 {
    value ^= value >> 33;
    value = value.wrapping_mul(0xff51afd7ed558ccd);
    value ^= value >> 33;
    value = value.wrapping_mul(0xc4ceb9fe1a85ec53);
    value ^ (value >> 33)
}

/// Preserve upstream's UTF-16 length and its different block/tail character handling.
fn fingerprintjs(input: &str) -> String {
    let units: Vec<u16> = input.encode_utf16().collect();
    let (mut first, mut second) = (0u64, 0u64);
    let first_constant = 0x87c37b91114253d5;
    let second_constant = 0x4cf5ad432745937f;
    let mix_first = |value: u64| {
        value
            .wrapping_mul(first_constant)
            .rotate_left(31)
            .wrapping_mul(second_constant)
    };
    let mix_second = |value: u64| {
        value
            .wrapping_mul(second_constant)
            .rotate_left(33)
            .wrapping_mul(first_constant)
    };
    let mut blocks = units.chunks_exact(16);
    for block in &mut blocks {
        let mut words = [0u64; 2];
        for (index, &unit) in block.iter().enumerate() {
            words[index / 8] |= ((unit & 255) as u64) << ((index % 8) * 8);
        }
        first ^= mix_first(words[0]);
        first = first
            .rotate_left(27)
            .wrapping_add(second)
            .wrapping_mul(5)
            .wrapping_add(0x52dce729);
        second ^= mix_second(words[1]);
        second = second
            .rotate_left(31)
            .wrapping_add(first)
            .wrapping_mul(5)
            .wrapping_add(0x38495ab5);
    }
    let tail = blocks.remainder();
    let mut words = [0u64; 2];
    for (index, &unit) in tail.iter().enumerate() {
        words[index / 8] ^= (unit as u64) << ((index % 8) * 8);
    }
    if tail.len() > 8 {
        second ^= mix_second(words[1]);
    }
    if !tail.is_empty() {
        first ^= mix_first(words[0]);
    }
    first ^= units.len() as u64;
    second ^= units.len() as u64;
    first = first.wrapping_add(second);
    second = second.wrapping_add(first);
    first = avalanche(first);
    second = avalanche(second);
    first = first.wrapping_add(second);
    second = second.wrapping_add(first);
    format!("{first:016x}{second:016x}")
}

#[wasm_bindgen]
pub fn fingerprint_hash(kind: &str, input: &str) -> Result<String, JsValue> {
    if input.len() > 16 * 1024 * 1024 {
        return Err(JsValue::from_str("Fingerprint input exceeds 16 MiB."));
    }
    match kind {
        "fingerprintjs-3.4.2" => Ok(fingerprintjs(input)),
        "creep-mini" => {
            let hash = input.encode_utf16().fold(0x811c9dc5u32, |hash, unit| {
                hash.wrapping_mul(31).wrapping_add(unit as u32)
            });
            Ok(format!("{hash:08x}"))
        }
        "sha256" => Ok(hex::encode(Sha256::digest(input.as_bytes()))),
        _ => Err(JsValue::from_str("Unknown fingerprint hash format.")),
    }
}
