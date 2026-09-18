// SPDX-License-Identifier: AGPL-3.0-only
use serde_json::{json, Value};
use std::{
    collections::{BTreeMap, BTreeSet},
    str::FromStr,
};

fn pointer(base: &str, key: &str) -> String {
    format!("{base}/{}", key.replace('~', "~0").replace('/', "~1"))
}
fn diff(a: &Value, b: &Value, path: &str, out: &mut Vec<Value>) {
    if a == b {
        return;
    }
    if let (Some(a), Some(b)) = (a.as_object(), b.as_object()) {
        for (k, v) in a {
            if let Some(next) = b.get(k) {
                diff(v, next, &pointer(path, k), out)
            } else {
                out.push(json!({"op":"remove","path":pointer(path,k),"before":v}))
            }
        }
        for (k, v) in b {
            if !a.contains_key(k) {
                out.push(json!({"op":"add","path":pointer(path,k),"after":v}))
            }
        }
    } else if let (Some(a), Some(b)) = (a.as_array(), b.as_array()) {
        for i in 0..a.len().min(b.len()) {
            diff(&a[i], &b[i], &pointer(path, &i.to_string()), out)
        }
        for i in (b.len()..a.len()).rev() {
            out.push(json!({"op":"remove","path":pointer(path,&i.to_string()),"before":a[i]}))
        }
        for (i, v) in b.iter().enumerate().skip(a.len()) {
            out.push(json!({"op":"add","path":pointer(path,&i.to_string()),"after":v}))
        }
    } else {
        out.push(json!({"op":"replace","path":path,"before":a,"after":b}))
    }
}
fn type_of(values: &[&Value], depth: usize) -> String {
    if depth > 20 {
        return "unknown".into();
    }
    let mut types = BTreeSet::new();
    let objects: Vec<_> = values.iter().filter_map(|v| v.as_object()).collect();
    if !objects.is_empty() {
        let keys: BTreeSet<_> = objects.iter().flat_map(|o| o.keys()).collect();
        let mut fields = Vec::new();
        for key in keys {
            let items: Vec<_> = objects.iter().filter_map(|o| o.get(key)).collect();
            fields.push(format!(
                "{}{}: {};",
                serde_json::to_string(key).unwrap(),
                if items.len() < objects.len() { "?" } else { "" },
                type_of(&items, depth + 1)
            ))
        }
        let indent = "  ".repeat(depth + 1);
        types.insert(format!(
            "{{\n{indent}{}\n{}}}",
            fields.join(&format!("\n{indent}")),
            "  ".repeat(depth)
        ));
    }
    let arrays: Vec<_> = values.iter().filter_map(|v| v.as_array()).collect();
    if !arrays.is_empty() {
        let items: Vec<_> = arrays.iter().flat_map(|a| a.iter()).collect();
        types.insert(format!(
            "Array<{}>",
            if items.is_empty() {
                "unknown".into()
            } else {
                type_of(&items, depth + 1)
            }
        ));
    }
    for v in values {
        match v {
            Value::Null => {
                types.insert("null".into());
            }
            Value::Bool(_) => {
                types.insert("boolean".into());
            }
            Value::Number(_) => {
                types.insert("number".into());
            }
            Value::String(_) => {
                types.insert("string".into());
            }
            _ => {}
        }
    }
    types.into_iter().collect::<Vec<_>>().join(" | ")
}
fn env(s: &str) -> Result<BTreeMap<String, String>, String> {
    let mut out = BTreeMap::new();
    let re = regex::Regex::new(r"^[A-Za-z_][A-Za-z0-9_]*$").unwrap();
    for (i, line) in s.lines().enumerate() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let line = line.strip_prefix("export ").unwrap_or(line);
        let (k, v) = line
            .split_once('=')
            .ok_or_else(|| format!("Line {} needs KEY=value.", i + 1))?;
        let k = k.trim();
        if !re.is_match(k) {
            return Err(format!("Invalid key on line {}.", i + 1));
        }
        if out.contains_key(k) {
            return Err(format!("Duplicate key: {k}"));
        }
        let v = v.trim();
        let value = if v.starts_with('"') || v.starts_with('\'') {
            let quote = v.chars().next().unwrap();
            let end = v[1..].find(quote).ok_or_else(|| {
                format!(
                    "Unclosed quote on line {}. Multiline values are not supported.",
                    i + 1
                )
            })? + 1;
            let rest = v[end + 1..].trim();
            if !rest.is_empty() && !rest.starts_with('#') {
                return Err(format!("Unexpected text on line {}.", i + 1));
            }
            v[1..end].to_string()
        } else {
            v.split(" #").next().unwrap_or(v).trim().to_string()
        };
        out.insert(k.to_string(), value);
    }
    Ok(out)
}
fn curl(input: &str) -> Result<String, String> {
    let args = shlex::split(&input.replace("\\\n", "")).ok_or("Unclosed shell quote.")?;
    if args.first().map(String::as_str) != Some("curl") {
        return Err("Command must start with curl.".into());
    }
    let (mut url, mut method, mut body) = (None, None, None);
    let mut headers = serde_json::Map::new();
    let mut i = 1;
    while i < args.len() {
        let a = &args[i];
        match a.as_str(){"-X"|"--request"|"-H"|"--header"|"-d"|"--data"|"--data-raw"|"--data-binary"|"--url"=>{i+=1;let value=args.get(i).ok_or("Flag is missing its value.")?;match a.as_str(){"-X"|"--request"=>method=Some(value.clone()),"-H"|"--header"=>{let(k,v)=value.split_once(':').ok_or("Headers need Name: value.")?;let key=k.trim().to_lowercase();if headers.contains_key(&key){return Err("Repeated headers require manual review; combine them first.".into())}headers.insert(key,json!(v.trim()));},"--url"=>{if url.replace(value.clone()).is_some(){return Err("Use one URL per command.".into())}},_=>{if a!="--data-raw"&&value.starts_with('@'){return Err("Local @file bodies are not read; paste the body explicitly with --data-raw.".into())}if body.replace(value.clone()).is_some(){return Err("Use one body argument.".into())}}}},"-s"|"--silent"|"-S"|"--show-error"=>{},_ if a.starts_with('-')=>return Err(format!("Unsupported curl flag: {a}. Supported: -X, -H, -d, --data-raw, --data-binary, --url.")),_=>{if url.replace(a.clone()).is_some(){return Err("Use one URL per command.".into())}}}
        i += 1;
    }
    let url = url.ok_or("Missing URL.")?;
    let parsed = url::Url::parse(&url).map_err(|e| e.to_string())?;
    if !["http", "https"].contains(&parsed.scheme()) {
        return Err("Use an HTTP or HTTPS URL.".into());
    }
    if body.is_some() && !headers.contains_key("content-type") {
        headers.insert(
            "content-type".into(),
            json!("application/x-www-form-urlencoded"),
        );
    }
    let mut options = serde_json::Map::new();
    options.insert(
        "method".into(),
        json!(method.unwrap_or_else(|| if body.is_some() {
            "POST".into()
        } else {
            "GET".into()
        })),
    );
    if !headers.is_empty() {
        options.insert("headers".into(), Value::Object(headers));
    }
    if let Some(body) = body {
        options.insert("body".into(), json!(body));
    }
    Ok(format!(
        "const response = await fetch({}, {});\nconst body = await response.text();",
        serde_json::to_string(&url).unwrap(),
        serde_json::to_string_pretty(&options).unwrap()
    ))
}
pub fn run(id: &str, s: &str, o: &str) -> Option<Result<String, String>> {
    if ![
        "json-typescript",
        "json-schema",
        "json-diff",
        "curl-fetch",
        "regex-playground",
        "cron-explorer",
        "env-diff",
        "semver-test",
        "hex-viewer",
        "csp-inspector",
    ]
    .contains(&id)
    {
        return None;
    }
    Some((|| {
        Ok(match id {
            "json-typescript" => {
                let v: Value = serde_json::from_str(s).map_err(|e| e.to_string())?;
                let name = if o.trim().is_empty() {
                    "Root"
                } else {
                    o.trim()
                };
                if !regex::Regex::new(r"^[A-Z][A-Za-z0-9_]*$")
                    .unwrap()
                    .is_match(name)
                {
                    return Err("Type name must start with an uppercase ASCII letter and contain letters, numbers or underscores.".into());
                }
                format!("export type {name} = {};", type_of(&[&v], 0))
            }
            "json-schema" => {
                let schema: Value = serde_json::from_str(o).map_err(|e| format!("Schema: {e}"))?;
                let instance: Value = serde_json::from_str(s).map_err(|e| format!("Input: {e}"))?;
                let validator =
                    jsonschema::validator_for(&schema).map_err(|e| format!("Schema: {e}"))?;
                let errors=validator.iter_errors(&instance).take(100).map(|e|json!({"path":e.instance_path.to_string(),"schemaPath":e.schema_path.to_string(),"message":e.to_string()})).collect::<Vec<_>>();
                json!({"valid":errors.is_empty(),"errors":errors,"limit":100}).to_string()
            }
            "json-diff" => {
                let a: Value = serde_json::from_str(s).map_err(|e| format!("Original: {e}"))?;
                let b: Value = serde_json::from_str(o).map_err(|e| format!("Updated: {e}"))?;
                let mut changes = Vec::new();
                diff(&a, &b, "", &mut changes);
                json!(changes).to_string()
            }
            "curl-fetch" => curl(s)?,
            "regex-playground" => {
                let re = regex::Regex::new(o).map_err(|e| e.to_string())?;
                let names: Vec<_> = re.capture_names().map(|n| n.map(str::to_string)).collect();
                let rows=re.captures_iter(s).take(1000).map(|c|{let m=c.get(0).unwrap();json!({"text":m.as_str(),"start":s[..m.start()].encode_utf16().count(),"end":s[..m.end()].encode_utf16().count(),"groups":c.iter().enumerate().skip(1).map(|(i,m)|json!({"name":names[i],"index":i,"value":m.map(|m|m.as_str())})).collect::<Vec<_>>()})}).collect::<Vec<_>>();
                json!(rows).to_string()
            }
            "cron-explorer" => {
                let expression = if s.split_whitespace().count() == 5 {
                    format!("0 {s}")
                } else {
                    s.to_string()
                };
                let schedule = cron::Schedule::from_str(&expression).map_err(|e| e.to_string())?;
                let start = chrono::DateTime::parse_from_rfc3339(o.trim())
                    .map_err(|e| format!("Start date: {e}"))?;
                let next=schedule.after(&start).take(10).map(|d|json!({"timestamp":d.to_rfc3339(),"weekday":d.format("%A").to_string()})).collect::<Vec<_>>();
                json!({"expression":expression,"schedule":next,"note":"Fixed offset schedule. Day-of-month and day-of-week constraints must both match. No regional daylight-saving adjustment."}).to_string()
            }
            "env-diff" => {
                let a = env(s)?;
                let b = env(o)?;
                let keys: BTreeSet<_> = a.keys().chain(b.keys()).collect();
                json!(keys.into_iter().map(|k|json!({"key":k,"status":match(a.get(k),b.get(k)){(None,Some(_))=>"added",(Some(_),None)=>"removed",(Some(x),Some(y))if x==y=>"unchanged",_=>"changed"},"before":a.get(k),"after":b.get(k)})).collect::<Vec<_>>()).to_string()
            }
            "semver-test" => {
                let requirement = semver::VersionReq::parse(o.trim()).map_err(|e| e.to_string())?;
                let mut rows = Vec::new();
                for version in s
                    .split(|c: char| c.is_whitespace() || c == ',')
                    .filter(|s| !s.is_empty())
                {
                    let v =
                        semver::Version::parse(version).map_err(|e| format!("{version}: {e}"))?;
                    rows.push(json!({"version":version,"matches":requirement.matches(&v),"prerelease":v.pre.to_string()}))
                }
                if rows.is_empty() {
                    return Err("Enter at least one full semantic version.".into());
                }
                json!(rows).to_string()
            }
            "hex-viewer" => {
                use base64::Engine;
                let bytes = base64::engine::general_purpose::STANDARD
                    .decode(s.trim())
                    .map_err(|e| e.to_string())?;
                let rows=bytes.chunks(16).take(4096).enumerate().map(|(i,b)|json!({"offset":format!("{:08X}",i*16),"hex":b.iter().map(|n|format!("{n:02X}")).collect::<Vec<_>>().join(" "),"ascii":b.iter().map(|n|if (32..=126).contains(n){*n as char}else{'.'}).collect::<String>()})).collect::<Vec<_>>();
                json!({"bytes":bytes.len(),"shownBytes":bytes.len().min(65536),"rows":rows})
                    .to_string()
            }
            "csp-inspector" => {
                let input = s
                    .trim()
                    .strip_prefix("Content-Security-Policy:")
                    .unwrap_or(s.trim());
                let mut seen = BTreeSet::new();
                let mut directives = Vec::new();
                let mut notes = Vec::new();
                for directive in input.split(';').map(str::trim).filter(|s| !s.is_empty()) {
                    let mut words = directive.split_whitespace();
                    let name = words.next().unwrap().to_lowercase();
                    let values = words.map(str::to_string).collect::<Vec<_>>();
                    if !seen.insert(name.clone()) {
                        notes.push(format!(
                            "Duplicate {name}: browsers use the first occurrence."
                        ));
                    }
                    if values.iter().any(|s| s == "'unsafe-inline'") {
                        notes.push(format!("{name} contains 'unsafe-inline'; its effect depends on nonces, hashes and the CSP version."))
                    }
                    if values.iter().any(|s| s == "'unsafe-eval'") {
                        notes.push(format!(
                            "{name} permits string-to-code evaluation where applicable."
                        ))
                    }
                    if values.iter().any(|s| s == "*") {
                        notes.push(format!("{name} contains a wildcard source."))
                    }
                    directives.push(json!({"directive":name,"sources":values.join(" ")}));
                }
                if directives.is_empty() {
                    return Err("Paste a CSP policy.".into());
                }
                for key in ["default-src", "object-src", "base-uri"] {
                    if !seen.contains(key) {
                        notes.push(format!("No explicit {key} directive."))
                    }
                }
                json!({"directives":directives,"notes":notes,"scope":"Structural inspection only; this does not prove a policy is secure or model every browser's enforcement."}).to_string()
            }
            _ => unreachable!(),
        })
    })())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn dev_tools() {
        assert!(
            run("json-typescript", r#"[{"a":1},{"a":2,"b":true}]"#, "Root")
                .unwrap()
                .unwrap()
                .contains("\"b\"?")
        );
        assert!(run(
            "curl-fetch",
            "curl https://example.com -H 'X-Test: yes'",
            ""
        )
        .unwrap()
        .unwrap()
        .contains("fetch"));
        assert!(run("curl-fetch", "curl https://example.com --insecure", "")
            .unwrap()
            .is_err());
        let v: Value = serde_json::from_str(
            &run(
                "json-schema",
                r#"{"age":"x"}"#,
                r#"{"type":"object","properties":{"age":{"type":"number"}}}"#,
            )
            .unwrap()
            .unwrap(),
        )
        .unwrap();
        assert_eq!(v["valid"], false);
        assert!(run("env-diff", "A=1\nA=2", "A=1").unwrap().is_err());
    }
}
