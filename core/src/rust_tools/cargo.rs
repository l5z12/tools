// SPDX-License-Identifier: AGPL-3.0-only
use crate::workbench::{data, option, table};
use serde_json::{json, Value};
use std::collections::BTreeMap;

fn parse_toml(text: &str) -> Result<Value, String> {
    let document: toml::Value = toml::from_str(text).map_err(|e| e.to_string())?;
    serde_json::to_value(document).map_err(|e| e.to_string())
}

fn dependencies(document: &Value, target: &str, rows: &mut Vec<Value>) {
    for kind in ["dependencies", "dev-dependencies", "build-dependencies"] {
        if let Some(entries) = document[kind].as_object() {
            for (alias, spec) in entries {
                rows.push(json!({
                    "name":alias,"package":spec["package"].as_str().unwrap_or(alias),"kind":kind,"target":target,
                    "version":spec.as_str().or(spec["version"].as_str()),"workspace":spec["workspace"] == true,
                    "optional":spec["optional"] == true,"defaultFeatures":spec["default-features"] != false,
                    "features":spec["features"],"git":spec["git"],"branch":spec["branch"],"tag":spec["tag"],"rev":spec["rev"],"path":spec["path"],"registry":spec["registry"]
                }));
            }
        }
    }
}

pub fn execute(id: &str, text: &str, options: &Value) -> Result<Value, String> {
    match id {
        "cargo-manifest" => {
            let doc = parse_toml(text)?;
            if doc["package"].is_null() && doc["workspace"].is_null() {
                return Err("Expected a [package] or [workspace] Cargo manifest.".into());
            }
            let mut rows = Vec::new();
            dependencies(&doc, "all targets", &mut rows);
            dependencies(&doc["workspace"], "workspace defaults", &mut rows);
            if let Some(targets) = doc["target"].as_object() {
                for (target, config) in targets {
                    dependencies(config, target, &mut rows);
                }
            }
            Ok(data(
                json!({"package":doc["package"],"workspace":doc["workspace"],"dependencies":rows,"features":doc["features"],"profiles":doc["profile"],"targets":{"lib":doc["lib"],"bin":doc["bin"],"example":doc["example"],"test":doc["test"],"bench":doc["bench"]}}),
            ))
        }
        "cargo-lock" => {
            let doc = parse_toml(text)?;
            let packages = doc["package"]
                .as_array()
                .ok_or("Expected [[package]] entries in Cargo.lock.")?;
            let mut counts = BTreeMap::new();
            for package in packages {
                let name = package["name"].as_str().ok_or("Package name missing.")?;
                *counts.entry(name).or_insert(0usize) += 1;
            }
            let rows = packages.iter().filter(|p| options["duplicates"] != true || counts.get(p["name"].as_str().unwrap_or("")).copied().unwrap_or(0) > 1).map(|p| json!({
                "name":p["name"],"version":p["version"],"source":p["source"],"checksum":p["checksum"],"dependencies":p["dependencies"],"sameNamePackages":counts.get(p["name"].as_str().unwrap_or(""))
            })).collect();
            Ok(table(rows))
        }
        "cargo-metadata" => {
            let doc: Value = serde_json::from_str(text).map_err(|e| e.to_string())?;
            let packages = doc["packages"]
                .as_array()
                .ok_or("Paste cargo metadata --format-version 1 output.")?;
            let rows: Vec<_> = packages.iter().map(|p| json!({"id":p["id"],"name":p["name"],"version":p["version"],"license":p["license"],"edition":p["edition"],"rustVersion":p["rust_version"],"source":p["source"],"targets":p["targets"],"dependencies":p["dependencies"],"features":p["features"]})).collect();
            Ok(data(
                json!({"workspaceMembers":doc["workspace_members"],"defaultMembers":doc["workspace_default_members"],"packages":rows,"resolvedDependencyGraph":doc["resolve"],"resolutionAvailable":!doc["resolve"].is_null()}),
            ))
        }
        "cargo-diagnostics" => diagnostics(text),
        "cargo-version" => {
            let requirement = semver::VersionReq::parse(option(options, "requirement", "^1.0"))
                .map_err(|e| e.to_string())?;
            let mut rows = Vec::new();
            for token in text
                .split(|c: char| c.is_whitespace() || c == ',')
                .filter(|s| !s.is_empty())
            {
                let version = semver::Version::parse(token).map_err(|e| format!("{token}: {e}"))?;
                rows.push(json!({"version":version.to_string(),"matches":requirement.matches(&version),"prerelease":version.pre.as_str(),"build":version.build.as_str()}));
            }
            if rows.is_empty() {
                return Err("Enter at least one complete version, such as 1.2.3.".into());
            }
            Ok(table(rows))
        }
        _ => Err("Unknown Cargo tool.".into()),
    }
}

fn diagnostics(text: &str) -> Result<Value, String> {
    let mut rows = Vec::new();
    for (index, line) in text
        .lines()
        .enumerate()
        .filter(|(_, l)| !l.trim().is_empty())
    {
        let record: Value =
            serde_json::from_str(line).map_err(|e| format!("JSON line {}: {e}", index + 1))?;
        let message = if record["reason"] == "compiler-message" {
            &record["message"]
        } else if record["$message_type"] == "diagnostic" {
            &record
        } else {
            continue;
        };
        let primary = message["spans"]
            .as_array()
            .and_then(|spans| spans.iter().find(|span| span["is_primary"] == true));
        let span = primary.unwrap_or(&Value::Null);
        rows.push(json!({"level":message["level"],"code":message["code"]["code"],"message":message["message"],"file":span["file_name"],"line":span["line_start"],"column":span["column_start"],"details":message["children"],"rendered":message["rendered"]}));
    }
    Ok(table(rows))
}
