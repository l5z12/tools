// SPDX-License-Identifier: AGPL-3.0-only
use super::report;
use crate::workbench::{code, file, option};
use regex::Regex;
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};

fn unique_lines(
    input: &str,
    trim: bool,
    ignore_case: bool,
) -> Result<Vec<(String, String)>, String> {
    let mut seen = BTreeSet::new();
    let mut entries = Vec::new();
    for (index, line) in input.lines().enumerate() {
        if index >= 50_000 {
            return Err("Lists are limited to 50,000 lines each.".into());
        }
        let spelling = if trim { line.trim() } else { line };
        if spelling.trim().is_empty() {
            continue;
        }
        let key = if ignore_case {
            spelling.to_ascii_lowercase()
        } else {
            spelling.to_string()
        };
        if seen.insert(key.clone()) {
            entries.push((key, spelling.to_string()));
        }
    }
    Ok(entries)
}

pub(super) fn line_sets(input: &str, options: &Value) -> Result<Value, String> {
    let trim = options["trim"].as_bool().unwrap_or(true);
    let ignore_case = options["ignoreCase"].as_bool().unwrap_or(false);
    let first = unique_lines(input, trim, ignore_case)?;
    let second = unique_lines(option(options, "other", ""), trim, ignore_case)?;
    let first_keys: BTreeSet<_> = first.iter().map(|(key, _)| key.as_str()).collect();
    let second_keys: BTreeSet<_> = second.iter().map(|(key, _)| key.as_str()).collect();
    let operation = option(options, "operation", "Intersection");
    if ![
        "Intersection",
        "Union",
        "Only first",
        "Only second",
        "Symmetric difference",
    ]
    .contains(&operation)
    {
        return Err("Unknown set operation.".into());
    }
    let mut output = Vec::new();
    for (key, spelling) in &first {
        let include = match operation {
            "Intersection" => second_keys.contains(key.as_str()),
            "Union" => true,
            "Only first" | "Symmetric difference" => !second_keys.contains(key.as_str()),
            _ => false,
        };
        if include {
            output.push(spelling.clone());
        }
    }
    if ["Union", "Only second", "Symmetric difference"].contains(&operation) {
        for (key, spelling) in &second {
            if !first_keys.contains(key.as_str()) {
                output.push(spelling.clone());
            }
        }
    }
    let text = output.join("\n");
    let mut result = code(text.clone(), "text");
    result["data"] = json!({"firstDistinct": first.len(), "secondDistinct": second.len(), "resultEntries": output.len()});
    result["files"] = json!([file("list-result.txt", "text/plain", text.as_bytes())]);
    Ok(result)
}

struct LogPattern {
    count: usize,
    first: usize,
    last: usize,
    example: String,
}

pub(super) fn log_patterns(input: &str) -> Result<Value, String> {
    let timestamp =
        Regex::new(r"\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?")
            .unwrap();
    let uuid = Regex::new(r"(?i)\b[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\b").unwrap();
    let number = Regex::new(r"\b\d+(?:\.\d+)?\b").unwrap();
    let mut patterns: BTreeMap<String, LogPattern> = BTreeMap::new();
    let mut count = 0;
    for (index, line) in input.lines().enumerate() {
        if index >= 50_000 {
            return Err("Log analysis is limited to 50,000 lines.".into());
        }
        if line.trim().is_empty() {
            continue;
        }
        count += 1;
        let pattern = timestamp.replace_all(line, "<time>");
        let pattern = uuid.replace_all(&pattern, "<uuid>");
        let pattern = number.replace_all(&pattern, "<number>").into_owned();
        let entry = patterns.entry(pattern).or_insert_with(|| LogPattern {
            count: 0,
            first: index + 1,
            last: index + 1,
            example: line.chars().take(2048).collect(),
        });
        entry.count += 1;
        entry.last = index + 1;
        if patterns.len() > 5000 {
            return Err("Log analysis is limited to 5,000 distinct patterns.".into());
        }
    }
    let mut groups: Vec<_> = patterns.into_iter().collect();
    groups.sort_by(|left, right| {
        right
            .1
            .count
            .cmp(&left.1.count)
            .then_with(|| left.0.cmp(&right.0))
    });
    let rows = groups
        .iter()
        .map(|(pattern, entry)| {
            json!({
                "occurrences": entry.count,
                "firstLine": entry.first,
                "lastLine": entry.last,
                "pattern": pattern,
                "example": entry.example
            })
        })
        .collect();
    report(
        rows,
        json!({"nonemptyLines": count, "patterns": groups.len(), "exampleLimitCharacters": 2048}),
        "log-patterns.json",
    )
}
