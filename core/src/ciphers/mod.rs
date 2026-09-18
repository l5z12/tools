// SPDX-License-Identifier: AGPL-3.0-only
//! Additional classical ciphers. Each family owns its validation and algorithm.

mod fractionation;
mod polyalphabetic;
mod polygraphic;
mod rc4;

use crate::workbench::{code, option};
use serde_json::Value;

pub fn execute(id: &str, input: &str, options: &Value) -> Result<Value, String> {
    let decrypt = option(options, "mode", "Encrypt") == "Decrypt";
    let keyword = option(options, "key", "");

    let output = match id {
        "cipher-gronsfeld" => polyalphabetic::gronsfeld(input, keyword, decrypt)?,
        "cipher-running-key" => polyalphabetic::running_key(input, keyword, decrypt)?,
        "cipher-trithemius" => polyalphabetic::trithemius(input, options, decrypt)?,
        "cipher-hill" => polygraphic::hill(input, options, decrypt)?,
        "cipher-four-square" => polygraphic::four_square(input, options, decrypt)?,
        "cipher-adfgx" => fractionation::adfgx(input, options, decrypt, false)?,
        "cipher-adfgvx" => fractionation::adfgx(input, options, decrypt, true)?,
        "cipher-trifid" => fractionation::trifid(input, options, decrypt)?,
        "cipher-nihilist" => fractionation::nihilist(input, options, decrypt)?,
        "cipher-rc4" => return rc4::run(input, options, decrypt),
        _ => return Err("Unknown cipher.".into()),
    };
    Ok(code(output, "text"))
}

/// Retain the first occurrence of each valid keyword symbol, then fill the rest.
fn keyed_alphabet(keyword: &str, alphabet: &str) -> Vec<u8> {
    let mut symbols = Vec::with_capacity(alphabet.len());
    for symbol in keyword
        .bytes()
        .map(|c| c.to_ascii_uppercase())
        .chain(alphabet.bytes())
    {
        if alphabet.as_bytes().contains(&symbol) && !symbols.contains(&symbol) {
            symbols.push(symbol);
        }
    }
    symbols
}

#[cfg(test)]
mod tests;
