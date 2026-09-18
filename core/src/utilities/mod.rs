// SPDX-License-Identifier: AGPL-3.0-only
mod binary;
mod data;
mod subtitles;
mod text;
mod web;

use crate::workbench::file;
use serde_json::{json, Value};

pub fn execute(id: &str, input: &str, source: &[u8], options: &Value) -> Result<Value, String> {
    match id {
        "util-file-fingerprint" => binary::fingerprint(source),
        "util-binary-strings" => binary::strings(source, options),
        "util-binary-diff" => binary::compare(source, options),
        "util-byte-order" => binary::interpret(input, options),
        "util-line-sets" => text::line_sets(input, options),
        "util-json-size" => data::json_size(input),
        "util-json-redact" => data::redact(input, options),
        "util-csv-profile" => data::csv_profile(source, options),
        "util-log-patterns" => text::log_patterns(utf8(source)?),
        "util-clean-urls" => web::clean_urls(input, options),
        "util-subtitle-shift" => subtitles::shift(utf8(source)?, options),
        "util-ip-range" => web::ip_range(input, options),
        _ => Err("Unknown utility.".into()),
    }
}

fn utf8(source: &[u8]) -> Result<&str, String> {
    std::str::from_utf8(source)
        .map(|text| text.trim_start_matches('\u{feff}'))
        .map_err(|_| "Expected a UTF-8 file; use the file encoding converter first.".into())
}

fn integer(options: &Value, key: &str, default: usize, maximum: usize) -> Result<usize, String> {
    let value = match options[key].as_str() {
        Some(text) => text
            .parse::<usize>()
            .map_err(|_| format!("{key} must be a nonnegative integer."))?,
        None => options[key].as_u64().unwrap_or(default as u64) as usize,
    };
    if value > maximum && !crate::limits::enabled() {
        return Err(format!("{key} must be at most {maximum}."));
    }
    Ok(value)
}

fn report(rows: Vec<Value>, summary: Value, filename: &str) -> Result<Value, String> {
    let text = serde_json::to_string_pretty(&json!({"summary": summary, "rows": rows}))
        .map_err(|error| error.to_string())?;
    Ok(json!({
        "kind": "table", "rows": rows, "data": summary, "text": text,
        "files": [file(filename, "application/json", text.as_bytes())]
    }))
}
