// SPDX-License-Identifier: AGPL-3.0-only
use crate::workbench::{code, file, option};
use base64::{engine::general_purpose as b64, Engine};
use serde_json::{json, Value};

pub fn bytes_result(bytes: &[u8]) -> Value {
    let preview = &bytes[..bytes.len().min(4096)];
    let mut v = json!({
        "kind": "code",
        "data": {
            "bytes": bytes.len(),
            "hex": hex::encode(preview),
            "base64": b64::STANDARD.encode(preview)
        },
        "files": [file("result.bin", "application/octet-stream", bytes)]
    });
    if preview.len() != bytes.len() {
        v["data"]["preview"] =
            json!("Hex and Base64 show the first 4096 bytes. Download the complete result.");
    }
    if let Ok(s) = std::str::from_utf8(bytes) {
        v["text"] = json!(s);
    } else {
        v["text"] = json!("Binary result — use the file download or byte representations below.");
    }
    v
}
pub fn parse_bytes(s: &str, format: &str) -> Result<Vec<u8>, String> {
    match format {
        "UTF-8" => Ok(s.as_bytes().to_vec()),
        "Hex" => parse_hex(s),
        "Base64" => parse_base64(s),
        _ => Err("Choose UTF-8, Hex or Base64 for raw input.".into()),
    }
}

fn parse_base64(text: &str) -> Result<Vec<u8>, String> {
    let normalized = text
        .split_whitespace()
        .collect::<String>()
        .replace('-', "+")
        .replace('_', "/");
    let config = b64::GeneralPurposeConfig::new()
        .with_decode_padding_mode(base64::engine::DecodePaddingMode::Indifferent);
    let decoder = b64::GeneralPurpose::new(&base64::alphabet::STANDARD, config);
    decoder
        .decode(normalized)
        .map_err(|error| error.to_string())
}

/// Accept the byte grouping and prefixes emitted by the output formatter.
pub fn parse_hex(text: &str) -> Result<Vec<u8>, String> {
    for prefix in ["0x", "0X", "\\x", "\\X"] {
        for (offset, _) in text.match_indices(prefix) {
            if !text
                .as_bytes()
                .get(offset + prefix.len()..offset + prefix.len() + 2)
                .is_some_and(|digits| digits.iter().all(u8::is_ascii_hexdigit))
            {
                return Err("Every hex prefix must be followed by a complete byte group.".into());
            }
        }
    }
    let without_prefixes = text
        .replace("0x", " ")
        .replace("0X", " ")
        .replace("\\x", " ")
        .replace("\\X", " ");
    let mut bytes = Vec::new();
    for group in without_prefixes
        .split(|character: char| character.is_whitespace() || matches!(character, '-' | ':' | ','))
    {
        if group.is_empty() {
            continue;
        }
        let decoded = hex::decode(group)
            .map_err(|_| "Hex groups must contain complete bytes (two digits per byte).")?;
        bytes.extend(decoded);
    }
    if bytes.is_empty() && !text.trim().is_empty() {
        return Err("Enter hex bytes, not only separators.".into());
    }
    Ok(bytes)
}
fn percent_decode(s: &str) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    let b = s.as_bytes();
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' {
            if i + 2 >= b.len() {
                return Err("Incomplete percent escape.".into());
            }
            let h = std::str::from_utf8(&b[i + 1..i + 3]).map_err(|_| "Invalid percent escape.")?;
            out.push(u8::from_str_radix(h, 16).map_err(|_| "Invalid percent escape.")?);
            i += 3;
        } else {
            out.push(b[i]);
            i += 1;
        }
    }
    Ok(out)
}
const BASE62: &[u8] = b"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const Z85: &[u8] =
    b"0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ.-:+=^!/*?&<>()[]{}@%$#";
const B91: &[u8] =
    b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!#$%&()*+,./:;<=>?@[]^_`{|}~\"";
