// SPDX-License-Identifier: AGPL-3.0-only
mod binary;
mod cbor;
mod documents;
mod json_keys;
mod msgpack;
mod protocols;

use crate::workbench::{data, option};
use serde_json::{json, Value};

pub fn execute(id: &str, source: &[u8], options: &Value) -> Result<Value, String> {
    if source.len() > 8 * 1024 * 1024 {
        return Err("These inspectors accept up to 8 MiB.".into());
    }
    if matches!(
        id,
        "dev-msgpack-inspect" | "dev-cbor-inspect" | "dev-protobuf"
    ) {
        let bytes = if options["fileProvided"] == true {
            source.to_vec()
        } else {
            let text = utf8(source)?;
            let compact: String = text.chars().filter(|ch| !ch.is_whitespace()).collect();
            hex::decode(compact)
                .map_err(|_| "Enter hexadecimal byte pairs, or choose a binary file.")?
        };
        return match id {
            "dev-protobuf" => binary::protobuf(&bytes),
            _ => binary::inspect(id, &bytes),
        };
    }
    let text = utf8(source)?;
    match id {
        "dev-json-msgpack" | "dev-json-cbor" => binary::encode(id, text),
        "dev-har" => protocols::har(text),
        "dev-sse" => protocols::sse(text),
        "dev-source-map" => documents::source_map(source, options),
        "dev-git-patch" => documents::git_patch(text),
        "dev-permissions" => permissions(text),
        "dev-json-keys" => json_keys::inspect(text),
        "dev-merge-patch" => {
            let mut document: Value = serde_json::from_str(text).map_err(|e| e.to_string())?;
            let patch: Value = serde_json::from_str(option(options, "patch", "{}"))
                .map_err(|e| format!("Patch: {e}"))?;
            json_patch::merge(&mut document, &patch);
            Ok(crate::workbench::code(
                serde_json::to_string_pretty(&document).unwrap(),
                "json",
            ))
        }
        _ => Err("Unknown developer inspector.".into()),
    }
}

fn utf8(bytes: &[u8]) -> Result<&str, String> {
    std::str::from_utf8(bytes)
        .map(|text| text.strip_prefix('\u{feff}').unwrap_or(text))
        .map_err(|_| "Expected UTF-8 text.".into())
}

fn permissions(text: &str) -> Result<Value, String> {
    let mode = text.trim();
    if !(3..=4).contains(&mode.len()) || !mode.bytes().all(|byte| (b'0'..=b'7').contains(&byte)) {
        return Err("Enter three or four octal digits, such as 755 or 4755.".into());
    }
    let bits = u16::from_str_radix(mode, 8).map_err(|e| e.to_string())?;
    let mut symbolic = String::new();
    let mut classes = Vec::new();
    for (name, shift, special) in [
        ("owner", 6, 0o4000),
        ("group", 3, 0o2000),
        ("other", 0, 0o1000),
    ] {
        let read = bits & (4 << shift) != 0;
        let write = bits & (2 << shift) != 0;
        let execute = bits & (1 << shift) != 0;
        symbolic.push(if read { 'r' } else { '-' });
        symbolic.push(if write { 'w' } else { '-' });
        symbolic.push(match (bits & special != 0, execute, shift == 0) {
            (true, true, false) => 's',
            (true, false, false) => 'S',
            (true, true, true) => 't',
            (true, false, true) => 'T',
            (false, true, _) => 'x',
            (false, false, _) => '-',
        });
        classes.push(json!({ "class": name, "read": read, "write": write, "execute": execute }));
    }
    Ok(data(json!({
        "octal": format!("{bits:04o}"), "symbolic": symbolic, "classes": classes,
        "setuid": bits & 0o4000 != 0, "setgid": bits & 0o2000 != 0, "sticky": bits & 0o1000 != 0,
    })))
}
