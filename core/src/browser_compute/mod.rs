// SPDX-License-Identifier: AGPL-3.0-only
mod jwt;
mod rsa;
mod svg;

use crate::workbench::code;
use rand::{rngs::OsRng, RngCore};
use serde_json::Value;
use sha2::{Digest, Sha256};

pub fn execute(id: &str, input: &str, bytes: &[u8], opts: &Value) -> Result<Value, String> {
    match id {
        "jwt-verify" => jwt::verify(input, opts),
        "crypto-keypair" => rsa::keypair(),
        "crypto-rsa-oaep" => rsa::execute(input, opts),
        "svg-optimizer" => svg::optimize(input),
        "file-sha256" => Ok(code(hex::encode(Sha256::digest(bytes)), "text")),
        "uuid" | "password" => {
            let count: usize = input
                .trim()
                .parse()
                .map_err(|_| "Enter a positive whole number.")?;
            if count == 0 || crate::limits::over(count, if id == "uuid" { 100 } else { 256 }) {
                return Err("Requested count exceeds the tool limit.".into());
            }
            let mut random = vec![0; if id == "uuid" { count * 16 } else { count }];
            OsRng.fill_bytes(&mut random);
            let output = if id == "uuid" {
                random
                    .chunks_mut(16)
                    .map(|bytes| {
                        bytes[6] = (bytes[6] & 15) | 64;
                        bytes[8] = (bytes[8] & 63) | 128;
                        let hex = hex::encode(bytes);
                        format!(
                            "{}-{}-{}-{}-{}",
                            &hex[..8],
                            &hex[8..12],
                            &hex[12..16],
                            &hex[16..20],
                            &hex[20..]
                        )
                    })
                    .collect::<Vec<_>>()
                    .join("\n")
            } else {
                const ALPHABET: &[u8] =
                    b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
                random
                    .iter()
                    .map(|b| ALPHABET[(b & 63) as usize] as char)
                    .collect()
            };
            Ok(code(output, "text"))
        }
        _ => Err("Unknown WASM operation.".into()),
    }
}
