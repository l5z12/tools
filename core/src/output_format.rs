// SPDX-License-Identifier: AGPL-3.0-only
use crate::workbench::{code, option};
use base64::{engine::general_purpose, Engine};
use serde_json::Value;

fn setting(options: &Value, name: &str, default: usize) -> Result<usize, String> {
    match options.get(name) {
        None => Ok(default),
        Some(value) => value
            .as_u64()
            .and_then(|n| usize::try_from(n).ok())
            .ok_or_else(|| format!("{name} must be a nonnegative integer.")),
    }
}

fn hex_output(bytes: &[u8], options: &Value, c_array: bool) -> Result<String, String> {
    let group = if c_array {
        1
    } else {
        setting(options, "groupBytes", 1)?
    };
    let width = if c_array {
        0
    } else {
        setting(options, "lineBytes", 0)?
    };
    let prefix = if c_array {
        "0x"
    } else {
        option(options, "prefix", "")
    };
    let separator = if c_array {
        ", "
    } else {
        option(options, "separator", "")
    };
    if prefix.len() > 8 || separator.len() > 8 {
        return Err("Prefix and separator must be at most 8 bytes.".into());
    }
    let uppercase = options["uppercase"].as_bool().unwrap_or(false);
    let lines = bytes
        .chunks(if width == 0 {
            bytes.len().max(1)
        } else {
            width
        })
        .map(|line| {
            line.chunks(group)
                .map(|group| {
                    let encoded = if uppercase {
                        hex::encode_upper(group)
                    } else {
                        hex::encode(group)
                    };
                    format!("{prefix}{encoded}")
                })
                .collect::<Vec<_>>()
                .join(separator)
        })
        .collect::<Vec<_>>()
        .join("\n");
    Ok(if c_array {
        format!("{{ {lines} }}")
    } else {
        lines
    })
}

pub fn execute(bytes: &[u8], options: &Value) -> Result<Value, String> {
    crate::limits::check(
        bytes.len(),
        2 * 1024 * 1024,
        "Output formatting supports up to 2 MiB. Use Original for this larger result.",
    )?;
    if !(1..=64).contains(&setting(options, "groupBytes", 1)?) {
        return Err("Group size must be 1–64 bytes.".into());
    }
    if ![0, 8, 16, 32, 64].contains(&setting(options, "lineBytes", 0)?) {
        return Err("Invalid bytes-per-line setting.".into());
    }
    let wrap = setting(options, "wrap", 0)?;
    if ![0, 64, 76].contains(&wrap) {
        return Err("Invalid Base64 line width.".into());
    }
    let mode = option(options, "mode", "Original");
    let text = match mode {
        "Hex" => hex_output(bytes, options, false)?,
        "C byte array" => hex_output(bytes, options, true)?,
        "Base64" | "Base64url" => {
            let padding = options["padding"].as_bool().unwrap_or(true);
            let encoder = match (mode, padding) {
                ("Base64url", true) => &general_purpose::URL_SAFE,
                ("Base64url", false) => &general_purpose::URL_SAFE_NO_PAD,
                (_, true) => &general_purpose::STANDARD,
                (_, false) => &general_purpose::STANDARD_NO_PAD,
            };
            let encoded = encoder.encode(bytes);
            if wrap == 0 {
                encoded
            } else {
                encoded
                    .as_bytes()
                    .chunks(wrap)
                    .map(|line| std::str::from_utf8(line).unwrap())
                    .collect::<Vec<_>>()
                    .join("\n")
            }
        }
        "Binary" | "Octal" | "Decimal" => bytes
            .iter()
            .map(|byte| match mode {
                "Binary" => format!("{byte:08b}"),
                "Octal" => format!("{byte:03o}"),
                _ => format!("{byte:03}"),
            })
            .collect::<Vec<_>>()
            .join(" "),
        "UTF-8" => std::str::from_utf8(bytes)
            .map_err(|_| "These bytes are not valid UTF-8. Choose a byte format.")?
            .to_owned(),
        "JSON byte array" => serde_json::to_string(bytes).map_err(|error| error.to_string())?,
        _ => return Err("Original output is supplied by the tool, not the byte formatter.".into()),
    };
    Ok(code(text, "text"))
}
