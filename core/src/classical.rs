// SPDX-License-Identifier: AGPL-3.0-only
use crate::{
    codecs::{bytes_result, parse_bytes},
    workbench::{code, option},
};
use serde_json::Value;
pub(super) fn number(o: &Value, k: &str, d: &str, min: i64, max: i64) -> Result<i64, String> {
    let n = option(o, k, d)
        .parse::<i64>()
        .map_err(|_| format!("{k} must be an integer."))?;
    if !(min..=max).contains(&n) {
        return Err(format!("{k} must be between {min} and {max}."));
    }
    Ok(n)
}
pub(super) fn letters(s: &str) -> Vec<u8> {
    s.bytes()
        .filter(u8::is_ascii_alphabetic)
        .map(|b| b.to_ascii_uppercase() - b'A')
        .collect()
}
pub(super) fn key(s: &str) -> Result<Vec<u8>, String> {
    if s.is_empty() || !s.bytes().all(|c| c.is_ascii_alphabetic()) {
        Err("Key must contain only A–Z letters and cannot be empty.".into())
    } else {
        Ok(letters(s))
    }
}
pub(super) fn mapped(s: &str, mut f: impl FnMut(i64) -> i64) -> String {
    s.chars()
        .map(|c| {
            if c.is_ascii_alphabetic() {
                let base = if c.is_ascii_uppercase() { b'A' } else { b'a' };
                (base + f((c as u8 - base) as i64).rem_euclid(26) as u8) as char
            } else {
                c
            }
        })
        .collect()
}
pub(super) fn square(keyword: &str) -> Vec<u8> {
    let mut out = vec![];
    for b in letters(keyword).into_iter().chain(0..26) {
        let b = if b == 9 { 8 } else { b };
        if !out.contains(&b) {
            out.push(b);
        }
    }
    out
}
pub(super) fn normalized(s: &str) -> Vec<u8> {
    letters(s)
        .into_iter()
        .map(|b| if b == 9 { 8 } else { b })
        .collect()
}
pub(super) fn transpose(s: &str, order: &[usize], decrypt: bool) -> String {
    let chars: Vec<char> = s.chars().collect();
    let n = chars.len();
    let width = order.len();
    if !decrypt {
        order
            .iter()
            .flat_map(|&col| (col..n).step_by(width).map(|i| chars[i]))
            .collect()
    } else {
        let mut result = vec![' '; n];
        let mut offset = 0;
        for &col in order {
            for i in (col..n).step_by(width) {
                result[i] = chars[offset];
                offset += 1;
            }
        }
        result.into_iter().collect()
    }
}
const MORSE: &[(&str, &str)] = &[
    ("A", ".-"),
    ("B", "-..."),
    ("C", "-.-."),
    ("D", "-.."),
    ("E", "."),
    ("F", "..-."),
    ("G", "--."),
    ("H", "...."),
    ("I", ".."),
    ("J", ".---"),
    ("K", "-.-"),
    ("L", ".-.."),
    ("M", "--"),
    ("N", "-."),
    ("O", "---"),
    ("P", ".--."),
    ("Q", "--.-"),
    ("R", ".-."),
    ("S", "..."),
    ("T", "-"),
    ("U", "..-"),
    ("V", "...-"),
    ("W", ".--"),
    ("X", "-..-"),
    ("Y", "-.--"),
    ("Z", "--.."),
    ("0", "-----"),
    ("1", ".----"),
    ("2", "..---"),
    ("3", "...--"),
    ("4", "....-"),
    ("5", "....."),
    ("6", "-...."),
    ("7", "--..."),
    ("8", "---.."),
    ("9", "----."),
    (".", ".-.-.-"),
    (",", "--..--"),
    ("?", "..--.."),
    ("'", ".----."),
    ("!", "-.-.--"),
    ("/", "-..-."),
    ("(", "-.--."),
    (")", "-.--.-"),
    ("&", ".-..."),
    (":", "---..."),
    (";", "-.-.-."),
    ("=", "-...-"),
    ("+", ".-.-."),
    ("-", "-....-"),
    ("_", "..--.-"),
    ("\"", ".-..-."),
    ("$", "...-..-"),
    ("@", ".--.-."),
];
const NATO:&str="Alfa Bravo Charlie Delta Echo Foxtrot Golf Hotel India Juliett Kilo Lima Mike November Oscar Papa Quebec Romeo Sierra Tango Uniform Victor Whiskey X-ray Yankee Zulu Zero One Two Three Four Five Six Seven Eight Nine";
fn message(id: &str, s: &str, decrypt: bool) -> Result<String, String> {
    let pairs: Vec<(String, String)> = match id {
        "cipher-morse" => MORSE.iter().map(|&(a, b)| (a.into(), b.into())).collect(),
        "cipher-nato" => "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
            .chars()
            .zip(NATO.split_whitespace())
            .map(|(a, b)| (a.to_string(), b.into()))
            .collect(),
        _ => ('A'..='Z')
            .enumerate()
            .map(|(i, c)| (c.to_string(), (i + 1).to_string()))
            .collect(),
    };
    if decrypt {
        s.split_whitespace()
            .map(|v| {
                if v == "/" {
                    Ok(" ".to_string())
                } else {
                    pairs
                        .iter()
                        .find(|(_, b)| b.eq_ignore_ascii_case(v))
                        .map(|(a, _)| a.clone())
                        .ok_or_else(|| format!("Unsupported symbol: {v}"))
                }
            })
            .collect()
    } else {
        s.chars()
            .map(|c| {
                if c == ' ' {
                    Ok("/".to_string())
                } else {
                    let upper = c.to_ascii_uppercase().to_string();
                    pairs
                        .iter()
                        .find(|(a, _)| a == &upper)
                        .map(|(_, b)| b.clone())
                        .ok_or_else(|| format!("Unsupported character: {c}"))
                }
            })
            .collect::<Result<Vec<_>, _>>()
            .map(|v| v.join(" "))
    }
}
pub fn execute(id: &str, s: &str, o: &Value) -> Result<Value, String> {
    let decrypt = option(o, "mode", "Encrypt") == "Decrypt";
    let keyword = option(o, "key", "");
    let text = match id {
        "cipher-caesar" => {
            let n = number(o, "shift", "3", -1_000_000, 1_000_000)?;
            mapped(s, |v| v + if decrypt { -n } else { n })
        }
        "cipher-rot47" => s
            .chars()
            .map(|c| {
                if ('!'..='~').contains(&c) {
                    (33 + (c as u8 - 33 + 47) % 94) as char
                } else {
                    c
                }
            })
            .collect(),
        "cipher-atbash" => mapped(s, |v| 25 - v),
        "cipher-vigenere" | "cipher-beaufort" | "cipher-autokey" => {
            let mut stream = key(keyword)?;
            let mut i = 0;
            let autokey = id == "cipher-autokey";
            mapped(s, |v| {
                let k = stream[if autokey { i } else { i % stream.len() }] as i64;
                let result = if id == "cipher-beaufort" {
                    k - v
                } else if decrypt {
                    v - k
                } else {
                    v + k
                };
                if autokey {
                    stream.push(if decrypt { result.rem_euclid(26) } else { v } as u8);
                }
                i += 1;
                result
            })
        }
        "cipher-affine" => {
            let a = number(o, "a", "5", -1_000_000, 1_000_000)?.rem_euclid(26);
            let b = number(o, "b", "8", -1_000_000, 1_000_000)?;
            let inv = (0..26)
                .find(|v| (v * a) % 26 == 1)
                .ok_or("Multiplier must be coprime to 26.")?;
            mapped(s, |v| if decrypt { inv * (v - b) } else { a * v + b })
        }
        "cipher-substitution" => {
            let a = key(option(o, "alphabet", "QWERTYUIOPASDFGHJKLZXCVBNM"))?;
            let mut sorted = a.clone();
            sorted.sort();
            if sorted != (0..26).collect::<Vec<_>>() {
                return Err("Cipher alphabet must contain A–Z exactly once.".into());
            }
            mapped(s, |v| {
                if decrypt {
                    a.iter().position(|&n| n == v as u8).unwrap() as i64
                } else {
                    a[v as usize] as i64
                }
            })
        }
        "cipher-rail-fence" => {
            let rails = number(o, "rails", "3", 2, 100)? as usize;
            let chars: Vec<_> = s.chars().collect();
            let path: Vec<_> = (0..chars.len())
                .map(|i| {
                    let v = i % (2 * rails - 2);
                    if v < rails {
                        v
                    } else {
                        2 * rails - 2 - v
                    }
                })
                .collect();
            let mut out = vec![];
            if !decrypt {
                for row in 0..rails {
                    for (i, &p) in path.iter().enumerate() {
                        if p == row {
                            out.push(chars[i]);
                        }
                    }
                }
            } else {
                out = vec![' '; chars.len()];
                let mut offset = 0;
                for row in 0..rails {
                    for (i, &p) in path.iter().enumerate() {
                        if p == row {
                            out[i] = chars[offset];
                            offset += 1;
                        }
                    }
                }
            }
            out.into_iter().collect()
        }
        "cipher-columnar" | "cipher-scytale" => {
            let order = if id == "cipher-scytale" {
                (0..number(o, "columns", "4", 1, 1000)? as usize).collect::<Vec<_>>()
            } else {
                let k = key(keyword)?;
                crate::limits::check(k.len(), 1000, "Keyword is limited to 1000 letters.")?;
                let mut order: Vec<usize> = (0..k.len()).collect();
                order.sort_by_key(|&i| k[i]);
                order
            };
            transpose(s, &order, decrypt)
        }
        "cipher-playfair" | "cipher-polybius" | "cipher-bifid" => {
            let sq = square(keyword);
            let pos = |c: u8| sq.iter().position(|&b| b == c).unwrap();
            let input = normalized(s);
            let mut out = vec![];
            if id == "cipher-polybius" {
                if !decrypt {
                    return Ok(code(
                        input
                            .iter()
                            .map(|&c| {
                                let p = pos(c);
                                format!("{}{}", p / 5 + 1, p % 5 + 1)
                            })
                            .collect::<Vec<_>>()
                            .join(" "),
                        "text",
                    ));
                }
                let digits: Vec<_> = s.bytes().filter(|c| !c.is_ascii_whitespace()).collect();
                if digits.len() % 2 != 0 || !digits.iter().all(|b| (b'1'..=b'5').contains(b)) {
                    return Err("Expected coordinate pairs 11–55.".into());
                }
                for p in digits.chunks_exact(2) {
                    out.push(sq[((p[0] - b'1') * 5 + p[1] - b'1') as usize]);
                }
            } else if id == "cipher-bifid" {
                let period = number(o, "period", "5", 1, 1000)? as usize;
                for block in input.chunks(period) {
                    let n = block.len();
                    if decrypt {
                        let coords: Vec<_> = block
                            .iter()
                            .flat_map(|&c| {
                                let p = pos(c);
                                [p / 5, p % 5]
                            })
                            .collect();
                        for i in 0..n {
                            out.push(sq[coords[i] * 5 + coords[n + i]]);
                        }
                    } else {
                        let coords: Vec<_> = block
                            .iter()
                            .map(|&c| pos(c) / 5)
                            .chain(block.iter().map(|&c| pos(c) % 5))
                            .collect();
                        for p in coords.chunks_exact(2) {
                            out.push(sq[p[0] * 5 + p[1]]);
                        }
                    }
                }
            } else {
                let pairs = if decrypt {
                    if input.len() % 2 != 0 {
                        return Err("Playfair ciphertext needs an even letter count.".into());
                    }
                    input
                } else {
                    let mut pairs = vec![];
                    let mut i = 0;
                    while i < input.len() {
                        let a = input[i];
                        pairs.push(a);
                        if i + 1 == input.len() || input[i + 1] == a {
                            pairs.push(if a == 23 { 16 } else { 23 });
                            i += 1;
                        } else {
                            pairs.push(input[i + 1]);
                            i += 2;
                        }
                    }
                    pairs
                };
                for pair in pairs.chunks_exact(2) {
                    let (a, b) = (pos(pair[0]), pos(pair[1]));
                    let (ar, ac, br, bc) = (a / 5, a % 5, b / 5, b % 5);
                    let step = if decrypt { 4 } else { 1 };
                    let (x, y) = if ar == br {
                        (ar * 5 + (ac + step) % 5, br * 5 + (bc + step) % 5)
                    } else if ac == bc {
                        (((ar + step) % 5) * 5 + ac, ((br + step) % 5) * 5 + bc)
                    } else {
                        (ar * 5 + bc, br * 5 + ac)
                    };
                    out.extend([sq[x], sq[y]]);
                }
            }
            out.into_iter().map(|b| (b + b'A') as char).collect()
        }
        "cipher-bacon" => {
            let a = if option(o, "variant", "26 letters").starts_with("24") {
                b"ABCDEFGHIKLMNOPQRSTUWXYZ".as_slice()
            } else {
                b"ABCDEFGHIJKLMNOPQRSTUVWXYZ".as_slice()
            };
            if decrypt {
                let b: Vec<_> = s
                    .bytes()
                    .filter(|b| !b.is_ascii_whitespace())
                    .map(|b| b.to_ascii_uppercase())
                    .collect();
                if b.len() % 5 != 0 || b.iter().any(|&b| b != b'A' && b != b'B') {
                    return Err("Expected groups of five A/B symbols.".into());
                }
                let mut out = String::new();
                for g in b.chunks_exact(5) {
                    let n = g.iter().fold(0, |v, &c| v * 2 + usize::from(c == b'B'));
                    out.push(*a.get(n).ok_or("Bacon group exceeds the alphabet.")? as char);
                }
                out
            } else {
                letters(s)
                    .iter()
                    .map(|&b| {
                        let mut c = b + b'A';
                        if a.len() == 24 {
                            c = match c {
                                b'J' => b'I',
                                b'V' => b'U',
                                x => x,
                            };
                        }
                        let n = a.iter().position(|&v| v == c).unwrap();
                        (0..5)
                            .rev()
                            .map(|i| if (n >> i) & 1 == 0 { 'A' } else { 'B' })
                            .collect::<String>()
                    })
                    .collect::<Vec<_>>()
                    .join(" ")
            }
        }
        "cipher-morse" | "cipher-nato" | "cipher-a1z26" => message(id, s, decrypt)?,
        "cipher-xor" => {
            let k = parse_bytes(keyword, "Hex")?;
            if k.is_empty() {
                return Err("XOR key cannot be empty.".into());
            }
            let bytes = parse_bytes(s, option(o, "inputFormat", "UTF-8"))?;
            return Ok(bytes_result(
                &bytes
                    .iter()
                    .enumerate()
                    .map(|(i, b)| b ^ k[i % k.len()])
                    .collect::<Vec<_>>(),
            ));
        }
        _ => return crate::ciphers::execute(id, s, o),
    };
    Ok(code(text, "text"))
}
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn vectors() {
        for (id, s, o, expected) in [
            ("caesar", "Attack at Dawn!", json!({}), "Dwwdfn dw Gdzq!"),
            (
                "vigenere",
                "ATTACKATDAWN",
                json!({"key":"LEMON"}),
                "LXFOPVEFRNHR",
            ),
            (
                "autokey",
                "ATTACKATDAWN",
                json!({"key":"QUEENLY"}),
                "QNXEPVYTWTWP",
            ),
            ("affine", "AFFINE CIPHER", json!({}), "IHHWVC SWFRCP"),
            (
                "rail-fence",
                "WEAREDISCOVEREDFLEEATONCE",
                json!({}),
                "WECRLTEERDSOEEFEAOCAIVDEN",
            ),
            (
                "playfair",
                "HIDETHEGOLDINTHETREESTUMP",
                json!({"key":"PLAYFAIREXAMPLE"}),
                "BMODZBXDNABEKUDMUIXMMOUVIF",
            ),
            ("bifid", "FLEEATONCE", json!({"period":"5"}), "HAAEVSLDSP"),
        ] {
            assert_eq!(
                execute(&format!("cipher-{id}"), s, &o).unwrap()["text"],
                expected,
                "{id}"
            );
        }
    }
    #[test]
    fn roundtrips() {
        for id in [
            "caesar",
            "rot47",
            "atbash",
            "vigenere",
            "beaufort",
            "autokey",
            "affine",
            "substitution",
            "rail-fence",
            "columnar",
            "scytale",
        ] {
            for s in ["", "A", "Hello 🌏, punctuation!", "ATTACKATDAWN"] {
                let mut o = json!({"key":"BANANA"});
                let id = format!("cipher-{id}");
                let encrypted = execute(&id, s, &o).unwrap();
                o["mode"] = json!("Decrypt");
                assert_eq!(
                    execute(&id, encrypted["text"].as_str().unwrap(), &o).unwrap()["text"],
                    s,
                    "{id}"
                );
            }
        }
        for id in ["bifid", "polybius", "bacon", "morse", "nato", "a1z26"] {
            let s = "HELLOWORLD";
            let mut o = json!({});
            let id = format!("cipher-{id}");
            let e = execute(&id, s, &o).unwrap();
            o["mode"] = json!("Decrypt");
            assert_eq!(
                execute(&id, e["text"].as_str().unwrap(), &o).unwrap()["text"],
                s
            );
        }
    }
}
