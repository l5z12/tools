// SPDX-License-Identifier: AGPL-3.0-only
use super::report;
use crate::workbench::{file, option};
use serde_json::{json, Value};
use std::net::Ipv4Addr;
use url::Url;

fn tracking_parameter(name: &str) -> bool {
    let name = name.to_ascii_lowercase();
    name.starts_with("utm_")
        || ["fbclid", "gclid", "dclid", "msclkid", "mc_cid", "mc_eid"].contains(&name.as_str())
}

pub(super) fn clean_urls(input: &str, options: &Value) -> Result<Value, String> {
    let mut rows = Vec::new();
    let mut cleaned = Vec::new();
    for line in input.lines().filter(|line| !line.trim().is_empty()) {
        if rows.len() >= 1000 {
            return Err("URL cleanup is limited to 1,000 links.".into());
        }
        let original = line.trim();
        let mut url = Url::parse(original).map_err(|error| format!("Invalid URL: {error}"))?;
        if !["http", "https"].contains(&url.scheme()) {
            return Err("Only HTTP and HTTPS URLs are supported.".into());
        }
        let pairs: Vec<(String, String)> = url
            .query_pairs()
            .map(|(name, value)| (name.into_owned(), value.into_owned()))
            .collect();
        let removed: Vec<_> = pairs
            .iter()
            .filter(|(name, _)| tracking_parameter(name))
            .map(|(name, _)| name.clone())
            .collect();
        if !removed.is_empty() {
            url.set_query(None);
            let retained: Vec<_> = pairs
                .iter()
                .filter(|(name, _)| !tracking_parameter(name))
                .collect();
            if !retained.is_empty() {
                let mut query = url.query_pairs_mut();
                for (name, value) in retained {
                    query.append_pair(name, value);
                }
            }
        }
        let fragment_removed = options["fragment"] == true && url.fragment().is_some();
        if options["fragment"] == true {
            url.set_fragment(None);
        }
        let result = url.to_string();
        rows.push(json!({"original": original, "cleaned": result, "removedParameters": removed.join(", "), "fragmentRemoved": fragment_removed}));
        cleaned.push(result);
    }
    let mut result = report(rows, json!({"links": cleaned.len()}), "url-changes.json")?;
    result["files"].as_array_mut().unwrap().insert(
        0,
        file(
            "clean-urls.txt",
            "text/plain",
            cleaned.join("\n").as_bytes(),
        ),
    );
    Ok(result)
}

pub(super) fn ip_range(input: &str, options: &Value) -> Result<Value, String> {
    let first = input
        .trim()
        .parse::<Ipv4Addr>()
        .map_err(|_| "Enter a valid first IPv4 address.")?;
    let last = option(options, "end", "")
        .trim()
        .parse::<Ipv4Addr>()
        .map_err(|_| "Enter a valid last IPv4 address.")?;
    let mut current = u32::from(first) as u64;
    let end = u32::from(last) as u64;
    if current > end {
        return Err("The last address must not precede the first.".into());
    }
    let mut rows = Vec::new();
    let mut networks = Vec::new();
    while current <= end {
        let alignment_bits = if current == 0 {
            32
        } else {
            current.trailing_zeros().min(32)
        };
        let remaining = end - current + 1;
        let capacity_bits = 63 - remaining.leading_zeros();
        let host_bits = alignment_bits.min(capacity_bits);
        let count = 1u64 << host_bits;
        let start_address = Ipv4Addr::from(current as u32);
        let final_address = Ipv4Addr::from((current + count - 1) as u32);
        let cidr = format!("{start_address}/{}", 32 - host_bits);
        rows.push(json!({"cidr": cidr, "first": start_address.to_string(), "last": final_address.to_string(), "addresses": count}));
        networks.push(cidr);
        current += count;
    }
    let mut result = report(
        rows,
        json!({"first": first.to_string(), "last": last.to_string(), "addresses": end - u32::from(first) as u64 + 1, "blocks": networks.len()}),
        "cidr-report.json",
    )?;
    result["files"].as_array_mut().unwrap().insert(
        0,
        file("networks.txt", "text/plain", networks.join("\n").as_bytes()),
    );
    Ok(result)
}
