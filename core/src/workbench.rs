// SPDX-License-Identifier: AGPL-3.0-only
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};
use sha2::{Digest, Sha256, Sha384, Sha512};
use std::collections::{BTreeMap, BTreeSet};
use wasm_bindgen::prelude::*;

pub fn option<'a>(v: &'a Value, key: &str, default: &'a str) -> &'a str {
    v[key].as_str().unwrap_or(default)
}
pub fn file(name: &str, mime: &str, bytes: &[u8]) -> Value {
    json!({"name":name,"mime":mime,"base64":STANDARD.encode(bytes)})
}
pub fn code(text: String, language: &str) -> Value {
    json!({"kind":"code","text":text,"language":language})
}
pub fn data(v: Value) -> Value {
    json!({"kind":"data","data":v,"text":serde_json::to_string_pretty(&v).unwrap()})
}
pub fn table(rows: Vec<Value>) -> Value {
    json!({"kind":"table","rows":rows,"text":serde_json::to_string_pretty(&rows).unwrap()})
}
#[wasm_bindgen]
pub fn suite_run(id: &str, input: &str, bytes: &[u8], options: &str) -> Result<String, JsValue> {
    execute(id, input, bytes, options)
        .map(|v| v.to_string())
        .map_err(|e| JsValue::from_str(&e))
}
pub fn execute(id: &str, input: &str, bytes: &[u8], options: &str) -> Result<Value, String> {
    let opts: Value = serde_json::from_str(options).map_err(|e| e.to_string())?;
    crate::limits::from_options(&opts);
    crate::limits::check(
        bytes.len(),
        32 * 1024 * 1024,
        "Input exceeds this tool's size limit.",
    )?;
    crate::limits::check(
        input.len(),
        2_000_000,
        "Input exceeds this tool's size limit.",
    )?;
    crate::limits::check(
        options.len(),
        2_000_000,
        "Input exceeds this tool's size limit.",
    )?;
    let source = if opts["fileProvided"] == true {
        bytes
    } else {
        input.as_bytes()
    };
    match id {
        "format-output" => crate::output_format::execute(bytes, &opts),
        "jwt-verify" | "svg-optimizer" | "crypto-keypair" | "crypto-rsa-oaep" | "uuid"
        | "password" | "file-sha256" => crate::browser_compute::execute(id, input, bytes, &opts),
        id if id.starts_with("sql-") && id != "sql-formatter" => {
            crate::sql_tools::execute(id, source, &opts)
        }
        id if id.starts_with("cpp-") => crate::cpp_tools::execute(id, source, &opts),
        id if id.starts_with("dev-") => crate::dev_inspect::execute(id, source, &opts),
        id if id.starts_with("everyday-") => crate::everyday::execute(id, source, &opts),
        id if id.starts_with("rust-") || id.starts_with("cargo-") || id.starts_with("wasm-") => {
            crate::rust_tools::execute(id, source, &opts)
        }
        "hash-workbench" => crate::hashes::execute(input, source, &opts),
        id if id.starts_with("util-") => crate::utilities::execute(id, input, source, &opts),
        id if id.starts_with("codec-") => crate::codecs::execute(id, source, &opts),
        id if id.starts_with("cipher-") => crate::classical::execute(id, input, &opts),
        id if id.starts_with("crypto-") => crate::crypto_tools::execute(id, input, source, &opts),
        "palette-core" => {
            if bytes.len() % 4 != 0 {
                return Err("Invalid RGBA pixels.".into());
            }
            let mut bins: BTreeMap<u16, (u64, u64, u64, u64)> = BTreeMap::new();
            let mut total = 0u64;
            for p in bytes.chunks_exact(4) {
                if p[3] == 0 {
                    continue;
                }
                let k = ((p[0] as u16 >> 4) << 8) | ((p[1] as u16 >> 4) << 4) | (p[2] as u16 >> 4);
                let v = bins.entry(k).or_default();
                let a = p[3] as u64;
                v.0 += p[0] as u64 * a;
                v.1 += p[1] as u64 * a;
                v.2 += p[2] as u64 * a;
                v.3 += a;
                total += a;
            }
            let mut bins: Vec<_> = bins.into_values().collect();
            bins.sort_by(|a, b| b.3.cmp(&a.3));
            let count = opts["count"].as_u64().unwrap_or(8).clamp(2, 32) as usize;
            let colors:Vec<_>=bins.into_iter().take(count).map(|v|json!({"hex":format!("#{:02x}{:02x}{:02x}",v.0/v.3,v.1/v.3,v.2/v.3),"percent":100.0*v.3 as f64/total as f64})).collect();
            Ok(
                json!({"kind":"palette","colors":colors,"text":serde_json::to_string_pretty(&colors).unwrap()}),
            )
        }
        "compare-core" => {
            if bytes.is_empty() || bytes.len() % 8 != 0 {
                return Err("Two equal RGBA buffers are required.".into());
            }
            let (a, b) = bytes.split_at(bytes.len() / 2);
            let mut heat = Vec::with_capacity(a.len());
            let mut changed = 0;
            let mut squared = 0f64;
            for (x, y) in a.chunks_exact(4).zip(b.chunks_exact(4)) {
                let mut largest = 0u8;
                for i in 0..4 {
                    let d = x[i].abs_diff(y[i]);
                    largest = largest.max(d);
                    squared += (d as f64).powi(2);
                }
                if largest > 0 {
                    changed += 1
                }
                heat.extend_from_slice(&[largest, 0, 0, 255]);
            }
            let mse = squared / a.len() as f64;
            Ok(
                json!({"kind":"data","data":{"pixels":a.len()/4,"changedPixels":changed,"changedPercent":100.0*changed as f64/(a.len()/4)as f64,"meanSquaredError":mse,"PSNR":if mse==0.0{json!("identical")}else{json!(10.0*(255.0*255.0/mse).log10())}},"rgba":STANDARD.encode(heat)}),
            )
        }
        "ico-core" => {
            let entries = opts["entries"].as_array().ok_or("Missing ICO entries.")?;
            if entries.is_empty() || entries.len() > 16 {
                return Err("Invalid ICO entry count.".into());
            }
            let mut out = vec![0, 0, 1, 0];
            out.extend_from_slice(&(entries.len() as u16).to_le_bytes());
            let mut offset = 6 + 16 * entries.len();
            let mut consumed = 0;
            for e in entries {
                let size = e["size"].as_u64().ok_or("Invalid ICO size.")?;
                let len = e["length"].as_u64().ok_or("Invalid PNG length.")? as usize;
                if size == 0 || size > 256 || consumed + len > bytes.len() {
                    return Err("Invalid ICO entry.".into());
                }
                out.extend_from_slice(&[
                    if size == 256 { 0 } else { size as u8 },
                    if size == 256 { 0 } else { size as u8 },
                    0,
                    0,
                    1,
                    0,
                    32,
                    0,
                ]);
                out.extend_from_slice(&(len as u32).to_le_bytes());
                out.extend_from_slice(&(offset as u32).to_le_bytes());
                offset += len;
                consumed += len;
            }
            if consumed != bytes.len() {
                return Err("ICO lengths mismatch.".into());
            }
            out.extend_from_slice(bytes);
            Ok(
                json!({"kind":"data","text":"ICO created.","files":[file("favicon.ico","image/x-icon",&out)]}),
            )
        }
        "hmac-calc" => {
            use hmac::{Hmac, Mac};
            let key = if option(&opts, "keyFormat", "text") == "hex" {
                hex::decode(option(&opts, "key", "")).map_err(|e| e.to_string())?
            } else {
                option(&opts, "key", "").as_bytes().to_vec()
            };
            if key.is_empty() {
                return Err("Provide a nonempty key.".into());
            }
            let result = match option(&opts, "algorithm", "SHA-256") {
                "SHA-256" => {
                    let mut mac = Hmac::<Sha256>::new_from_slice(&key).unwrap();
                    mac.update(source);
                    mac.finalize().into_bytes().to_vec()
                }
                "SHA-384" => {
                    let mut mac = Hmac::<Sha384>::new_from_slice(&key).unwrap();
                    mac.update(source);
                    mac.finalize().into_bytes().to_vec()
                }
                "SHA-512" => {
                    let mut mac = Hmac::<Sha512>::new_from_slice(&key).unwrap();
                    mac.update(source);
                    mac.finalize().into_bytes().to_vec()
                }
                _ => return Err("Unsupported HMAC algorithm.".into()),
            };
            Ok(data(
                json!({"hex":hex::encode(&result),"base64":STANDARD.encode(&result)}),
            ))
        }
        "sri-generator" => {
            let hash = match option(&opts, "algorithm", "SHA-384") {
                "SHA-256" => format!("sha256-{}", STANDARD.encode(Sha256::digest(source))),
                "SHA-384" => format!("sha384-{}", STANDARD.encode(Sha384::digest(source))),
                "SHA-512" => format!("sha512-{}", STANDARD.encode(Sha512::digest(source))),
                _ => return Err("Unsupported hash algorithm.".into()),
            };
            Ok(data(
                json!({"integrity":hash,"attribute":format!("integrity=\"{hash}\" crossorigin=\"anonymous\"")}),
            ))
        }
        "cert-inspector" => certificate(source, &opts),
        "url-diff" => {
            let a = url::Url::parse(input.trim()).map_err(|e| format!("First URL: {e}"))?;
            let b = url::Url::parse(option(&opts, "second", "").trim())
                .map_err(|e| format!("Second URL: {e}"))?;
            let components = |u: &url::Url| {
                vec![
                    ("scheme", u.scheme().to_string()),
                    ("username", u.username().to_string()),
                    ("password", u.password().unwrap_or("").to_string()),
                    ("host", u.host_str().unwrap_or("").to_string()),
                    (
                        "port",
                        u.port_or_known_default()
                            .map(|n| n.to_string())
                            .unwrap_or_default(),
                    ),
                    ("path", u.path().into()),
                    ("fragment", u.fragment().unwrap_or("").into()),
                    ("raw query", u.query().unwrap_or("").into()),
                    ("query present", u.query().is_some().to_string()),
                    ("fragment present", u.fragment().is_some().to_string()),
                ]
            };
            let mut rows = Vec::new();
            for ((key, x), (_, y)) in components(&a).into_iter().zip(components(&b)) {
                rows.push(json!({"part":key,"first":x,"second":y,"changed":x!=y}))
            }
            let queries = |u: &url::Url| {
                let mut m: BTreeMap<String, Vec<String>> = BTreeMap::new();
                for (k, v) in u.query_pairs() {
                    m.entry(k.to_string()).or_default().push(v.to_string())
                }
                m
            };
            let (qa, qb) = (queries(&a), queries(&b));
            let keys: BTreeSet<_> = qa.keys().chain(qb.keys()).collect();
            for k in keys {
                rows.push(json!({"part":format!("query: {k}"),"first":qa.get(k),"second":qb.get(k),"changed":qa.get(k)!=qb.get(k)}))
            }
            Ok(table(rows))
        }
        "http-headers" => {
            let explanations: BTreeMap<&str, &str> = [
                (
                    "cache-control",
                    "Caching directives for browsers and intermediaries.",
                ),
                ("etag", "Resource validator used for conditional requests."),
                (
                    "last-modified",
                    "Last modification timestamp used for validation.",
                ),
                (
                    "set-cookie",
                    "Sets a cookie; repeated headers are shown separately.",
                ),
                (
                    "content-type",
                    "Media type and optional charset of the response.",
                ),
                (
                    "content-encoding",
                    "Compression applied to the message body.",
                ),
                (
                    "content-security-policy",
                    "Controls which resources the browser may load.",
                ),
                (
                    "strict-transport-security",
                    "Requests HTTPS-only access for a period.",
                ),
                (
                    "access-control-allow-origin",
                    "Origin permitted to read the response through CORS.",
                ),
                ("vary", "Request headers that influence cache selection."),
                ("location", "Redirect or newly created resource location."),
                (
                    "x-content-type-options",
                    "Can disable MIME type sniffing with nosniff.",
                ),
                (
                    "permissions-policy",
                    "Controls browser feature availability.",
                ),
            ]
            .into_iter()
            .collect();
            let mut rows = Vec::new();
            for (i, line) in input.lines().enumerate() {
                if line.trim().is_empty() {
                    continue;
                }
                if i == 0 && line.starts_with("HTTP/") {
                    rows.push(json!({"header":"Status line","value":line,"meaning":"HTTP version and response status."}));
                    continue;
                }
                let (k, v) = line
                    .split_once(':')
                    .ok_or_else(|| format!("Header line {} has no colon.", i + 1))?;
                if k.trim().is_empty() {
                    return Err("A header name is empty.".into());
                }
                let key = k.trim().to_ascii_lowercase();
                rows.push(json!({"header":k.trim(),"value":v.trim(),"meaning":explanations.get(key.as_str()).copied().unwrap_or("Extension or other HTTP header.")}))
            }
            Ok(table(rows))
        }
        "sql-formatter" => {
            use sqlparser::{dialect::*, parser::Parser};
            let dialect: Box<dyn Dialect> = match option(&opts, "dialect", "generic") {
                "postgres" => Box::new(PostgreSqlDialect {}),
                "mysql" => Box::new(MySqlDialect {}),
                "sqlite" => Box::new(SQLiteDialect {}),
                "mssql" => Box::new(MsSqlDialect {}),
                _ => Box::new(GenericDialect {}),
            };
            Parser::parse_sql(dialect.as_ref(), input).map_err(|e| e.to_string())?;
            Ok(code(
                sqlformat::format(
                    input,
                    &sqlformat::QueryParams::None,
                    &sqlformat::FormatOptions {
                        uppercase: Some(true),
                        ..Default::default()
                    },
                ),
                "sql",
            ))
        }
        "graphql-formatter" => {
            let result = if option(&opts, "mode", "query") == "schema" {
                graphql_parser::parse_schema::<String>(input)
                    .map_err(|e| e.to_string())?
                    .format(&Default::default())
            } else {
                graphql_parser::parse_query::<String>(input)
                    .map_err(|e| e.to_string())?
                    .format(&Default::default())
            };
            Ok(code(result, "graphql"))
        }
        "json-patch" => {
            let mut original: Value =
                serde_json::from_str(input).map_err(|e| format!("Original: {e}"))?;
            let second = option(&opts, "second", "");
            if option(&opts, "mode", "generate") == "apply" {
                let patch: json_patch::Patch =
                    serde_json::from_str(second).map_err(|e| e.to_string())?;
                json_patch::patch(&mut original, &patch).map_err(|e| e.to_string())?;
                Ok(data(json!({"result":original,"patch":patch})))
            } else {
                let updated: Value =
                    serde_json::from_str(second).map_err(|e| format!("Updated: {e}"))?;
                Ok(data(
                    json!({"patch":json_patch::diff(&original,&updated),"result":updated}),
                ))
            }
        }
        "xml-json" => xml(input, &opts),
        "csv-workbench" => csv_work(input, &opts),
        "archive-create" => crate::archives::create(bytes, &opts),
        "encoding-file" | "archive-explorer" | "compression-workbench" | "apng-extract" => {
            super::workbench_files::execute(id, bytes, &opts)
        }
        _ => Err("Unknown workbench tool.".into()),
    }
}
fn certificate(source: &[u8], opts: &Value) -> Result<Value, String> {
    use x509_parser::prelude::*;
    let certs = if source.starts_with(b"-----BEGIN") {
        ::pem::parse_many(source)
            .map_err(|e| e.to_string())?
            .into_iter()
            .filter(|p| p.tag() == "CERTIFICATE")
            .map(|p| p.contents().to_vec())
            .collect::<Vec<_>>()
    } else {
        vec![source.to_vec()]
    };
    if certs.is_empty() {
        return Err("No PEM certificates found.".into());
    }
    let mut rows = Vec::new();
    for der in certs {
        let (rest, cert) = X509Certificate::from_der(&der).map_err(|e| e.to_string())?;
        if !rest.is_empty() {
            return Err("Unexpected trailing DER data.".into());
        }
        let now = opts["now"].as_i64().unwrap_or(0);
        let start = cert.validity().not_before.timestamp();
        let end = cert.validity().not_after.timestamp();
        let san = cert
            .subject_alternative_name()
            .map_err(|e| e.to_string())?
            .map(|e| {
                e.value
                    .general_names
                    .iter()
                    .map(|n| format!("{n}"))
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        rows.push(json!({"subject":cert.subject().to_string(),"issuer":cert.issuer().to_string(),"serial":cert.raw_serial_as_string(),"notBefore":cert.validity().not_before.to_string(),"notAfter":cert.validity().not_after.to_string(),"currentlyWithinValidity":now>=start&&now<=end,"publicKeyAlgorithm":cert.public_key().algorithm.algorithm.to_id_string(),"signatureAlgorithm":cert.signature_algorithm.algorithm.to_id_string(),"SHA256":hex::encode(Sha256::digest(&der)),"subjectAlternativeNames":san,"trust":"Signature, trust chain and revocation are not validated."}))
    }
    Ok(data(json!(rows)))
}
fn xml(input: &str, opts: &Value) -> Result<Value, String> {
    if option(opts, "mode", "xml-to-json") == "xml-to-json" {
        let doc = roxmltree::Document::parse(input).map_err(|e| e.to_string())?;
        fn convert(node: roxmltree::Node, depth: usize) -> Result<Value, String> {
            if depth > 64 {
                return Err("XML nesting exceeds 64 levels.".into());
            }
            if node.tag_name().namespace().is_some()
                || node.attributes().any(|a| a.namespace().is_some())
            {
                return Err("Namespace-qualified XML is not supported by this mapping.".into());
            }
            let children: Vec<_> = node.children().filter(|n| n.is_element()).collect();
            let text = node
                .children()
                .filter(|n| n.is_text())
                .filter_map(|n| n.text())
                .collect::<String>();
            if children.is_empty() && node.attributes().len() == 0 {
                return Ok(json!(text));
            }
            if !children.is_empty() && !text.trim().is_empty() {
                return Err("Mixed text/element content cannot be represented without losing order; use element-only XML.".into());
            }
            let mut map = serde_json::Map::new();
            for a in node.attributes() {
                map.insert(format!("@{}", a.name()), json!(a.value()));
            }
            if children.is_empty() {
                map.insert("#text".into(), json!(text));
            }
            for child in children {
                let name = child.tag_name().name();
                let v = convert(child, depth + 1)?;
                if let Some(old) = map.get_mut(name) {
                    if let Some(array) = old.as_array_mut() {
                        array.push(v)
                    } else {
                        *old = json!([old.clone(), v])
                    }
                } else {
                    map.insert(name.into(), v);
                }
            }
            Ok(Value::Object(map))
        }
        Ok(data(
            json!({doc.root_element().tag_name().name():convert(doc.root_element(),0)?}),
        ))
    } else {
        let value: Value = serde_json::from_str(input).map_err(|e| e.to_string())?;
        let obj = value
            .as_object()
            .ok_or("JSON must contain one root element.")?;
        if obj.len() != 1 {
            return Err("JSON must contain exactly one root element.".into());
        }
        fn esc(s: &str) -> String {
            s.replace('&', "&amp;")
                .replace('<', "&lt;")
                .replace('>', "&gt;")
                .replace('"', "&quot;")
        }
        fn emit(name: &str, v: &Value, depth: usize) -> Result<String, String> {
            if depth > 64 {
                return Err("Nesting exceeds 64 levels.".into());
            }
            if !regex::Regex::new(r"^[A-Za-z_][A-Za-z0-9_.-]*$")
                .unwrap()
                .is_match(name)
            {
                return Err(format!("Invalid or namespace-qualified XML name: {name}"));
            }
            if let Some(a) = v.as_array() {
                return a
                    .iter()
                    .map(|v| emit(name, v, depth + 1))
                    .collect::<Result<Vec<_>, _>>()
                    .map(|v| v.join(""));
            }
            let scalar = |v: &Value| {
                v.as_str().map(str::to_string).unwrap_or_else(|| {
                    if v.is_null() {
                        String::new()
                    } else {
                        v.to_string()
                    }
                })
            };
            let mut out = format!("<{name}");
            let mut body = String::new();
            if let Some(m) = v.as_object() {
                for (k, v) in m {
                    if let Some(attr) = k.strip_prefix('@') {
                        if !regex::Regex::new(r"^[A-Za-z_][A-Za-z0-9_.-]*$")
                            .unwrap()
                            .is_match(attr)
                            || v.is_object()
                            || v.is_array()
                        {
                            return Err("Invalid XML attribute.".into());
                        }
                        out.push_str(&format!(" {attr}=\"{}\"", esc(&scalar(v))))
                    }
                }
                if m.contains_key("#text") && m.keys().any(|k| !k.starts_with('@') && k != "#text")
                {
                    return Err("Mixed text/element content is not supported.".into());
                }
                for (k, v) in m {
                    if k == "#text" {
                        body.push_str(&esc(&scalar(v)))
                    } else if !k.starts_with('@') {
                        body.push_str(&emit(k, v, depth + 1)?);
                    }
                }
            } else {
                body = esc(&scalar(v))
            }
            out.push_str(&format!(">{body}</{name}>"));
            Ok(out)
        }
        let (name, v) = obj.iter().next().unwrap();
        if v.is_array() {
            return Err("Root cannot be an array.".into());
        }
        Ok(code(emit(name, v, 0)?, "xml"))
    }
}
fn csv_work(input: &str, opts: &Value) -> Result<Value, String> {
    let mut reader = csv::Reader::from_reader(input.as_bytes());
    let headers = reader.headers().map_err(|e| e.to_string())?.clone();
    if headers.is_empty()
        || headers.iter().any(str::is_empty)
        || headers.iter().collect::<BTreeSet<_>>().len() != headers.len()
    {
        return Err("CSV needs nonempty, unique column names.".into());
    }
    if opts["preview"] == true {
        return Ok(
            json!({"kind":"data","headers":headers.iter().collect::<Vec<_>>(),"text":"Columns loaded."}),
        );
    }
    let columns = if let Some(a) = opts["columns"].as_array() {
        let mut cols = Vec::new();
        for c in a {
            let key = c["key"].as_str().ok_or("Invalid column.")?;
            let index = headers
                .iter()
                .position(|h| h == key)
                .ok_or("Column no longer exists; reload columns.")?;
            let name = c["name"].as_str().unwrap_or(key);
            if name.is_empty() {
                return Err("Column names cannot be empty.".into());
            }
            cols.push((index, name.to_string()))
        }
        cols
    } else {
        headers
            .iter()
            .enumerate()
            .map(|(i, h)| (i, h.into()))
            .collect()
    };
    if columns.is_empty() {
        return Err("Select at least one column.".into());
    }
    if columns.iter().map(|c| &c.1).collect::<BTreeSet<_>>().len() != columns.len() {
        return Err("Output column names must be unique.".into());
    }
    let filter = option(opts, "filterColumn", "");
    let filter_index = if filter.is_empty() {
        None
    } else {
        Some(
            headers
                .iter()
                .position(|h| h == filter)
                .ok_or("Unknown filter column.")?,
        )
    };
    let needle = option(opts, "filterValue", "");
    let mut rows = Vec::new();
    for r in reader.records() {
        let r = r.map_err(|e| e.to_string())?;
        if let Some(i) = filter_index {
            if !r.get(i).unwrap_or("").contains(needle) {
                continue;
            }
        }
        rows.push(r);
        crate::limits::check(rows.len(), 100_000, "CSV is limited to 100,000 rows.")?;
    }
    let sort = option(opts, "sortColumn", "");
    if !sort.is_empty() {
        let index = headers
            .iter()
            .position(|h| h == sort)
            .ok_or("Unknown sort column.")?;
        if opts["numeric"] == true {
            let mut decorated = rows
                .into_iter()
                .map(|r| super::number(r.get(index).unwrap_or("")).map(|n| (n, r)))
                .collect::<Result<Vec<_>, _>>()?;
            decorated.sort_by(|a, b| a.0.total_cmp(&b.0));
            rows = decorated.into_iter().map(|(_, r)| r).collect()
        } else {
            rows.sort_by(|a, b| a.get(index).cmp(&b.get(index)))
        }
        if opts["descending"] == true {
            rows.reverse()
        }
    }
    let mut writer = csv::Writer::from_writer(Vec::new());
    writer
        .write_record(columns.iter().map(|(_, name)| name))
        .map_err(|e| e.to_string())?;
    let mut preview = Vec::new();
    for r in &rows {
        writer
            .write_record(columns.iter().map(|(i, _)| r.get(*i).unwrap_or("")))
            .map_err(|e| e.to_string())?;
        if preview.len() < 500 {
            preview.push(Value::Object(
                columns
                    .iter()
                    .map(|(i, name)| (name.clone(), json!(r.get(*i).unwrap_or(""))))
                    .collect(),
            ))
        }
    }
    let bytes = writer.into_inner().map_err(|e| e.to_string())?;
    Ok(
        json!({"kind":"table","rows":preview,"totalRows":rows.len(),"text":String::from_utf8(bytes.clone()).unwrap(),"files":[file("result.csv","text/csv",&bytes)]}),
    )
}
