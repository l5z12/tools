// SPDX-License-Identifier: AGPL-3.0-only
use crate::workbench::{data, file};
use serde_json::{json, Value};
pub(super) fn optimize(input: &str) -> Result<Value, String> {
    use oxvg_ast::{parse::roxmltree::parse, serialize::Node as _, visitor::Info};
    let doc = roxmltree::Document::parse(input).map_err(|e| e.to_string())?;
    if doc.root_element().tag_name().name() != "svg" {
        return Err("Expected an SVG document.".into());
    }
    let mut ranges: Vec<_> = doc
        .descendants()
        .filter(|n| {
            n.is_element()
                && matches!(n.tag_name().name(), "script" | "foreignObject")
                && !n
                    .ancestors()
                    .skip(1)
                    .any(|a| matches!(a.tag_name().name(), "script" | "foreignObject"))
        })
        .map(|n| n.range())
        .collect();
    ranges.sort_by_key(|r| r.start);
    let mut clean = input.to_string();
    for range in ranges.into_iter().rev() {
        clean.replace_range(range, "");
    }
    let output = parse(&clean, |dom, allocator| {
        let mut jobs = oxvg_optimiser::Jobs::default();
        jobs.remove_scripts = Some(oxvg_optimiser::RemoveScripts(true));
        jobs.run(dom, &Info::new(allocator))
            .map_err(|e| e.to_string())?;
        dom.serialize().map_err(|e| e.to_string())
    })
    .map_err(|e| e.to_string())??;
    let mut result = data(json!({
        "originalBytes": input.len(),
        "optimizedBytes": output.len(),
        "savedPercent": 100.0 * (input.len() as f64 - output.len() as f64) / input.len().max(1) as f64,
    }));
    result["text"] = json!(output);
    result["files"] = json!([file("optimized.svg", "image/svg+xml", output.as_bytes())]);
    Ok(result)
}
