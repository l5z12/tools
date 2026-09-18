// SPDX-License-Identifier: AGPL-3.0-only
use crate::workbench::{data, table};
use serde_json::{json, Value};
use std::collections::BTreeSet;

pub fn compilation_database(input: &str) -> Result<Value, String> {
    let value: Value = serde_json::from_str(input).map_err(|error| error.to_string())?;
    let entries = value
        .as_array()
        .ok_or("Expected a compile_commands.json array.")?;
    if entries.len() > 10000 {
        return Err("Limit: 10,000 compilation commands.".into());
    }
    let mut files = BTreeSet::new();
    let mut details = Vec::new();
    let mut rows = Vec::new();
    for (index, entry) in entries.iter().enumerate() {
        let required = |name: &str| -> Result<&str, String> {
            entry[name]
                .as_str()
                .filter(|value| !value.is_empty())
                .ok_or_else(|| format!("Entry {}: missing {name} string.", index + 1))
        };
        let file = required("file")?;
        let directory = required("directory")?;
        let arguments = if entry.get("arguments").is_some() {
            let args = entry["arguments"]
                .as_array()
                .filter(|args| !args.is_empty())
                .ok_or("arguments must be a nonempty string array.")?;
            let args: Vec<&str> = args
                .iter()
                .map(|arg| arg.as_str().ok_or("Each argument must be a string."))
                .collect::<Result<_, _>>()?;
            Some(args)
        } else {
            None
        };
        if arguments.is_none() {
            required("command")?;
        }
        if entry.get("command").is_some() && !entry["command"].is_string() {
            return Err("command must be a string.".into());
        }
        if entry.get("output").is_some() && !entry["output"].is_string() {
            return Err("output must be a string.".into());
        }
        let duplicate = !files.insert((directory.to_owned(), file.to_owned()));
        let mut detail = entry.clone();
        if let Some(args) = &arguments {
            detail["flags"] = extract_flags(args);
        }
        rows.push(json!({
            "file": file,
            "directory": directory,
            "compiler": arguments.as_ref().map(|args| args[0]),
            "argumentCount": arguments.as_ref().map(Vec::len),
            "anotherConfiguration": duplicate,
            "output": entry.get("output")
        }));
        details.push(detail);
    }
    let mut result = data(json!({
        "commands": entries.len(),
        "distinctFileEntries": files.len(),
        "entries": details
    }));
    result["rows"] = rows.into();
    Ok(result)
}

fn extract_flags(args: &[&str]) -> Value {
    let mut includes = Vec::new();
    let mut defines = Vec::new();
    let mut undefines = Vec::new();
    let mut standards = Vec::new();
    let mut index = 1;
    let msvc = args[0]
        .replace('\\', "/")
        .rsplit('/')
        .next()
        .unwrap_or("")
        .to_ascii_lowercase();
    let msvc = ["cl", "cl.exe", "clang-cl", "clang-cl.exe"].contains(&msvc.as_str());
    while index < args.len() {
        let argument = args[index];
        let prefixes = if msvc {
            vec!["/I", "/D", "/U"]
        } else {
            vec!["-isystem", "-iquote", "-I", "-D", "-U"]
        };
        for prefix in prefixes {
            if let Some(suffix) = argument.strip_prefix(prefix) {
                let value = if suffix.is_empty() {
                    index += 1;
                    args.get(index).copied()
                } else {
                    Some(suffix)
                };
                if let Some(value) = value {
                    if prefix.ends_with('D') {
                        defines.push(value);
                    } else if prefix.ends_with('U') {
                        undefines.push(value);
                    } else {
                        includes.push(json!({"kind": prefix, "path": value}));
                    }
                }
                break;
            }
        }
        if let Some(value) = argument
            .strip_prefix("-std=")
            .or_else(|| argument.strip_prefix("/std:"))
        {
            standards.push(value);
        }
        index += 1;
    }
    json!({
        "includePaths": includes,
        "defines": defines,
        "undefines": undefines,
        "standards": standards
    })
}

pub fn cmake_cache(input: &str, options: &Value) -> Result<Value, String> {
    let mut rows = Vec::new();
    let mut help = Vec::new();
    for (index, line) in input.lines().enumerate() {
        if let Some(comment) = line.strip_prefix("//") {
            help.push(comment);
            continue;
        }
        if line.starts_with('#') || line.trim().is_empty() {
            help.clear();
            continue;
        }
        let (left, value) = line
            .split_once('=')
            .ok_or_else(|| format!("Line {}: expected NAME:TYPE=value.", index + 1))?;
        let (name, kind) = left
            .rsplit_once(':')
            .ok_or_else(|| format!("Line {}: missing cache entry type.", index + 1))?;
        if ![
            "BOOL",
            "FILEPATH",
            "PATH",
            "STRING",
            "INTERNAL",
            "STATIC",
            "UNINITIALIZED",
        ]
        .contains(&kind)
            || name.is_empty()
        {
            return Err(format!("Line {}: invalid cache name or type.", index + 1));
        }
        if options["internal"] == true || !["INTERNAL", "STATIC"].contains(&kind) {
            rows.push(json!({
                "name": name.trim_matches('"'),
                "type": kind,
                "value": value,
                "help": help.join("\n")
            }));
        }
        help.clear();
        if rows.len() > 10000 {
            return Err("Limit: 10,000 cache entries.".into());
        }
    }
    Ok(table(rows))
}