fn radix_convert(input: &[u8], from: u32, to: u32) -> Vec<u8> {
    let mut out = vec![0u8];
    for &n in input {
        let mut carry = n as u32;
        for digit in &mut out {
            carry += *digit as u32 * from;
            *digit = (carry % to) as u8;
            carry /= to;
        }
        while carry > 0 {
            out.push((carry % to) as u8);
            carry /= to;
        }
    }
    while out.last() == Some(&0) {
        out.pop();
    }
    out.reverse();
    out
}
fn base62(input: &[u8], decode: bool) -> Result<Vec<u8>, String> {
    crate::limits::check(
        input.len(),
        if decode { 32_768 } else { 16_384 },
        "Base62 supports 16 KiB of bytes or 32 KiB of encoded text.",
    )?;
    if decode {
        let digits: Vec<u8> = input
            .iter()
            .map(|c| {
                BASE62
                    .iter()
                    .position(|x| x == c)
                    .map(|i| i as u8)
                    .ok_or("Invalid Base62 character.")
            })
            .collect::<Result<_, _>>()?;
        let zeros = digits.iter().take_while(|&&x| x == 0).count();
        let mut out = vec![0; zeros];
        out.extend(radix_convert(&digits[zeros..], 62, 256));
        Ok(out)
    } else {
        let zeros = input.iter().take_while(|&&x| x == 0).count();
        let mut out = vec![b'0'; zeros];
        out.extend(
            radix_convert(&input[zeros..], 256, 62)
                .iter()
                .map(|&i| BASE62[i as usize]),
        );
        Ok(out)
    }
}
fn base85(input: &[u8], decode: bool, z85: bool) -> Result<Vec<u8>, String> {
    if !decode {
        if z85 && input.len() % 4 != 0 {
            return Err("Z85 needs a multiple of 4 input bytes.".into());
        }
        let mut out = if z85 { vec![] } else { b"<~".to_vec() };
        for chunk in input.chunks(4) {
            let mut b = [0; 4];
            b[..chunk.len()].copy_from_slice(chunk);
            let mut n = u32::from_be_bytes(b);
            if !z85 && n == 0 && chunk.len() == 4 {
                out.push(b'z');
                continue;
            }
            let mut c = [0; 5];
            for i in (0..5).rev() {
                c[i] = if z85 {
                    Z85[(n % 85) as usize]
                } else {
                    (n % 85) as u8 + 33
                };
                n /= 85;
            }
            out.extend(&c[..chunk.len() + 1]);
        }
        if !z85 {
            out.extend(b"~>");
        }
        return Ok(out);
    }
    let trimmed = std::str::from_utf8(input)
        .map_err(|_| "Expected ASCII Base85 text.")?
        .trim();
    let body = if !z85 && trimmed.starts_with("<~") {
        trimmed
            .strip_prefix("<~")
            .unwrap()
            .strip_suffix("~>")
            .ok_or("Missing Ascii85 closing delimiter.")?
    } else {
        trimmed
    };
    let mut out = Vec::new();
    let mut group = Vec::new();
    let flush = |g: &[u8], out: &mut Vec<u8>| -> Result<(), String> {
        let mut n = 0u64;
        for &x in g {
            n = n * 85 + x as u64;
        }
        if n > u32::MAX as u64 {
            return Err("Base85 group overflows 32 bits.".into());
        }
        out.extend((n as u32).to_be_bytes());
        Ok(())
    };
    for c in body.bytes() {
        if c.is_ascii_whitespace() && !z85 {
            continue;
        }
        if c == b'z' && !z85 {
            if !group.is_empty() {
                return Err("Ascii85 z must start a block.".into());
            }
            out.extend([0; 4]);
            continue;
        }
        let n = if z85 {
            Z85.iter()
                .position(|&x| x == c)
                .ok_or("Invalid Z85 character.")? as u8
        } else {
            if !(33..=117).contains(&c) {
                return Err("Invalid Ascii85 character.".into());
            }
            c - 33
        };
        group.push(n);
        if group.len() == 5 {
            flush(&group, &mut out)?;
            group.clear();
        }
    }
    if !group.is_empty() {
        if z85 || group.len() == 1 {
            return Err("Incomplete Base85 group.".into());
        }
        let len = group.len();
        group.resize(5, 84);
        flush(&group, &mut out)?;
        out.truncate(out.len() - (5 - len));
    }
    Ok(out)
}
fn base91(input: &[u8], decode: bool) -> Result<Vec<u8>, String> {
    let (mut queue, mut bits) = (0u32, 0u32);
    let mut out = Vec::new();
    if decode {
        let mut first = None;
        for c in input {
            if c.is_ascii_whitespace() {
                continue;
            }
            let n = B91
                .iter()
                .position(|x| x == c)
                .ok_or("Invalid basE91 character.")? as u32;
            if let Some(v) = first.take() {
                let v = v + n * 91;
                queue |= v << bits;
                bits += if v & 8191 > 88 { 13 } else { 14 };
                while bits >= 8 {
                    out.push(queue as u8);
                    queue >>= 8;
                    bits -= 8;
                }
            } else {
                first = Some(n);
            }
        }
        if let Some(v) = first {
            out.push((queue | v << bits) as u8);
        }
        let canonical = base91(&out, false)?;
        let compact: Vec<_> = input
            .iter()
            .copied()
            .filter(|c| !c.is_ascii_whitespace())
            .collect();
        if canonical != compact {
            return Err("Noncanonical or incomplete basE91 input.".into());
        }
    } else {
        for &c in input {
            queue |= (c as u32) << bits;
            bits += 8;
            if bits > 13 {
                let mut v = queue & 8191;
                if v > 88 {
                    queue >>= 13;
                    bits -= 13;
                } else {
                    v = queue & 16383;
                    queue >>= 14;
                    bits -= 14;
                }
                out.push(B91[(v % 91) as usize]);
                out.push(B91[(v / 91) as usize]);
            }
        }
        if bits > 0 {
            out.push(B91[(queue % 91) as usize]);
            if bits > 7 || queue > 90 {
                out.push(B91[(queue / 91) as usize]);
            }
        }
    }
    Ok(out)
}
fn uu(input: &[u8], decode: bool) -> Result<Vec<u8>, String> {
    let symbol = |v: u8| if v == 0 { b'`' } else { v + 32 };
    if !decode {
        let mut out = b"begin 644 data.bin\n".to_vec();
        for line in input.chunks(45) {
            out.push(symbol(line.len() as u8));
            for c in line.chunks(3) {
                let mut b = [0; 3];
                b[..c.len()].copy_from_slice(c);
                out.extend([
                    symbol(b[0] >> 2),
                    symbol((b[0] << 4 | b[1] >> 4) & 63),
                    symbol((b[1] << 2 | b[2] >> 6) & 63),
                    symbol(b[2] & 63),
                ]);
            }
            out.push(b'\n');
        }
        out.extend(b"`\nend\n");
        return Ok(out);
    }
    let text = std::str::from_utf8(input).map_err(|_| "Expected uuencode text.")?;
    let mut lines = text.lines();
    let header = lines.next().ok_or("Missing uuencode header.")?;
    if !header.starts_with("begin ") {
        return Err("Expected begin header.".into());
    }
    let val = |c: u8| -> Result<u8, String> {
        if (32..=96).contains(&c) {
            Ok((c - 32) & 63)
        } else {
            Err("Invalid uuencode character.".into())
        }
    };
    let mut out = Vec::new();
    let mut ended = false;
    while let Some(line) = lines.next() {
        let b = line.as_bytes();
        if b.is_empty() {
            return Err("Missing uuencode line length.".into());
        }
        let len = val(b[0])? as usize;
        if len > 45 {
            return Err("Uuencode line exceeds 45 bytes.".into());
        }
        if len == 0 {
            if b.len() != 1 || lines.next() != Some("end") || lines.any(|s| !s.is_empty()) {
                return Err("Invalid uuencode terminator.".into());
            }
            ended = true;
            break;
        }
        if b.len() != 1 + len.div_ceil(3) * 4 {
            return Err("Uuencode line length mismatch.".into());
        }
        let start = out.len();
        for c in b[1..].chunks_exact(4) {
            let (a, b, c, d) = (val(c[0])?, val(c[1])?, val(c[2])?, val(c[3])?);
            out.extend([a << 2 | b >> 4, b << 4 | c >> 2, c << 6 | d]);
        }
        out.truncate(start + len);
    }
    if !ended {
        return Err("Missing uuencode terminator.".into());
    }
    Ok(out)
}
pub fn execute(id: &str, input: &[u8], opts: &Value) -> Result<Value, String> {
    let decode = option(opts, "mode", "Encode") == "Decode";
    crate::limits::check(
        input.len(),
        if decode {
            32 * 1024 * 1024
        } else {
            2 * 1024 * 1024
        },
        "Encode up to 2 MiB of bytes; decode an encoded file up to 32 MiB.",
    )?;
    let variant = option(opts, "variant", "Standard");
    let padded = option(opts, "padding", "Padded") == "Padded";
    let result = match id {
        "codec-base32" | "codec-crockford" => {
            let encoding = if id == "codec-crockford" {
                let mut spec = data_encoding::Specification::new();
                spec.symbols.push_str("0123456789ABCDEFGHJKMNPQRSTVWXYZ");
                spec.encoding().map_err(|e| e.to_string())?
            } else {
                match (variant, padded) {
                    ("Hex", true) => data_encoding::BASE32HEX,
                    ("Hex", false) => data_encoding::BASE32HEX_NOPAD,
                    (_, true) => data_encoding::BASE32,
                    (_, false) => data_encoding::BASE32_NOPAD,
                }
            };
            if decode {
                let mut s = input.to_vec();
                if id == "codec-crockford" {
                    s = s
                        .into_iter()
                        .filter(|&c| c != b'-')
                        .map(|c| match c.to_ascii_uppercase() {
                            b'O' => b'0',
                            b'I' | b'L' => b'1',
                            x => x,
                        })
                        .collect();
                } else {
                    s.retain(|c| !c.is_ascii_whitespace());
                }
                encoding.decode(&s).map_err(|e| e.to_string())?
            } else {
                encoding.encode(input).into_bytes()
            }
        }
        "codec-base58" => {
            crate::limits::check(
                input.len(),
                if decode { 32_768 } else { 16_384 },
                "Base58 supports 16 KiB of bytes or 32 KiB of encoded text.",
            )?;
            let alphabet = match variant {
                "Flickr" => bs58::Alphabet::FLICKR,
                "Ripple" => bs58::Alphabet::RIPPLE,
                _ => bs58::Alphabet::BITCOIN,
            };
            if decode {
                bs58::decode(input)
                    .with_alphabet(alphabet)
                    .into_vec()
                    .map_err(|e| e.to_string())?
            } else {
                bs58::encode(input)
                    .with_alphabet(alphabet)
                    .into_string()
                    .into_bytes()
            }
        }
        "codec-base62" => base62(input, decode)?,
        "codec-ascii85" => base85(input, decode, false)?,
        "codec-z85" => base85(input, decode, true)?,
        "codec-base91" => base91(input, decode)?,
        "codec-quoted-printable" => {
            if decode {
                quoted_printable::decode(input, quoted_printable::ParseMode::Strict)
                    .map_err(|e| e.to_string())?
            } else {
                quoted_printable::encode(input)
            }
        }
        "codec-uuencode" => uu(input, decode)?,
        "codec-byte-radix" => {
            let radix = option(opts, "radix", "2")
                .parse::<u32>()
                .map_err(|_| "Invalid radix.")?;
            if ![2, 8, 10, 16].contains(&radix) {
                return Err("Choose radix 2, 8, 10 or 16.".into());
            }
            if decode {
                let text = std::str::from_utf8(input).map_err(|_| "Expected radix text.")?;
                if radix == 16 {
                    parse_hex(text)?
                } else {
                    text.split_whitespace()
                        .map(|s| u8::from_str_radix(s, radix).map_err(|e| e.to_string()))
                        .collect::<Result<Vec<_>, _>>()?
                }
            } else {
                input
                    .iter()
                    .map(|c| match radix {
                        2 => format!("{c:08b}"),
                        8 => format!("{c:03o}"),
                        10 => format!("{c:03}"),
                        _ => format!("{c:02x}"),
                    })
                    .collect::<Vec<_>>()
                    .join(" ")
                    .into_bytes()
            }
        }
        "codec-percent-bytes" => {
            if decode {
                percent_decode(
                    std::str::from_utf8(input).map_err(|_| "Expected percent-encoded text.")?,
                )?
            } else {
                input
                    .iter()
                    .map(|b| format!("%{b:02X}"))
                    .collect::<String>()
                    .into_bytes()
            }
        }
        "codec-base64-bytes" => {
            let engine = match (variant, padded) {
                ("URL-safe", true) => &b64::URL_SAFE,
                ("URL-safe", false) => &b64::URL_SAFE_NO_PAD,
                (_, true) => &b64::STANDARD,
                (_, false) => &b64::STANDARD_NO_PAD,
            };
            if decode {
                engine
                    .decode(
                        input
                            .iter()
                            .copied()
                            .filter(|c| !c.is_ascii_whitespace())
                            .collect::<Vec<_>>(),
                    )
                    .map_err(|e| e.to_string())?
            } else {
                engine.encode(input).into_bytes()
            }
        }
        "codec-data-uri" => {
            if decode {
                let s = std::str::from_utf8(input)
                    .map_err(|_| "Expected data URI text.")?
                    .trim();
                let (meta, payload) = s
                    .strip_prefix("data:")
                    .ok_or("Expected data: URI.")?
                    .split_once(',')
                    .ok_or("Missing data URI comma.")?;
                let raw = percent_decode(payload)?;
                if meta.ends_with(";base64") {
                    b64::STANDARD.decode(raw).map_err(|e| e.to_string())?
                } else {
                    raw
                }
            } else {
                let mime = option(opts, "mime", "application/octet-stream");
                if mime.is_empty()
                    || !mime.is_ascii()
                    || mime
                        .chars()
                        .any(|c| c.is_whitespace() || matches!(c, ',' | '#' | '%' | '?'))
                {
                    return Err("Enter a valid media type without URI delimiters.".into());
                }
                format!("data:{mime};base64,{}", b64::STANDARD.encode(input)).into_bytes()
            }
        }
        _ => return Err("Unknown encoding.".into()),
    };
    if decode {
        let limit = if matches!(id, "codec-base58" | "codec-base62") {
            16_384
        } else {
            2 * 1024 * 1024
        };
        crate::limits::check(
            result.len(),
            limit,
            &format!("Decoded data exceeds {limit} bytes."),
        )?;
        Ok(bytes_result(&result))
    } else {
        let mut v = code(
            String::from_utf8(result.clone()).map_err(|e| e.to_string())?,
            "text",
        );
        v["files"] = json!([file("encoded.txt", "text/plain", &result)]);
        v["formatBytes"] = json!(b64::STANDARD.encode(input));
        Ok(v)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn codec_vectors() {
        for (id, plain, encoded) in [
            ("base32", "foo", "MZXW6==="),
            ("base58", "Hello World", "JxF12TrwUP45BMd"),
            ("ascii85", "Hello, world!", "<~87cURD_*#TDfTZ)+T~>"),
            ("z85", "\0\0\0\0", "00000"),
            ("base91", "Hello World!", ">OwJh>Io0Tv!8PE"),
        ] {
            let id = format!("codec-{id}");
            assert_eq!(
                execute(&id, plain.as_bytes(), &json!({})).unwrap()["text"],
                encoded
            );
            assert_eq!(
                execute(&id, encoded.as_bytes(), &json!({"mode":"Decode"})).unwrap()["text"],
                plain
            );
        }
    }
    #[test]
    fn roundtrips() {
        let mut inputs = vec![vec![], vec![0], vec![0, 0, 1], (0..=255).collect()];
        for n in 1..50 {
            inputs.push((0..n).map(|i| (i * 73) as u8).collect());
        }
        for id in [
            "base32",
            "crockford",
            "base58",
            "base62",
            "ascii85",
            "base91",
            "quoted-printable",
            "uuencode",
            "byte-radix",
            "percent-bytes",
            "base64-bytes",
            "data-uri",
        ] {
            for input in &inputs {
                let id = format!("codec-{id}");
                let e = execute(&id, input, &json!({})).unwrap();
                let d = execute(
                    &id,
                    e["text"].as_str().unwrap().as_bytes(),
                    &json!({"mode":"Decode"}),
                )
                .unwrap();
                assert_eq!(d["data"]["hex"], hex::encode(input), "{id}");
            }
        }
    }
    #[test]
    fn invalid() {
        for (id, s) in [
            ("ascii85", "!"),
            ("ascii85", "uuuuu"),
            ("z85", "abc"),
            ("base32", "MZ======"),
            ("percent-bytes", "%X0"),
            ("byte-radix", "100000000"),
            ("uuencode", "begin 644 x\n"),
            ("base91", "A"),
        ] {
            assert!(
                execute(
                    &format!("codec-{id}"),
                    s.as_bytes(),
                    &json!({"mode":"Decode"})
                )
                .is_err(),
                "{id}"
            );
        }
    }
}
