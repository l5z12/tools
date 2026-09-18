// SPDX-License-Identifier: AGPL-3.0-only
use serde_json::{json, Value};

fn report(rows: Vec<Value>, summary: Value) -> Value {
    let text = serde_json::to_string_pretty(&json!({ "summary": summary, "rows": rows })).unwrap();
    json!({ "kind": "table", "rows": rows, "data": summary, "text": text })
}

pub fn har(text: &str) -> Result<Value, String> {
    let document: Value = serde_json::from_str(text).map_err(|e| e.to_string())?;
    let entries = document["log"]["entries"]
        .as_array()
        .ok_or("Expected a HAR object with log.entries.")?;
    if entries.len() > 10_000 {
        return Err("Use a HAR with at most 10,000 requests.".into());
    }
    let mut rows = Vec::new();
    let mut cumulative_ms = 0.;
    let mut failures = 0;
    let mut known_body_bytes = 0u64;
    for entry in entries {
        let url = entry["request"]["url"]
            .as_str()
            .ok_or("HAR entry has no request URL.")?;
        let duration = entry["time"].as_f64().filter(|v| *v >= 0.);
        let body_size = entry["response"]["bodySize"].as_u64();
        let status = entry["response"]["status"].as_u64();
        cumulative_ms += duration.unwrap_or(0.);
        if !cumulative_ms.is_finite() {
            return Err("Cumulative HAR duration exceeds the supported numeric range.".into());
        }
        known_body_bytes = known_body_bytes
            .checked_add(body_size.unwrap_or(0))
            .ok_or("Response byte total overflow.")?;
        failures += usize::from(status.is_some_and(|code| code >= 400 || code == 0));
        rows.push(json!({
            "method": entry["request"]["method"], "url": url,
            "host": url::Url::parse(url).ok().and_then(|url| url.host_str().map(str::to_string)),
            "status": status, "durationMs": duration, "bodyBytes": body_size,
            "mimeType": entry["response"]["content"]["mimeType"],
            "started": entry["startedDateTime"], "timings": entry["timings"],
        }));
    }
    rows.sort_by(|a, b| {
        b["durationMs"]
            .as_f64()
            .unwrap_or(-1.)
            .total_cmp(&a["durationMs"].as_f64().unwrap_or(-1.))
    });
    Ok(report(
        rows,
        json!({
            "requests": entries.len(), "failedRequests": failures,
            "cumulativeRequestMs": cumulative_ms,
            "knownResponseBodyBytes": known_body_bytes.to_string(),
        }),
    ))
}

pub fn sse(text: &str) -> Result<Value, String> {
    let normalized = text.replace("\r\n", "\n").replace('\r', "\n");
    let mut rows = Vec::new();
    let mut event_type = String::new();
    let mut data = String::new();
    let mut id = String::new();
    let mut retry: Option<String> = None;
    let mut comments = 0;
    // A single terminal newline ends a line; dispatch requires an empty line.
    for line in normalized.split_terminator('\n') {
        if line.is_empty() {
            if !data.is_empty() {
                data.pop();
                rows.push(json!({
                    "event": if event_type.is_empty() { "message" } else { &event_type },
                    "id": id, "data": data, "retryMs": retry,
                }));
                if rows.len() > 10_000 {
                    return Err("Use at most 10,000 SSE events.".into());
                }
            }
            data.clear();
            event_type.clear();
            continue;
        }
        if line.starts_with(':') {
            comments += 1;
            continue;
        }
        let (key, value) = line.split_once(':').unwrap_or((line, ""));
        let value = value.strip_prefix(' ').unwrap_or(value);
        match key {
            "data" => {
                data.push_str(value);
                data.push('\n');
            }
            "event" => event_type = value.to_string(),
            "id" if !value.contains('\0') => id = value.to_string(),
            "retry" if !value.is_empty() && value.bytes().all(|b| b.is_ascii_digit()) => {
                retry = Some(value.to_string())
            }
            _ => {}
        }
    }
    let summary = json!({ "events": rows.len(), "comments": comments, "lastEventId": id, "retryMs": retry, "undispatchedDataAtEnd": !data.is_empty() });
    Ok(report(rows, summary))
}
