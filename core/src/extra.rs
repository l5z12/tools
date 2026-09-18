// SPDX-License-Identifier: AGPL-3.0-only
use serde_json::{json, Value};
use std::{collections::BTreeMap, net::Ipv4Addr};
fn color(s: &str) -> Result<[u8; 3], String> {
    let h = s.trim().trim_start_matches('#');
    let h = if h.len() == 3 {
        h.chars().flat_map(|c| [c, c]).collect::<String>()
    } else {
        h.into()
    };
    let v = hex::decode(h).map_err(|_| "Enter a 3- or 6-digit hex color.")?;
    v.try_into()
        .map_err(|_| "Enter a 3- or 6-digit hex color.".into())
}
fn luminance(c: [u8; 3]) -> f64 {
    let v = c.map(|x| {
        let n = x as f64 / 255.0;
        if n <= 0.04045 {
            n / 12.92
        } else {
            ((n + 0.055) / 1.055).powf(2.4)
        }
    });
    v[0] * 0.2126 + v[1] * 0.7152 + v[2] * 0.0722
}
fn flatten(v: &Value, p: String, out: &mut BTreeMap<String, Value>) {
    match v {
        Value::Object(m) if !m.is_empty() => {
            for (k, v) in m {
                flatten(
                    v,
                    format!("{p}/{}", k.replace('~', "~0").replace('/', "~1")),
                    out,
                )
            }
        }
        Value::Array(a) if !a.is_empty() => {
            for (i, v) in a.iter().enumerate() {
                flatten(v, format!("{p}/{i}"), out)
            }
        }
        _ => {
            out.insert(p, v.clone());
        }
    }
}
pub fn run(id: &str, s: &str, o: &str) -> Option<Result<String, String>> {
    let ids = [
        "qr-code",
        "markdown-preview",
        "contrast",
        "palette",
        "json-flatten",
        "json-pointer",
        "json-merge",
        "word-frequency",
        "line-diff",
        "rot13",
        "binary-encode",
        "binary-decode",
        "ipv4-subnet",
        "aspect-ratio",
        "date-inspect",
        "uuid-inspect",
        "url-builder",
        "html-preview",
        "json-table",
        "roman-numeral",
        "prime-factors",
        "sort-numbers",
    ];
    if !ids.contains(&id) {
        return None;
    }
    Some((|| {
        Ok(match id {
            "qr-code" => {
                if s.is_empty() {
                    return Err("Enter text or a URL.".into());
                }
                qrcode::QrCode::new(s)
                    .map_err(|e| e.to_string())?
                    .render::<qrcode::render::svg::Color>()
                    .min_dimensions(320, 320)
                    .build()
            }
            "markdown-preview" => {
                let parser = pulldown_cmark::Parser::new_ext(
                    s,
                    pulldown_cmark::Options::ENABLE_TABLES
                        | pulldown_cmark::Options::ENABLE_STRIKETHROUGH
                        | pulldown_cmark::Options::ENABLE_TASKLISTS,
                );
                let mut out = String::new();
                pulldown_cmark::html::push_html(&mut out, parser);
                out
            }
            "html-preview" => s.to_string(),
            "contrast" => {
                let a = color(s)?;
                let b = color(o)?;
                let l1 = luminance(a);
                let l2 = luminance(b);
                let ratio = (l1.max(l2) + 0.05) / (l1.min(l2) + 0.05);
                json!({"foreground":format!("#{}",hex::encode(a)),"background":format!("#{}",hex::encode(b)),"ratio":ratio,"AA normal":ratio>=4.5,"AA large":ratio>=3.0,"AAA normal":ratio>=7.0,"AAA large":ratio>=4.5}).to_string()
            }
            "palette" => {
                let c = color(s)?;
                let shades = (-4..=4)
                    .map(|i| {
                        let f = i as f64 / 5.0;
                        let rgb = c.map(|v| {
                            if f < 0.0 {
                                (v as f64 * (1.0 + f)).round() as u8
                            } else {
                                (v as f64 + (255.0 - v as f64) * f).round() as u8
                            }
                        });
                        format!("#{}", hex::encode(rgb))
                    })
                    .collect::<Vec<_>>();
                json!(shades).to_string()
            }
            "json-flatten" => {
                let v: Value = serde_json::from_str(s).map_err(|e| e.to_string())?;
                let mut map = BTreeMap::new();
                flatten(&v, String::new(), &mut map);
                serde_json::to_string_pretty(&map).unwrap()
            }
            "json-pointer" => {
                let v: Value = serde_json::from_str(s).map_err(|e| e.to_string())?;
                serde_json::to_string_pretty(
                    v.pointer(o)
                        .ok_or("Pointer did not match a value. Use /key/0 syntax.")?,
                )
                .unwrap()
            }
            "json-merge" => {
                let mut a: Value = serde_json::from_str(s).map_err(|e| e.to_string())?;
                let b: Value = serde_json::from_str(o).map_err(|e| e.to_string())?;
                let m = a
                    .as_object_mut()
                    .ok_or("Both inputs must be JSON objects.")?;
                m.extend(
                    b.as_object()
                        .ok_or("Both inputs must be JSON objects.")?
                        .clone(),
                );
                serde_json::to_string_pretty(&a).unwrap()
            }
            "json-table" => {
                let v: Value = serde_json::from_str(s).map_err(|e| e.to_string())?;
                let rows = v.as_array().ok_or("Enter an array of objects.")?;
                if rows.iter().any(|r| !r.is_object()) {
                    return Err("Each row must be an object.".into());
                }
                v.to_string()
            }
            "word-frequency" => {
                let mut map = BTreeMap::new();
                for w in super::words(s) {
                    *map.entry(w).or_insert(0usize) += 1;
                }
                let mut rows = map.into_iter().collect::<Vec<_>>();
                rows.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
                json!(rows
                    .into_iter()
                    .map(|(word, count)| json!({"word":word,"count":count}))
                    .collect::<Vec<_>>())
                .to_string()
            }
            "line-diff" => {
                let a = s.lines().collect::<Vec<_>>();
                let b = o.lines().collect::<Vec<_>>();
                if crate::limits::over(a.len(), 10_000)
                    || crate::limits::over(b.len(), 10_000)
                    || crate::limits::over(a.len().saturating_mul(b.len()), 1_000_000)
                {
                    return Err("Comparison is limited to one million line pairs.".into());
                }
                let mut dp = vec![vec![0; b.len() + 1]; a.len() + 1];
                for i in (0..a.len()).rev() {
                    for j in (0..b.len()).rev() {
                        dp[i][j] = if a[i] == b[j] {
                            1 + dp[i + 1][j + 1]
                        } else {
                            dp[i + 1][j].max(dp[i][j + 1])
                        };
                    }
                }
                let (mut i, mut j) = (0, 0);
                let mut rows = Vec::new();
                while i < a.len() || j < b.len() {
                    if i < a.len() && j < b.len() && a[i] == b[j] {
                        rows.push(json!({"kind":"same","text":a[i]}));
                        i += 1;
                        j += 1
                    } else if i < a.len() && (j == b.len() || dp[i + 1][j] >= dp[i][j + 1]) {
                        rows.push(json!({"kind":"removed","text":a[i]}));
                        i += 1
                    } else {
                        rows.push(json!({"kind":"added","text":b[j]}));
                        j += 1
                    }
                }
                json!(rows).to_string()
            }
            "rot13" => s
                .chars()
                .map(|c| match c {
                    'a'..='z' => (b'a' + (c as u8 - b'a' + 13) % 26) as char,
                    'A'..='Z' => (b'A' + (c as u8 - b'A' + 13) % 26) as char,
                    _ => c,
                })
                .collect(),
            "binary-encode" => s
                .bytes()
                .map(|b| format!("{b:08b}"))
                .collect::<Vec<_>>()
                .join(" "),
            "binary-decode" => {
                let v = s
                    .split_whitespace()
                    .map(|b| {
                        if b.len() != 8 {
                            return Err("Each group must contain eight binary digits.".to_string());
                        }
                        u8::from_str_radix(b, 2).map_err(|e| e.to_string())
                    })
                    .collect::<Result<Vec<_>, _>>()?;
                String::from_utf8(v).map_err(|e| e.to_string())?
            }
            "ipv4-subnet" => {
                let (ip, p) = s
                    .trim()
                    .split_once('/')
                    .ok_or("Enter an IPv4 address with a CIDR prefix, such as 192.168.1.12/24.")?;
                let ip = ip.parse::<Ipv4Addr>().map_err(|e| e.to_string())?;
                let p = p.parse::<u32>().map_err(|e| e.to_string())?;
                if p > 32 {
                    return Err("Prefix must be 0–32.".into());
                }
                let mask = if p == 0 { 0 } else { u32::MAX << (32 - p) };
                let network = u32::from(ip) & mask;
                let broadcast = network | !mask;
                json!({"Address":ip.to_string(),"Network":format!("{}/{p}",Ipv4Addr::from(network)),"Netmask":Ipv4Addr::from(mask).to_string(),"Last address":Ipv4Addr::from(broadcast).to_string(),"Total addresses":1u64<<(32-p)}).to_string()
            }
            "aspect-ratio" => {
                let v = super::nums(s)?;
                if v.len() != 2
                    || v.iter()
                        .any(|n| *n < 1.0 || *n > 1_000_000.0 || n.fract() != 0.0)
                {
                    return Err(
                        "Enter two positive integer dimensions, at most 1,000,000 each.".into(),
                    );
                }
                let (mut a, mut b) = (v[0] as u64, v[1] as u64);
                while b != 0 {
                    (a, b) = (b, a % b)
                }
                json!({"width":v[0],"height":v[1],"ratio":format!("{}:{}",v[0]as u64/a,v[1]as u64/a),"decimal":v[0]/v[1]}).to_string()
            }
            "date-inspect" => {
                use chrono::Datelike;
                let d = chrono::NaiveDate::parse_from_str(s.trim(), "%Y-%m-%d")
                    .map_err(|e| e.to_string())?;
                json!({"Date":d.to_string(),"Weekday":d.format("%A").to_string(),"Day of year":d.ordinal(),"ISO week":d.iso_week().week(),"ISO week year":d.iso_week().year(),"Leap year":chrono::NaiveDate::from_ymd_opt(d.year(),2,29).is_some()}).to_string()
            }
            "uuid-inspect" => {
                let h = s.trim().replace('-', "");
                let v = hex::decode(h).map_err(|e| e.to_string())?;
                if v.len() != 16 {
                    return Err("A UUID must have 32 hexadecimal digits.".into());
                }
                json!({"Hex":hex::encode(&v),"Version nibble":v[6]>>4,"RFC variant":(v[8]&0xc0)==0x80,"Nil":v.iter().all(|b|*b==0)}).to_string()
            }
            "url-builder" => {
                let mut u = url::Url::parse(s.trim()).map_err(|e| e.to_string())?;
                let v: Value = serde_json::from_str(o).map_err(|e| e.to_string())?;
                let m = v.as_object().ok_or("Parameters must be a JSON object.")?;
                {
                    let mut pairs = u.query_pairs_mut();
                    for (k, v) in m {
                        match v {
                            Value::Array(a) => {
                                for x in a {
                                    pairs.append_pair(k, &value_text(x));
                                }
                            }
                            _ => {
                                pairs.append_pair(k, &value_text(v));
                            }
                        }
                    }
                }
                u.to_string()
            }
            "roman-numeral" => {
                let mut n = s.trim().parse::<u32>().map_err(|e| e.to_string())?;
                if !(1..=3999).contains(&n) {
                    return Err("Enter an integer from 1 to 3999.".into());
                }
                let mut out = String::new();
                for (v, r) in [
                    (1000, "M"),
                    (900, "CM"),
                    (500, "D"),
                    (400, "CD"),
                    (100, "C"),
                    (90, "XC"),
                    (50, "L"),
                    (40, "XL"),
                    (10, "X"),
                    (9, "IX"),
                    (5, "V"),
                    (4, "IV"),
                    (1, "I"),
                ] {
                    while n >= v {
                        out.push_str(r);
                        n -= v
                    }
                }
                out
            }
            "prime-factors" => {
                let mut n = s.trim().parse::<u64>().map_err(|e| e.to_string())?;
                if !(2..=1_000_000_000_000).contains(&n) {
                    return Err("Enter an integer from 2 to 1,000,000,000,000.".into());
                }
                let mut factors = Vec::new();
                let mut d = 2;
                while d <= n / d {
                    while n % d == 0 {
                        factors.push(d);
                        n /= d
                    }
                    d += if d == 2 { 1 } else { 2 };
                }
                if n > 1 {
                    factors.push(n)
                }
                factors
                    .iter()
                    .map(u64::to_string)
                    .collect::<Vec<_>>()
                    .join(" × ")
            }
            "sort-numbers" => {
                let mut v = super::nums(s)?;
                v.sort_by(f64::total_cmp);
                v.iter().map(f64::to_string).collect::<Vec<_>>().join("\n")
            }
            _ => unreachable!(),
        })
    })())
}
fn value_text(v: &Value) -> String {
    v.as_str()
        .map(str::to_string)
        .unwrap_or_else(|| v.to_string())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn answers() {
        assert_eq!(
            run("roman-numeral", "1994", "").unwrap().unwrap(),
            "MCMXCIV"
        );
        assert_eq!(
            run("prime-factors", "360", "").unwrap().unwrap(),
            "2 × 2 × 2 × 3 × 3 × 5"
        );
        let v: Value =
            serde_json::from_str(&run("contrast", "#000", "#fff").unwrap().unwrap()).unwrap();
        assert_eq!(v["ratio"], 21.0);
        let v: Value =
            serde_json::from_str(&run("ipv4-subnet", "192.168.1.12/24", "").unwrap().unwrap())
                .unwrap();
        assert_eq!(v["Network"], "192.168.1.0/24");
        assert!(run("qr-code", "hello", "")
            .unwrap()
            .unwrap()
            .contains("<svg"));
    }
}
