// SPDX-License-Identifier: AGPL-3.0-only
use super::report;
use crate::workbench::{code, file, option};
use serde_json::{json, Value};
use std::collections::BTreeSet;

fn pointer_segment(key: &str) -> String {
    key.replace('~', "~0").replace('/', "~1")
}

fn collect_sizes(
    value: &Value,
    path: &str,
    depth: usize,
    rows: &mut Vec<Value>,
) -> Result<(), String> {
    if depth > 64 {
        return Err("JSON exceeds the maximum depth of 64.".into());
    }
    if rows.len() >= 5000 {
        return Err("JSON exceeds the 5,000-path limit.".into());
    }
    let size = serde_json::to_vec(value)
        .map_err(|error| error.to_string())?
        .len();
    let kind = match value {
        Value::Object(_) => "object",
        Value::Array(_) => "array",
        Value::String(_) => "string",
        Value::Number(_) => "number",
        Value::Bool(_) => "boolean",
        Value::Null => "null",
    };
    rows.push(json!({"pointer": path, "type": kind, "valueBytes": size}));
    match value {
        Value::Object(object) => {
            for (key, child) in object {
                collect_sizes(
                    child,
                    &format!("{path}/{}", pointer_segment(key)),
                    depth + 1,
                    rows,
                )?;
            }
        }
        Value::Array(array) => {
            for (index, child) in array.iter().enumerate() {
                collect_sizes(child, &format!("{path}/{index}"), depth + 1, rows)?;
            }
        }
        _ => {}
    }
    Ok(())
}

pub(super) fn json_size(input: &str) -> Result<Value, String> {
    let value: Value = serde_json::from_str(input).map_err(|error| error.to_string())?;
    let mut rows = Vec::new();
    collect_sizes(&value, "", 0, &mut rows)?;
    let minified_bytes = rows[0]["valueBytes"].as_u64().unwrap();
    rows.sort_by(|left, right| {
        right["valueBytes"]
            .as_u64()
            .cmp(&left["valueBytes"].as_u64())
    });
    for row in &mut rows {
        row["percentOfRoot"] =
            json!(row["valueBytes"].as_u64().unwrap() as f64 * 100.0 / minified_bytes as f64);
    }
    report(
        rows,
        json!({"originalBytes": input.len(), "minifiedBytes": minified_bytes, "note": "Parent/child sizes overlap; the empty pointer denotes the root."}),
        "json-sizes.json",
    )
}

fn replace_fields(
    value: &mut Value,
    names: &BTreeSet<String>,
    replacement: &str,
    depth: usize,
) -> Result<usize, String> {
    if depth > 64 {
        return Err("JSON exceeds the maximum depth of 64.".into());
    }
    let mut count = 0;
    match value {
        Value::Object(object) => {
            for (key, child) in object {
                if names.contains(&key.to_ascii_lowercase()) {
                    *child = json!(replacement);
                    count += 1;
                } else {
                    count += replace_fields(child, names, replacement, depth + 1)?;
                }
            }
        }
        Value::Array(array) => {
            for child in array {
                count += replace_fields(child, names, replacement, depth + 1)?;
            }
        }
        _ => {}
    }
    Ok(count)
}

pub(super) fn redact(input: &str, options: &Value) -> Result<Value, String> {
    let mut value: Value = serde_json::from_str(input).map_err(|error| error.to_string())?;
    let names: BTreeSet<_> = option(
        options,
        "keys",
        "password,token,secret,api_key,authorization,email",
    )
    .split(',')
    .map(|name| name.trim().to_ascii_lowercase())
    .filter(|name| !name.is_empty())
    .collect();
    if names.is_empty() {
        return Err("Enter at least one field name.".into());
    }
    let count = replace_fields(
        &mut value,
        &names,
        option(options, "replacement", "[REDACTED]"),
        0,
    )?;
    let text = serde_json::to_string_pretty(&value).map_err(|error| error.to_string())?;
    let mut result = code(text.clone(), "json");
    result["data"] = json!({"replacedFields": count});
    result["files"] = json!([file("redacted.json", "application/json", text.as_bytes())]);
    Ok(result)
}

#[derive(Default)]
struct ColumnProfile {
    missing: usize,
    distinct: BTreeSet<String>,
    numeric: usize,
    minimum: Option<f64>,
    maximum: Option<f64>,
}

impl ColumnProfile {
    fn add(&mut self, value: &str) {
        self.distinct.insert(value.to_string());
        if value.trim().is_empty() {
            self.missing += 1;
            return;
        }
        if let Ok(number) = value.trim().parse::<f64>() {
            if number.is_finite() {
                self.numeric += 1;
                self.minimum = Some(self.minimum.map_or(number, |current| current.min(number)));
                self.maximum = Some(self.maximum.map_or(number, |current| current.max(number)));
            }
        }
    }
}

pub(super) fn csv_profile(source: &[u8], options: &Value) -> Result<Value, String> {
    let delimiter = match option(options, "delimiter", "Comma") {
        "Comma" => b',',
        "Tab" => b'\t',
        "Semicolon" => b';',
        _ => return Err("Unknown delimiter.".into()),
    };
    if source.len() > 8 * 1024 * 1024 {
        return Err("CSV profiling is limited to 8 MiB.".into());
    }
    let mut reader = csv::ReaderBuilder::new()
        .delimiter(delimiter)
        .from_reader(source);
    let headers = reader.headers().map_err(|error| error.to_string())?.clone();
    if headers.is_empty() || headers.len() > 100 {
        return Err("CSV needs between 1 and 100 columns.".into());
    }
    let mut columns: Vec<ColumnProfile> = (0..headers.len())
        .map(|_| ColumnProfile::default())
        .collect();
    let mut count = 0;
    for record in reader.records() {
        let record = record.map_err(|error| error.to_string())?;
        count += 1;
        if count > 50_000 {
            return Err("CSV profiling is limited to 50,000 data rows.".into());
        }
        for (column, value) in columns.iter_mut().zip(record.iter()) {
            column.add(value);
        }
    }
    let rows = columns.iter().enumerate().map(|(index, column)| json!({
        "column": index + 1, "name": headers[index], "missing": column.missing,
        "present": count - column.missing, "distinctIncludingEmpty": column.distinct.len(),
        "numericValues": column.numeric, "numericMinimum": column.minimum, "numericMaximum": column.maximum
    })).collect();
    report(
        rows,
        json!({"rows": count, "columns": headers.len(), "numericPrecision": "IEEE 754 double precision; large integers may round in numeric summaries."}),
        "csv-profile.json",
    )
}
