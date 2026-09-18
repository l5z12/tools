// SPDX-License-Identifier: AGPL-3.0-only
use crate::workbench::{code, data, file};
use serde_json::{json, Value};
use wasmparser::{Parser, Payload, Validator};

pub fn execute(id: &str, bytes: &[u8]) -> Result<Value, String> {
    if id == "wasm-compile" {
        let source = std::str::from_utf8(bytes).map_err(|_| "WAT must be UTF-8 text.")?;
        let binary = wat::parse_str(source).map_err(|e| e.to_string())?;
        Validator::new()
            .validate_all(&binary)
            .map_err(|e| e.to_string())?;
        return Ok(
            json!({"kind":"data","data":{"valid":true,"bytes":binary.len()},"files":[file("module.wasm","application/wasm",&binary)]}),
        );
    }
    Validator::new()
        .validate_all(bytes)
        .map_err(|e| e.to_string())?;
    if id == "wasm-disassemble" {
        let text = wasmprinter::print_bytes(bytes).map_err(|e| e.to_string())?;
        let mut result = code(text.clone(), "wat");
        result["files"] = json!([file("module.wat", "text/plain", text.as_bytes())]);
        return Ok(result);
    }
    if id != "wasm-inspect" {
        return Err("Unknown WebAssembly tool.".into());
    }
    let mut sections = Vec::new();
    let mut exports = Vec::new();
    let mut custom = Vec::new();
    for payload in Parser::new(0).parse_all(bytes) {
        let payload = payload.map_err(|e| e.to_string())?;
        if let Some((id, range)) = payload.as_section() {
            sections.push(json!({"id":id,"offset":range.start,"bytes":range.end-range.start}));
        }
        match payload {
            Payload::ExportSection(reader) => {
                for export in reader {
                    let export = export.map_err(|e| e.to_string())?;
                    exports.push(json!({"name":export.name,"kind":format!("{:?}",export.kind),"index":export.index}));
                }
            }
            Payload::CustomSection(section) => {
                custom.push(json!({"name":section.name(),"bytes":section.data().len()}))
            }
            _ => {}
        }
    }
    Ok(data(
        json!({"valid":true,"bytes":bytes.len(),"sections":sections,"exports":exports,"customSections":custom}),
    ))
}
