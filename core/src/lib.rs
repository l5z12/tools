// SPDX-License-Identifier: AGPL-3.0-only
use base64::{
    engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD},
    Engine,
};
use serde_json::{json, Value};
use sha2::{Digest, Sha256, Sha512};
use std::collections::BTreeSet;
use unicode_segmentation::UnicodeSegmentation;
use wasm_bindgen::prelude::*;
mod archives;
mod browser_compute;
mod ciphers;
mod classical;
mod codecs;
mod converters;
mod cpp_tools;
mod crypto_tools;
mod dev_inspect;
mod developer;
mod everyday;
mod fingerprints;
mod hashes;
mod output_format;
mod rust_tools;
mod sql_tools;
pub use fingerprints::fingerprint_hash;
mod references;
mod utilities;
mod workbench;
mod workbench_files;
pub use references::{reference_decode, reference_load, reference_search};
pub use workbench::suite_run;
mod images;
mod raster;
pub use images::{encode_apng, transform_pixels};
pub use raster::{decode_raster, encode_raster, resize_raster, sprite_raster};
mod extra;

#[wasm_bindgen]
pub fn run(id: &str, input: &str, option: &str) -> Result<String, JsValue> {
    process(id, input, option).map_err(|e| JsValue::from_str(&e))
}
fn number(s: &str) -> Result<f64, String> {
    let n = s
        .trim()
        .parse::<f64>()
        .map_err(|_| "Enter a valid number.".to_string())?;
    if !n.is_finite() {
        return Err("Number must be finite.".into());
    }
    Ok(n)
}
fn nums(s: &str) -> Result<Vec<f64>, String> {
    let v = s
        .split(|c: char| c.is_whitespace() || c == ',')
        .filter(|s| !s.is_empty())
        .map(number)
        .collect::<Result<Vec<_>, _>>()?;
    if v.is_empty() {
        Err("Enter at least one number.".into())
    } else {
        Ok(v)
    }
}
fn words(s: &str) -> Vec<String> {
    let re = regex::Regex::new(r"([a-z0-9])([A-Z])").unwrap();
    let s = re.replace_all(s, "$1 $2");
    s.split(|c: char| !c.is_alphanumeric())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_lowercase())
        .collect()
}
fn title(s: &str) -> String {
    let mut c = s.chars();
    c.next()
        .map(|x| x.to_uppercase().collect::<String>() + c.as_str())
        .unwrap_or_default()
}
pub fn process(id: &str, s: &str, o: &str) -> Result<String, String> {
    if s.len() > 2_000_000 || o.len() > 2_000_000 {
        return Err("Input exceeds the 2 MB text limit.".into());
    }
    let err = |e: &dyn std::fmt::Display| e.to_string();
    if let Some(result) = developer::run(id, s, o) {
        return result;
    }
    if let Some(result) = converters::run(id, s, o) {
        return result;
    }
    if let Some(result) = extra::run(id, s, o) {
        return result;
    }
    let out = match id {
        "uppercase" => s.to_uppercase(),
        "lowercase" => s.to_lowercase(),
        "title-case" => words(s)
            .iter()
            .map(|w| title(w))
            .collect::<Vec<_>>()
            .join(" "),
        "sentence-case" => title(&s.to_lowercase()),
        "snake-case" => words(s).join("_"),
        "kebab-case" | "slug" => words(s).join("-"),
        "camel-case" => words(s)
            .iter()
            .enumerate()
            .map(|(i, w)| if i == 0 { w.clone() } else { title(w) })
            .collect(),
        "pascal-case" => words(s).iter().map(|w| title(w)).collect(),
        "reverse-text" => s.graphemes(true).rev().collect(),
        "trim-lines" => s.lines().map(str::trim).collect::<Vec<_>>().join("\n"),
        "collapse-whitespace" => s.split_whitespace().collect::<Vec<_>>().join(" "),
        "remove-empty-lines" => s
            .lines()
            .filter(|l| !l.trim().is_empty())
            .collect::<Vec<_>>()
            .join("\n"),
        "sort-lines" => {
            let mut v = s.lines().collect::<Vec<_>>();
            v.sort();
            v.join("\n")
        }
        "reverse-lines" => s.lines().rev().collect::<Vec<_>>().join("\n"),
        "unique-lines" => {
            let mut seen = BTreeSet::new();
            s.lines()
                .filter(|l| seen.insert(*l))
                .collect::<Vec<_>>()
                .join("\n")
        }
        "number-lines" => s
            .lines()
            .enumerate()
            .map(|(i, l)| format!("{}  {}", i + 1, l))
            .collect::<Vec<_>>()
            .join("\n"),
        "text-stats" => format!(
            "Characters: {}\nGraphemes: {}\nUTF-8 bytes: {}\nWords: {}\nLines: {}",
            s.chars().count(),
            s.graphemes(true).count(),
            s.len(),
            s.split_whitespace().count(),
            s.lines().count()
        ),
        "find-replace" => {
            let (a, b) = o
                .split_once('\n')
                .ok_or("Options: search text on first line, replacement on second line.")?;
            if a.is_empty() {
                return Err("Search text cannot be empty.".into());
            }
            s.replace(a, b)
        }
        "regex-extract" => {
            let r = regex::Regex::new(o).map_err(|e| err(&e))?;
            r.find_iter(s)
                .take(10000)
                .map(|m| m.as_str())
                .collect::<Vec<_>>()
                .join("\n")
        }
        "base64-encode" => STANDARD.encode(s),
        "base64-decode" => String::from_utf8(STANDARD.decode(s.trim()).map_err(|e| err(&e))?)
            .map_err(|e| err(&e))?,
        "base64url-encode" => URL_SAFE_NO_PAD.encode(s),
        "base64url-decode" => String::from_utf8(
            URL_SAFE_NO_PAD
                .decode(s.trim().trim_end_matches('='))
                .map_err(|e| err(&e))?,
        )
        .map_err(|e| err(&e))?,
        "hex-encode" => hex::encode(s),
        "hex-decode" => String::from_utf8(codecs::parse_hex(s)?).map_err(|e| err(&e))?,
        "url-encode" => s
            .bytes()
            .map(|b| {
                if b.is_ascii_alphanumeric() || b"-._~".contains(&b) {
                    (b as char).to_string()
                } else {
                    format!("%{b:02X}")
                }
            })
            .collect(),
        "url-decode" => {
            let b = s.as_bytes();
            let mut v = Vec::new();
            let mut i = 0;
            while i < b.len() {
                if b[i] == b'%' {
                    if i + 2 >= b.len() {
                        return Err("Incomplete percent escape.".into());
                    }
                    let h = std::str::from_utf8(&b[i + 1..i + 3]).map_err(|e| err(&e))?;
                    v.push(u8::from_str_radix(h, 16).map_err(|e| err(&e))?);
                    i += 3
                } else {
                    v.push(b[i]);
                    i += 1
                }
            }
            String::from_utf8(v).map_err(|e| err(&e))?
        }
        "html-escape" => s
            .replace('&', "&amp;")
            .replace('<', "&lt;")
            .replace('>', "&gt;")
            .replace('"', "&quot;")
            .replace('\'', "&#39;"),
        "json-escape" => serde_json::to_string(s).unwrap(),
        "json-unescape" => serde_json::from_str::<String>(s).map_err(|e| err(&e))?,
        "sha256" => hex::encode(Sha256::digest(s.as_bytes())),
        "sha512" => hex::encode(Sha512::digest(s.as_bytes())),
        "jwt-decode" => {
            let parts = s.trim().split('.').collect::<Vec<_>>();
            if parts.len() != 3 {
                return Err("Expected a three-part JWT. Signatures are not verified.".into());
            }
            let decode = |p: &str| -> Result<Value, String> {
                serde_json::from_slice(&URL_SAFE_NO_PAD.decode(p).map_err(|e| err(&e))?)
                    .map_err(|e| err(&e))
            };
            serde_json::to_string_pretty(&json!({"header":decode(parts[0])?,"payload":decode(parts[1])?,"signature_verified":false})).unwrap()
        }
        "json-format" | "json-minify" | "json-keys" | "json-to-csv" => {
            let v: Value = serde_json::from_str(s).map_err(|e| err(&e))?;
            match id {
                "json-minify" => v.to_string(),
                "json-keys" => v
                    .as_object()
                    .ok_or("Expected a JSON object.")?
                    .keys()
                    .cloned()
                    .collect::<Vec<_>>()
                    .join("\n"),
                "json-to-csv" => {
                    let rows = v.as_array().ok_or("Expected an array of objects.")?;
                    let mut keys = BTreeSet::new();
                    for row in rows {
                        keys.extend(
                            row.as_object()
                                .ok_or("Every row must be an object.")?
                                .keys()
                                .cloned(),
                        )
                    }
                    let keys = keys.into_iter().collect::<Vec<_>>();
                    let mut w = csv::Writer::from_writer(Vec::new());
                    w.write_record(&keys).map_err(|e| err(&e))?;
                    for r in rows {
                        w.write_record(keys.iter().map(|k| match &r[k] {
                            Value::Null => String::new(),
                            Value::String(x) => x.clone(),
                            x => x.to_string(),
                        }))
                        .map_err(|e| err(&e))?
                    }
                    String::from_utf8(w.into_inner().map_err(|e| err(&e))?).map_err(|e| err(&e))?
                }
                _ => serde_json::to_string_pretty(&v).unwrap(),
            }
        }
        "csv-to-json" | "csv-to-tsv" | "tsv-to-csv" => {
            let mut r = csv::ReaderBuilder::new()
                .delimiter(if id == "tsv-to-csv" { b'\t' } else { b',' })
                .from_reader(s.as_bytes());
            let headers = r.headers().map_err(|e| err(&e))?.clone();
            if headers.iter().collect::<BTreeSet<_>>().len() != headers.len() {
                return Err("Column names must be unique.".into());
            }
            let records = r
                .records()
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| err(&e))?;
            if id == "csv-to-json" {
                let values = records
                    .iter()
                    .map(|r| {
                        Value::Object(
                            headers
                                .iter()
                                .zip(r.iter())
                                .map(|(k, v)| (k.into(), Value::String(v.into())))
                                .collect(),
                        )
                    })
                    .collect::<Vec<_>>();
                serde_json::to_string_pretty(&values).unwrap()
            } else {
                let mut w = csv::WriterBuilder::new()
                    .delimiter(if id == "csv-to-tsv" { b'\t' } else { b',' })
                    .from_writer(Vec::new());
                w.write_record(&headers).map_err(|e| err(&e))?;
                for r in records {
                    w.write_record(&r).map_err(|e| err(&e))?
                }
                String::from_utf8(w.into_inner().map_err(|e| err(&e))?).map_err(|e| err(&e))?
            }
        }
        "url-inspect" | "query-to-json" => {
            let u = url::Url::parse(s.trim()).map_err(|e| err(&e))?;
            let v = if id == "query-to-json" {
                let mut m = serde_json::Map::new();
                for (k, v) in u.query_pairs() {
                    m.entry(k.to_string())
                        .or_insert(json!([]))
                        .as_array_mut()
                        .unwrap()
                        .push(json!(v))
                }
                Value::Object(m)
            } else {
                json!({"scheme":u.scheme(),"host":u.host_str(),"port":u.port_or_known_default(),"path":u.path(),"query":u.query(),"fragment":u.fragment()})
            };
            serde_json::to_string_pretty(&v).unwrap()
        }
        "base-convert" => {
            let base = o.trim().parse::<u32>().map_err(|e| err(&e))?;
            if !(2..=36).contains(&base) {
                return Err("Input base must be 2–36.".into());
            }
            let n = i128::from_str_radix(s.trim(), base).map_err(|e| err(&e))?;
            let sign = if n < 0 { "-" } else { "" };
            let v = n.unsigned_abs();
            format!(
                "Binary: {sign}{v:b}\nOctal: {sign}{v:o}\nDecimal: {n}\nHexadecimal: {sign}{v:X}"
            )
        }
        "statistics" => {
            let mut v = nums(s)?;
            v.sort_by(f64::total_cmp);
            let sum: f64 = v.iter().sum();
            let mean = sum / v.len() as f64;
            let med = if v.len() % 2 == 0 {
                (v[v.len() / 2 - 1] + v[v.len() / 2]) / 2.0
            } else {
                v[v.len() / 2]
            };
            format!("Count: {}\nSum: {sum}\nMean: {mean}\nMedian: {med}\nMin: {}\nMax: {}\nPopulation standard deviation: {}",v.len(),v[0],v[v.len()-1],(v.iter().map(|x|(x-mean).powi(2)).sum::<f64>()/v.len() as f64).sqrt())
        }
        "percentage" => {
            let v = nums(s)?;
            if v.len() != 2 {
                return Err("Enter percentage, then value.".into());
            }
            format!("{}", v[0] * v[1] / 100.0)
        }
        "percentage-change" => {
            let v = nums(s)?;
            if v.len() != 2 || v[0] == 0.0 {
                return Err("Enter a nonzero old value, then new value.".into());
            }
            format!("{}%", (v[1] - v[0]) / v[0].abs() * 100.0)
        }
        "gcd-lcm" => {
            let v = s
                .split_whitespace()
                .map(str::parse::<u64>)
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| err(&e))?;
            if v.len() != 2 {
                return Err("Enter two nonnegative integers.".into());
            }
            let (mut a, mut b) = (v[0], v[1]);
            while b != 0 {
                (a, b) = (b, a % b)
            }
            let l = if a == 0 {
                0
            } else {
                (v[0] / a)
                    .checked_mul(v[1])
                    .ok_or("LCM exceeds 64-bit range.")?
            };
            format!("GCD: {a}\nLCM: {l}")
        }
        "temperature" => {
            let n = number(s)?;
            let c = match o.trim() {
                "C" => n,
                "F" => (n - 32.0) * 5.0 / 9.0,
                "K" => n - 273.15,
                _ => return Err("Unit must be C, F, or K.".into()),
            };
            if c < -273.15 {
                return Err("Temperature is below absolute zero.".into());
            }
            format!(
                "Celsius: {c}\nFahrenheit: {}\nKelvin: {}",
                c * 9.0 / 5.0 + 32.0,
                c + 273.15
            )
        }
        "length" | "mass" | "bytes" | "duration" => {
            let units: Vec<(&str, f64)> = match id {
                "length" => vec![
                    ("mm", 0.001),
                    ("cm", 0.01),
                    ("m", 1.0),
                    ("km", 1000.0),
                    ("in", 0.0254),
                    ("ft", 0.3048),
                    ("yd", 0.9144),
                    ("mi", 1609.344),
                ],
                "mass" => vec![
                    ("mg", 0.000001),
                    ("g", 0.001),
                    ("kg", 1.0),
                    ("oz", 0.028349523125),
                    ("lb", 0.45359237),
                ],
                "duration" => vec![
                    ("ms", 0.001),
                    ("s", 1.0),
                    ("min", 60.0),
                    ("h", 3600.0),
                    ("d", 86400.0),
                ],
                _ => vec![
                    ("B", 1.0),
                    ("KB", 1e3),
                    ("MB", 1e6),
                    ("GB", 1e9),
                    ("KiB", 1024.0),
                    ("MiB", 1048576.0),
                    ("GiB", 1073741824.0),
                ],
            };
            let n = number(s)?
                * units
                    .iter()
                    .find(|(u, _)| *u == o.trim())
                    .ok_or("Unknown input unit; use one of the units in the instructions.")?
                    .1;
            units
                .iter()
                .map(|(u, f)| format!("{u}: {}", n / f))
                .collect::<Vec<_>>()
                .join("\n")
        }
        "unix-to-date" => {
            let t = s.trim().parse::<i64>().map_err(|e| err(&e))?;
            chrono::DateTime::from_timestamp(t, 0)
                .ok_or("Timestamp out of range.")?
                .to_rfc3339()
        }
        "date-to-unix" => chrono::DateTime::parse_from_rfc3339(s.trim())
            .map_err(|e| err(&e))?
            .timestamp()
            .to_string(),
        "date-difference" => {
            let a = chrono::NaiveDate::parse_from_str(s.trim(), "%Y-%m-%d").map_err(|e| err(&e))?;
            let b = chrono::NaiveDate::parse_from_str(o.trim(), "%Y-%m-%d").map_err(|e| err(&e))?;
            format!("{} days", (b - a).num_days())
        }
        "date-add" => {
            let a = chrono::NaiveDate::parse_from_str(s.trim(), "%Y-%m-%d").map_err(|e| err(&e))?;
            let n = o.trim().parse::<i64>().map_err(|e| err(&e))?;
            a.checked_add_signed(chrono::Duration::try_days(n).ok_or("Day count out of range.")?)
                .ok_or("Date out of range.")?
                .to_string()
        }
        "color-convert" => {
            let h = s.trim().trim_start_matches('#');
            let h = if h.len() == 3 {
                h.chars().flat_map(|c| [c, c]).collect::<String>()
            } else {
                h.into()
            };
            let v = hex::decode(h).map_err(|e| err(&e))?;
            if v.len() != 3 {
                return Err("Enter a 3- or 6-digit hex color.".into());
            }
            let (r, g, b) = (
                v[0] as f64 / 255.0,
                v[1] as f64 / 255.0,
                v[2] as f64 / 255.0,
            );
            let max = r.max(g).max(b);
            let min = r.min(g).min(b);
            let d = max - min;
            let l = (max + min) / 2.0;
            let hue = if d == 0.0 {
                0.0
            } else if max == r {
                60.0 * ((g - b) / d).rem_euclid(6.0)
            } else if max == g {
                60.0 * ((b - r) / d + 2.0)
            } else {
                60.0 * ((r - g) / d + 4.0)
            };
            let sat = if d == 0.0 {
                0.0
            } else {
                d / (1.0 - (2.0 * l - 1.0).abs())
            };
            format!(
                "HEX: #{}\nRGB: rgb({}, {}, {})\nHSL: hsl({:.1}, {:.1}%, {:.1}%)",
                hex::encode(&v),
                v[0],
                v[1],
                v[2],
                hue,
                sat * 100.0,
                l * 100.0
            )
        }
        _ => return Err("Unknown tool.".into()),
    };
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn encoding_roundtrips() {
        for s in ["", "Hello 🌍", "a+b /?&=\n", "é中"] {
            for (a, b) in [
                ("base64-encode", "base64-decode"),
                ("base64url-encode", "base64url-decode"),
                ("hex-encode", "hex-decode"),
                ("url-encode", "url-decode"),
                ("json-escape", "json-unescape"),
            ] {
                assert_eq!(process(b, &process(a, s, "").unwrap(), "").unwrap(), s)
            }
        }
    }
    #[test]
    fn known_answers() {
        assert_eq!(
            process("sha256", "abc", "").unwrap(),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        assert_eq!(process("reverse-text", "a👨‍👩‍👧é", "").unwrap(), "é👨‍👩‍👧a");
        assert_eq!(
            process("date-add", "2024-02-28", "1").unwrap(),
            "2024-02-29"
        );
        assert_eq!(
            process("date-to-unix", "1970-01-01T00:00:00Z", "").unwrap(),
            "0"
        );
        assert!(process("url-decode", "%XX", "").is_err());
        assert!(process("temperature", "-274", "C").is_err());
    }
    #[test]
    fn csv_quoting() {
        let s = "name,note\nAda,\"Hello, world\"\nBob,\"two\nlines\"\n";
        let json = process("csv-to-json", s, "").unwrap();
        let csv = process("json-to-csv", &json, "").unwrap();
        assert_eq!(process("csv-to-json", &csv, "").unwrap(), json);
    }
}
