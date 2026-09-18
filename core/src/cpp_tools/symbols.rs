// SPDX-License-Identifier: AGPL-3.0-only
use crate::workbench::table;
use regex::Regex;
use serde_json::{json, Value};

pub fn demangle(input: &str) -> Result<Value, String> {
    let mut rows = Vec::new();
    for symbol in input.lines().map(str::trim).filter(|line| !line.is_empty()) {
        if crate::limits::at_least(rows.len(), 2000) || crate::limits::over(symbol.len(), 8192) {
            return Err("Limit: 2,000 symbols, 8 KiB each.".into());
        }
        let msvc = symbol.starts_with('?');
        let result = if msvc {
            msvc_demangler::demangle(symbol, msvc_demangler::DemangleFlags::COMPLETE)
                .map_err(|error| error.to_string())
        } else {
            cpp_demangle::Symbol::new(symbol)
                .map_err(|error| error.to_string())
                .and_then(|parsed| parsed.demangle().map_err(|error| error.to_string()))
        };
        match result {
            Ok(value) => rows.push(json!({
                "symbol": symbol,
                "abi": if msvc { "MSVC" } else { "Itanium" },
                "demangled": value,
                "status": "decoded"
            })),
            Err(error) => rows.push(json!({
                "symbol": symbol,
                "demangled": symbol,
                "status": "not decoded",
                "error": error
            })),
        }
    }
    if rows.is_empty() {
        return Err("Enter one mangled symbol per line.".into());
    }
    Ok(table(rows))
}

pub fn diagnostics(input: &str) -> Result<Value, String> {
    let ansi = Regex::new(r"\x1b\[[0-9;]*m").unwrap();
    let gcc =
        Regex::new(r"^(.+?):(\d+)(?::(\d+))?:\s*(fatal error|error|warning|note|remark):\s*(.*)$")
            .unwrap();
    let msvc = Regex::new(r"^(.+)\((\d+)(?:,(\d+))?\)\s*:\s*(fatal error|error|warning|note)\s*([A-Za-z]+\d+)?:\s*(.*)$").unwrap();
    let option = Regex::new(r"\s+(\[-W[^\]]+\])$").unwrap();
    let clean = ansi.replace_all(input, "");
    let mut rows = Vec::new();
    let mut context_lines = 0;
    for line in clean.lines() {
        let matched = if let Some(captures) = gcc.captures(line) {
            let message = &captures[5];
            let flag = option
                .captures(message)
                .map(|found| found[1].to_owned())
                .unwrap_or_default();
            Some(json!({
                "file": &captures[1],
                "line": &captures[2],
                "column": captures.get(3).map(|value| value.as_str()),
                "severity": &captures[4],
                "code": flag,
                "message": option.replace(message, ""),
                "context": ""
            }))
        } else {
            msvc.captures(line).map(|captures| {
                json!({
                    "file": &captures[1],
                    "line": &captures[2],
                    "column": captures.get(3).map(|value| value.as_str()),
                    "severity": &captures[4],
                    "code": captures.get(5).map(|value| value.as_str()),
                    "message": &captures[6],
                    "context": ""
                })
            })
        };
        if let Some(row) = matched {
            if crate::limits::at_least(rows.len(), 10000) {
                return Err("Limit: 10,000 diagnostics.".into());
            }
            rows.push(row);
            context_lines = 0;
        } else if let Some(previous) = rows.last_mut() {
            context_lines += 1;
            if context_lines <= 8 {
                let context = previous["context"].as_str().unwrap();
                previous["context"] = format!("{context}{line}\n").into();
            }
        }
    }
    if rows.is_empty() {
        return Err(
            "No GCC/Clang file:line diagnostics or MSVC file(line) diagnostics found.".into(),
        );
    }
    Ok(table(rows))
}
