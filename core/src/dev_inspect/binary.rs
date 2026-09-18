// SPDX-License-Identifier: AGPL-3.0-only
use crate::workbench::{data, file, table};
use serde_json::{json, Value};
use std::io::Cursor;

struct TreeBudget {
    remaining: usize,
}
impl TreeBudget {
    fn enter(&mut self, depth: usize) -> Result<(), String> {
        if depth > 64 || self.remaining == 0 {
            return Err("Decoded value exceeds 64 levels or 50,000 nodes.".into());
        }
        self.remaining -= 1;
        Ok(())
    }
    fn messagepack(&mut self, value: &rmpv::Value, depth: usize) -> Result<Value, String> {
        use rmpv::Value as M;
        self.enter(depth)?;
        Ok(match value {
            M::Nil => json!({ "type": "null" }),
            M::Boolean(v) => json!({ "type": "boolean", "value": v }),
            M::Integer(v) => json!({ "type": "integer", "value": v.to_string() }),
            M::F32(v) => json!({ "type": "float32", "value": v.to_string() }),
            M::F64(v) => json!({ "type": "float64", "value": v.to_string() }),
            M::String(v) => match v.as_str() {
                Some(text) => json!({ "type": "string", "value": text }),
                None => json!({ "type": "invalid UTF-8 string", "hex": hex::encode(v.as_bytes()) }),
            },
            M::Binary(v) => json!({ "type": "bytes", "hex": hex::encode(v) }),
            M::Ext(tag, v) => json!({ "type": "extension", "tag": tag, "hex": hex::encode(v) }),
            M::Array(values) => {
                let items = values
                    .iter()
                    .map(|v| self.messagepack(v, depth + 1))
                    .collect::<Result<Vec<_>, _>>()?;
                json!({ "type": "array", "items": items })
            }
            M::Map(values) => {
                let mut entries = Vec::new();
                for (key, value) in values {
                    entries.push(json!({ "key": self.messagepack(key, depth + 1)?, "value": self.messagepack(value, depth + 1)? }));
                }
                json!({ "type": "map", "entries": entries })
            }
        })
    }
}

pub fn inspect(id: &str, bytes: &[u8]) -> Result<Value, String> {
    let mut reader = Cursor::new(bytes);
    let mut budget = TreeBudget { remaining: 50_000 };
    if id == "dev-cbor-inspect" {
        return super::cbor::inspect(bytes);
    }
    super::msgpack::validate(bytes)?;
    let value =
        rmpv::decode::read_value_with_max_depth(&mut reader, 65).map_err(|e| e.to_string())?;
    let tree = budget.messagepack(&value, 0)?;
    if reader.position() != bytes.len() as u64 {
        return Err("Trailing bytes found. Provide exactly one encoded value.".into());
    }
    Ok(data(tree))
}

pub fn encode(id: &str, text: &str) -> Result<Value, String> {
    let input: Value = serde_json::from_str(text).map_err(|e| e.to_string())?;
    let mut bytes = Vec::new();
    let (filename, mime) = if id == "dev-json-msgpack" {
        let value = rmpv::ext::to_value(input).map_err(|e| e.to_string())?;
        rmpv::encode::write_value(&mut bytes, &value).map_err(|e| e.to_string())?;
        ("data.msgpack", "application/msgpack")
    } else {
        ciborium::into_writer(&input, &mut bytes).map_err(|e| e.to_string())?;
        ("data.cbor", "application/cbor")
    };
    Ok(json!({
        "kind": "code", "text": hex::encode(&bytes),
        "files": [file(filename, mime, &bytes)],
    }))
}

fn varint(bytes: &[u8], cursor: &mut usize) -> Result<u64, String> {
    let mut value = 0u64;
    for index in 0..10 {
        let byte = *bytes.get(*cursor).ok_or("Truncated varint.")?;
        *cursor += 1;
        if index == 9 && byte > 1 {
            return Err("Varint exceeds 64 bits.".into());
        }
        value |= u64::from(byte & 0x7f) << (index * 7);
        if byte & 0x80 == 0 {
            return Ok(value);
        }
    }
    Err("Invalid varint.".into())
}
fn take<'a>(bytes: &'a [u8], cursor: &mut usize, length: usize) -> Result<&'a [u8], String> {
    let end = cursor.checked_add(length).ok_or("Field length overflow.")?;
    let value = bytes.get(*cursor..end).ok_or("Truncated field payload.")?;
    *cursor = end;
    Ok(value)
}
pub fn protobuf(bytes: &[u8]) -> Result<Value, String> {
    let mut cursor = 0;
    let mut rows = Vec::new();
    let mut groups = Vec::new();
    while cursor < bytes.len() {
        if rows.len() >= 10_000 {
            return Err("Use at most 10,000 wire fields.".into());
        }
        let offset = cursor;
        let key = varint(bytes, &mut cursor)?;
        let field = key >> 3;
        if field == 0 || field > 536_870_911 {
            return Err("Invalid Protobuf field number.".into());
        }
        let wire = key & 7;
        let value = match wire {
            0 => json!({ "unsignedVarint": varint(bytes, &mut cursor)?.to_string() }),
            1 => {
                let payload: [u8; 8] = take(bytes, &mut cursor, 8)?.try_into().unwrap();
                json!({ "unsignedFixed64": u64::from_le_bytes(payload).to_string(), "hex": hex::encode(payload) })
            }
            2 => {
                let length = usize::try_from(varint(bytes, &mut cursor)?)
                    .map_err(|_| "Field length exceeds this platform.")?;
                let payload = take(bytes, &mut cursor, length)?;
                json!({ "length": length, "hex": hex::encode(payload), "utf8Candidate": std::str::from_utf8(payload).ok() })
            }
            3 => {
                if groups.len() >= 64 {
                    return Err("Group nesting exceeds 64 levels.".into());
                }
                groups.push(field);
                json!({ "group": "start" })
            }
            4 => {
                if groups.pop() != Some(field) {
                    return Err("Mismatched Protobuf end-group.".into());
                }
                json!({ "group": "end" })
            }
            5 => {
                let payload: [u8; 4] = take(bytes, &mut cursor, 4)?.try_into().unwrap();
                json!({ "unsignedFixed32": u32::from_le_bytes(payload).to_string(), "hex": hex::encode(payload) })
            }
            _ => return Err(format!("Invalid wire type {wire} at byte {offset}.")),
        };
        rows.push(json!({ "offset": offset, "field": field, "wireType": wire, "value": value }));
    }
    if !groups.is_empty() {
        return Err("Unclosed Protobuf group.".into());
    }
    Ok(table(rows))
}
