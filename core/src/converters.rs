// SPDX-License-Identifier: AGPL-3.0-only
use serde_json::{json, Value};

pub fn run(id: &str, input: &str, option: &str) -> Option<Result<String, String>> {
    let units: &[(&str, f64)] = match id {
        "area" => &[
            ("m²", 1.0),
            ("cm²", 0.0001),
            ("km²", 1e6),
            ("hectare", 10000.0),
            ("acre", 4046.8564224),
            ("ft²", 0.09290304),
            ("in²", 0.00064516),
        ],
        "volume" => &[
            ("L", 1.0),
            ("mL", 0.001),
            ("m³", 1000.0),
            ("US gallon", 3.785411784),
            ("UK gallon", 4.54609),
            ("US cup", 0.2365882365),
            ("US fl oz", 0.0295735295625),
        ],
        "speed" => &[
            ("m/s", 1.0),
            ("km/h", 1.0 / 3.6),
            ("mph", 0.44704),
            ("knot", 1852.0 / 3600.0),
            ("ft/s", 0.3048),
        ],
        "pressure" => &[
            ("Pa", 1.0),
            ("kPa", 1000.0),
            ("MPa", 1e6),
            ("bar", 1e5),
            ("atm", 101325.0),
            ("psi", 6894.757293168),
            ("torr", 101325.0 / 760.0),
        ],
        "energy" => &[
            ("J", 1.0),
            ("kJ", 1000.0),
            ("cal", 4.184),
            ("kcal", 4184.0),
            ("Wh", 3600.0),
            ("kWh", 3.6e6),
            ("BTU (IT)", 1055.05585262),
        ],
        "power" => &[
            ("W", 1.0),
            ("kW", 1000.0),
            ("MW", 1e6),
            ("hp (mechanical)", 745.699871582),
            ("BTU/h", 1055.05585262 / 3600.0),
        ],
        "angle" => &[
            ("degrees", 1.0),
            ("radians", 180.0 / std::f64::consts::PI),
            ("turns", 360.0),
            ("gradians", 0.9),
        ],
        "frequency" => &[
            ("Hz", 1.0),
            ("kHz", 1000.0),
            ("MHz", 1e6),
            ("GHz", 1e9),
            ("rpm", 1.0 / 60.0),
        ],
        "data-rate" => &[
            ("bit/s", 1.0),
            ("kbit/s", 1000.0),
            ("Mbit/s", 1e6),
            ("Gbit/s", 1e9),
            ("MB/s", 8e6),
            ("MiB/s", 8388608.0),
        ],
        "force" => &[
            ("N", 1.0),
            ("kN", 1000.0),
            ("lbf", 4.4482216152605),
            ("kgf", 9.80665),
            ("dyn", 0.00001),
        ],
        _ => &[],
    };
    if !units.is_empty() {
        return Some((|| {
            let number = super::number(input)?;
            let scale = units
                .iter()
                .find(|(u, _)| *u == option)
                .ok_or("Select a valid input unit.")?
                .1;
            let values = units
                .iter()
                .map(|(unit, factor)| {
                    let value = number * scale / factor;
                    if !value.is_finite() {
                        return Err("Result exceeds the numeric range.");
                    }
                    Ok((unit.to_string(), json!(value)))
                })
                .collect::<Result<serde_json::Map<String, Value>, _>>()?;
            Ok(Value::Object(values).to_string())
        })());
    }
    let ids = [
        "json-to-yaml",
        "yaml-to-json",
        "json-to-toml",
        "toml-to-json",
        "yaml-to-toml",
        "toml-to-yaml",
        "json-to-jsonl",
        "jsonl-to-json",
        "csv-to-markdown",
        "rgb-to-hex",
        "hsl-to-hex",
        "unix-ms-to-date",
        "date-to-unix-ms",
        "date-offset",
        "unicode-escape",
        "unicode-unescape",
        "text-to-codepoints",
        "codepoints-to-text",
    ];
    if !ids.contains(&id) {
        return None;
    }
    Some((|| {
        Ok(match id {
            "json-to-yaml" | "json-to-toml" | "yaml-to-json" | "yaml-to-toml" | "toml-to-json"
            | "toml-to-yaml" => {
                let v: Value = if id.starts_with("json-") {
                    serde_json::from_str(input).map_err(|e| e.to_string())?
                } else if id.starts_with("yaml-") {
                    serde_yaml_ng::from_str(input).map_err(|e| e.to_string())?
                } else {
                    let t: toml::Value = toml::from_str(input).map_err(|e| e.to_string())?;
                    serde_json::to_value(t).map_err(|e| e.to_string())?
                };
                if id.ends_with("-yaml") {
                    serde_yaml_ng::to_string(&v).map_err(|e| e.to_string())?
                } else if id.ends_with("-toml") {
                    toml::to_string_pretty(&v).map_err(|e| {
                        format!("TOML requires a table and does not support null: {e}")
                    })?
                } else {
                    serde_json::to_string_pretty(&v).unwrap()
                }
            }
            "json-to-jsonl" => {
                let v: Value = serde_json::from_str(input).map_err(|e| e.to_string())?;
                v.as_array()
                    .ok_or("Enter a JSON array.")?
                    .iter()
                    .map(Value::to_string)
                    .collect::<Vec<_>>()
                    .join("\n")
            }
            "jsonl-to-json" => {
                let values = input
                    .lines()
                    .enumerate()
                    .filter(|(_, l)| !l.trim().is_empty())
                    .map(|(i, l)| {
                        serde_json::from_str::<Value>(l).map_err(|e| format!("Line {}: {e}", i + 1))
                    })
                    .collect::<Result<Vec<_>, _>>()?;
                serde_json::to_string_pretty(&values).unwrap()
            }
            "csv-to-markdown" => {
                let mut reader = csv::Reader::from_reader(input.as_bytes());
                let headers = reader.headers().map_err(|e| e.to_string())?.clone();
                let escape = |s: &str| {
                    s.replace('&', "&amp;")
                        .replace('<', "&lt;")
                        .replace('>', "&gt;")
                        .replace('\\', "\\\\")
                        .replace('|', "\\|")
                        .replace('\n', "<br>")
                        .replace('\r', "")
                };
                let line = |r: &csv::StringRecord| {
                    format!(
                        "| {} |",
                        r.iter().map(escape).collect::<Vec<_>>().join(" | ")
                    )
                };
                let mut lines = vec![
                    line(&headers),
                    format!("| {} |", vec!["---"; headers.len()].join(" | ")),
                ];
                for r in reader.records() {
                    lines.push(line(&r.map_err(|e| e.to_string())?))
                }
                lines.join("\n")
            }
            "rgb-to-hex" => {
                let n = super::nums(input)?;
                if n.len() != 3 || n.iter().any(|v| *v < 0.0 || *v > 255.0 || v.fract() != 0.0) {
                    return Err("Enter three integers from 0 to 255.".into());
                }
                format!("#{:02x}{:02x}{:02x}", n[0] as u8, n[1] as u8, n[2] as u8)
            }
            "hsl-to-hex" => {
                let n = super::nums(input)?;
                if n.len() != 3 || n[1] < 0.0 || n[1] > 100.0 || n[2] < 0.0 || n[2] > 100.0 {
                    return Err(
                        "Enter hue in degrees, saturation (0–100), and lightness (0–100).".into(),
                    );
                }
                let h = n[0].rem_euclid(360.0) / 60.0;
                let s = n[1] / 100.0;
                let l = n[2] / 100.0;
                let c = (1.0 - (2.0 * l - 1.0).abs()) * s;
                let x = c * (1.0 - (h % 2.0 - 1.0).abs());
                let (r, g, b) = match h as u8 {
                    0 => (c, x, 0.0),
                    1 => (x, c, 0.0),
                    2 => (0.0, c, x),
                    3 => (0.0, x, c),
                    4 => (x, 0.0, c),
                    _ => (c, 0.0, x),
                };
                let f = |v: f64| ((v + l - c / 2.0) * 255.0).round().clamp(0.0, 255.0) as u8;
                format!("#{:02x}{:02x}{:02x}", f(r), f(g), f(b))
            }
            "unix-ms-to-date" => {
                let t = input.trim().parse::<i64>().map_err(|e| e.to_string())?;
                chrono::DateTime::from_timestamp_millis(t)
                    .ok_or("Timestamp out of range.")?
                    .to_rfc3339()
            }
            "date-to-unix-ms" => chrono::DateTime::parse_from_rfc3339(input.trim())
                .map_err(|e| e.to_string())?
                .timestamp_millis()
                .to_string(),
            "date-offset" => {
                let d = chrono::DateTime::parse_from_rfc3339(input.trim())
                    .map_err(|e| e.to_string())?;
                let minutes = option
                    .trim()
                    .parse::<i32>()
                    .map_err(|_| "Enter an integer UTC offset in minutes.")?;
                if !(-840..=840).contains(&minutes) {
                    return Err("Offset must be between -840 and 840 minutes.".into());
                }
                d.with_timezone(&chrono::FixedOffset::east_opt(minutes * 60).unwrap())
                    .to_rfc3339()
            }
            "unicode-escape" => input
                .encode_utf16()
                .map(|n| format!("\\u{n:04x}"))
                .collect(),
            "unicode-unescape" => {
                let body = input.trim();
                if body.len() % 6 != 0 {
                    return Err(
                        "Use consecutive \\uXXXX escapes, including surrogate pairs for emoji."
                            .into(),
                    );
                }
                let mut units = Vec::new();
                for chunk in body.as_bytes().chunks(6) {
                    if &chunk[..2] != b"\\u" {
                        return Err("Use consecutive \\uXXXX escapes.".into());
                    }
                    let h = std::str::from_utf8(&chunk[2..]).map_err(|e| e.to_string())?;
                    units.push(u16::from_str_radix(h, 16).map_err(|e| e.to_string())?)
                }
                String::from_utf16(&units).map_err(|e| e.to_string())?
            }
            "text-to-codepoints" => input
                .chars()
                .map(|c| format!("U+{:04X}", c as u32))
                .collect::<Vec<_>>()
                .join(" "),
            "codepoints-to-text" => input
                .split_whitespace()
                .map(|s| {
                    let h = s
                        .strip_prefix("U+")
                        .or_else(|| s.strip_prefix("u+"))
                        .unwrap_or(s);
                    let n = u32::from_str_radix(h, 16).map_err(|e| e.to_string())?;
                    char::from_u32(n).ok_or("Invalid Unicode scalar value.".into())
                })
                .collect::<Result<String, String>>()?,
            _ => unreachable!(),
        })
    })())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn roundtrips() {
        let source = r#"{"name":"Ada","active":true,"count":3,"items":["one","two"]}"#;
        for (a, b) in [
            ("json-to-yaml", "yaml-to-json"),
            ("json-to-toml", "toml-to-json"),
        ] {
            let out = run(a, source, "").unwrap().unwrap();
            let back = run(b, &out, "").unwrap().unwrap();
            assert_eq!(
                serde_json::from_str::<Value>(source).unwrap(),
                serde_json::from_str::<Value>(&back).unwrap()
            )
        }
        let s = "A🌍中";
        assert_eq!(
            run(
                "unicode-unescape",
                &run("unicode-escape", s, "").unwrap().unwrap(),
                ""
            )
            .unwrap()
            .unwrap(),
            s
        );
        assert_eq!(
            run("rgb-to-hex", "255, 0, 128", "").unwrap().unwrap(),
            "#ff0080"
        );
        assert_eq!(
            run("hsl-to-hex", "120, 100, 50", "").unwrap().unwrap(),
            "#00ff00"
        );
        assert!(run("rgb-to-hex", "256, 0, 0", "").unwrap().is_err());
        let v: Value = serde_json::from_str(&run("speed", "36", "km/h").unwrap().unwrap()).unwrap();
        assert_eq!(v["m/s"], 10.0);
    }
}
