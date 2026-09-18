// SPDX-License-Identifier: AGPL-3.0-only
use super::{integer, report};
use crate::{codecs::parse_hex, workbench::option};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

fn signature(bytes: &[u8]) -> &'static str {
    let signatures: &[(&[u8], &str)] = &[
        (b"\x89PNG\r\n\x1a\n", "PNG"),
        (b"\xff\xd8\xff", "JPEG"),
        (b"GIF87a", "GIF87a"),
        (b"GIF89a", "GIF89a"),
        (b"%PDF-", "PDF"),
        (b"PK\x03\x04", "ZIP container"),
        (b"PK\x05\x06", "Empty ZIP container"),
        (b"\x1f\x8b", "gzip"),
        (b"7z\xbc\xaf\x27\x1c", "7-Zip"),
        (b"Rar!\x1a\x07", "RAR"),
        (b"\x7fELF", "ELF executable"),
        (b"\0asm", "WebAssembly"),
        (b"MZ", "DOS/Windows executable marker"),
        (b"SQLite format 3\0", "SQLite 3"),
        (b"fLaC", "FLAC"),
        (b"OggS", "Ogg container"),
    ];
    if bytes.starts_with(b"RIFF") {
        match bytes.get(8..12) {
            Some(b"WEBP") => return "WebP",
            Some(b"WAVE") => return "WAV",
            Some(b"AVI ") => return "AVI",
            _ => return "RIFF container",
        }
    }
    signatures
        .iter()
        .find(|(prefix, _)| bytes.starts_with(prefix))
        .map(|(_, name)| *name)
        .unwrap_or(if bytes.is_empty() {
            "Empty file"
        } else {
            "Unknown signature"
        })
}

pub(super) fn fingerprint(bytes: &[u8]) -> Result<Value, String> {
    let mut frequencies = [0usize; 256];
    for &byte in bytes {
        frequencies[byte as usize] += 1;
    }
    let entropy: f64 = frequencies
        .iter()
        .filter(|&&count| count > 0)
        .map(|&count| {
            let probability = count as f64 / bytes.len() as f64;
            -probability * probability.log2()
        })
        .sum();
    let rows = frequencies.iter().enumerate().map(|(byte, &count)| json!({
        "byte": format!("{byte:02X}"), "count": count,
        "percent": if bytes.is_empty() { 0.0 } else { count as f64 * 100.0 / bytes.len() as f64 }
    })).collect();
    let mut result = report(
        rows,
        json!({
            "bytes": bytes.len(), "signatureHint": signature(bytes),
            "sha256": hex::encode(Sha256::digest(bytes)), "entropyBitsPerByte": if bytes.is_empty() { 0.0 } else { entropy },
            "distinctByteValues": frequencies.iter().filter(|&&count| count > 0).count(),
            "first32Bytes": hex::encode(&bytes[..bytes.len().min(32)])
        }),
        "fingerprint.json",
    )?;
    let bars: Vec<_> = frequencies.chunks_exact(16).enumerate().map(|(index, counts)| json!({
        "label": format!("{:02X}–{:02X}", index * 16, index * 16 + 15), "value": counts.iter().sum::<usize>()
    })).collect();
    result["chart"] = json!({"title": "Byte distribution (16-byte groups)", "bars": bars});
    Ok(result)
}

fn printable(bytes: &[u8], offset: usize, encoding: &str) -> Option<u8> {
    let first = *bytes.get(offset)?;
    let character = match encoding {
        "ASCII" => first,
        "UTF-16LE" if bytes.get(offset + 1) == Some(&0) => first,
        "UTF-16BE" if first == 0 => *bytes.get(offset + 1)?,
        _ => return None,
    };
    (32..=126).contains(&character).then_some(character)
}

