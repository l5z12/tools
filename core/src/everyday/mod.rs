// SPDX-License-Identifier: AGPL-3.0-only
mod calculations;
mod planning;
mod text;

use serde_json::{json, Value};

pub(super) fn report(rows: Vec<Value>, summary: Value) -> Value {
    let text = serde_json::to_string_pretty(&json!({ "summary": summary, "rows": rows })).unwrap();
    json!({ "kind": "table", "rows": rows, "data": summary, "text": text })
}

pub fn execute(id: &str, source: &[u8], options: &Value) -> Result<Value, String> {
    let input = std::str::from_utf8(source)
        .map_err(|_| "Expected UTF-8 text.")?
        .trim_start_matches('\u{feff}');
    match id {
        "everyday-recipe" => calculations::recipe(input, options),
        "everyday-bill" => calculations::bill(input, options),
        "everyday-unit-price" => calculations::unit_price(input),
        "everyday-print" => calculations::print_size(options),
        "everyday-business-days" => planning::business_days(input, options),
        "everyday-timesheet" => planning::timesheet(input),
        "everyday-decision" => planning::decision(input, options),
        "everyday-calendar" => planning::calendar(input, options),
        "everyday-reading-time" => text::reading_time(input, options),
        "everyday-csv-transpose" => text::transpose(input),
        "everyday-checklist" => text::checklist(input),
        "everyday-text-wrap" => text::wrap(input, options),
        _ => Err("Unknown everyday tool.".into()),
    }
}

pub(super) fn number(value: &str, label: &str, min: f64, max: f64) -> Result<f64, String> {
    let value = value
        .trim()
        .parse::<f64>()
        .map_err(|_| format!("{label} must be a number."))?;
    if !value.is_finite() || !(min..=max).contains(&value) {
        return Err(format!("{label} must be between {min} and {max}."));
    }
    Ok(value)
}

pub(super) fn setting(
    options: &Value,
    key: &str,
    default: &str,
    min: f64,
    max: f64,
) -> Result<f64, String> {
    number(
        crate::workbench::option(options, key, default),
        key,
        min,
        max,
    )
}

pub(super) fn csv_rows(input: &str) -> Result<Vec<Vec<String>>, String> {
    let mut reader = csv::ReaderBuilder::new()
        .has_headers(false)
        .from_reader(input.as_bytes());
    let mut rows = Vec::new();
    for record in reader.records() {
        let record = record.map_err(|e| e.to_string())?;
        if rows.len() >= 10_001 || record.len() > 100 {
            return Err("Use at most 10,000 data rows and 100 columns.".into());
        }
        rows.push(record.iter().map(str::to_owned).collect());
    }
    if rows.is_empty() {
        return Err("Enter CSV data first.".into());
    }
    Ok(rows)
}

pub(super) fn named_csv(input: &str, headers: &[&str]) -> Result<Vec<Vec<String>>, String> {
    let mut rows = csv_rows(input)?;
    if rows[0].iter().map(|value| value.trim()).collect::<Vec<_>>() != headers {
        return Err(format!("Expected CSV header: {}", headers.join(",")));
    }
    rows.remove(0);
    if rows.is_empty() {
        return Err("Add at least one data row.".into());
    }
    Ok(rows)
}