pub(super) fn strings(bytes: &[u8], options: &Value) -> Result<Value, String> {
    let minimum = integer(options, "minimum", 4, 1024)?;
    if minimum == 0 {
        return Err("Minimum length must be at least one character.".into());
    }
    let encoding = option(options, "encoding", "ASCII");
    if !["ASCII", "UTF-16LE", "UTF-16BE"].contains(&encoding) {
        return Err("Unknown string encoding.".into());
    }
    let stride = if encoding == "ASCII" { 1 } else { 2 };
    let mut offset = 0;
    let mut rows = Vec::new();
    while offset < bytes.len() && rows.len() < 2000 {
        let start = offset;
        let mut preview = String::new();
        let mut length = 0;
        while let Some(character) = printable(bytes, offset, encoding) {
            if length < 4096 {
                preview.push(character as char);
            }
            length += 1;
            offset += stride;
        }
        if length >= minimum {
            rows.push(json!({"offset": start, "offsetHex": format!("0x{start:X}"), "characters": length, "text": preview, "previewTruncated": length > 4096}));
        }
        if start == offset {
            offset += 1;
        }
    }
    report(
        rows,
        json!({"fileBytes": bytes.len(), "encoding": encoding, "scannedBytes": offset.min(bytes.len()), "scanTruncated": offset < bytes.len()}),
        "strings.json",
    )
}

pub(super) fn compare(bytes: &[u8], options: &Value) -> Result<Value, String> {
    let split = integer(options, "split", 0, bytes.len())?;
    let (before, after) = bytes.split_at(split);
    if crate::limits::over(before.len(), 8 * 1024 * 1024)
        || crate::limits::over(after.len(), 8 * 1024 * 1024)
    {
        return Err("Each file must be at most 8 MiB.".into());
    }
    let mut offset = 0;
    let mut changed = 0;
    let mut range_count = 0;
    let mut rows = Vec::new();
    let length = before.len().max(after.len());
    while offset < length {
        if before.get(offset) == after.get(offset) {
            offset += 1;
            continue;
        }
        let start = offset;
        while offset < length && before.get(offset) != after.get(offset) {
            offset += 1;
        }
        changed += offset - start;
        range_count += 1;
        if rows.len() < 2000 {
            let preview_end = offset.min(start + 32);
            rows.push(json!({
                "start": start, "endExclusive": offset, "bytes": offset - start,
                "beforeHex": hex::encode(&before[start.min(before.len())..preview_end.min(before.len())]),
                "afterHex": hex::encode(&after[start.min(after.len())..preview_end.min(after.len())]),
                "previewTruncated": offset - start > 32
            }));
        }
    }
    report(
        rows,
        json!({
            "beforeFile": option(options, "firstName", "First file"),
            "afterFile": option(options, "secondName", "Second file"),
            "beforeBytes": before.len(),
            "afterBytes": after.len(),
            "changedPositions": changed,
            "identical": changed == 0,
            "differenceRanges": range_count,
            "rangesTruncated": range_count > 2000
        }),
        "binary-diff.json",
    )
}

pub(super) fn interpret(input: &str, options: &Value) -> Result<Value, String> {
    let bytes = parse_hex(input)?;
    let offset = integer(options, "offset", 0, bytes.len())?;
    let remaining = &bytes[offset..];
    if remaining.is_empty() {
        return Err("At least one byte must remain at the chosen offset.".into());
    }
    let mut rows = Vec::new();
    for width in [1, 2, 4, 8] {
        if remaining.len() < width {
            continue;
        }
        for little_endian in [true, false] {
            let mut unsigned = 0u64;
            for index in 0..width {
                let byte = remaining[if little_endian {
                    width - index - 1
                } else {
                    index
                }];
                unsigned = unsigned << 8 | byte as u64;
            }
            let signed = ((unsigned as i64) << (64 - width * 8)) >> (64 - width * 8);
            let float = match width {
                4 => Some(f32::from_bits(unsigned as u32).to_string()),
                8 => Some(f64::from_bits(unsigned).to_string()),
                _ => None,
            };
            rows.push(json!({
                "bits": width * 8,
                "byteOrder": if little_endian { "Little-endian" } else { "Big-endian" },
                "unsigned": unsigned.to_string(),
                "signed": signed.to_string(),
                "float": float
            }));
        }
    }
    report(
        rows,
        json!({"offset": offset, "availableBytes": remaining.len(), "readBytes": hex::encode(&remaining[..remaining.len().min(8)])}),
        "byte-values.json",
    )
}
