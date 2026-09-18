// SPDX-License-Identifier: AGPL-3.0-only
use ciborium_ll::{Decoder, Header};
use serde_json::{json, Value};

struct Reader<'a> {
    decoder: Decoder<&'a [u8]>,
    remaining_nodes: usize,
}
impl Reader<'_> {
    fn header(&mut self) -> Result<Header, String> {
        self.decoder
            .pull()
            .map_err(|e| format!("Invalid CBOR: {e:?}"))
    }
    fn value(&mut self, depth: usize) -> Result<Value, String> {
        if depth > 64 || self.remaining_nodes == 0 {
            return Err("Decoded value exceeds 64 levels or 50,000 nodes.".into());
        }
        self.remaining_nodes -= 1;
        Ok(match self.header()? {
            Header::Positive(value) => json!({ "type": "integer", "value": value.to_string() }),
            Header::Negative(value) => {
                json!({ "type": "integer", "value": (-1 - value as i128).to_string() })
            }
            Header::Float(value) => json!({ "type": "float", "value": value.to_string() }),
            Header::Simple(20) => json!({ "type": "boolean", "value": false }),
            Header::Simple(21) => json!({ "type": "boolean", "value": true }),
            Header::Simple(22) => json!({ "type": "null" }),
            Header::Simple(23) => json!({ "type": "undefined" }),
            Header::Simple(value) => json!({ "type": "simple", "value": value }),
            Header::Tag(tag) => {
                json!({ "type": "tag", "tag": tag.to_string(), "value": self.value(depth + 1)? })
            }
            Header::Bytes(length) => {
                let mut buffer = [0u8; 4096];
                let mut bytes = Vec::new();
                let mut segments = self.decoder.bytes(length);
                while let Some(mut segment) =
                    segments.pull().map_err(|e| format!("CBOR bytes: {e:?}"))?
                {
                    while let Some(chunk) = segment
                        .pull(&mut buffer)
                        .map_err(|e| format!("CBOR bytes: {e:?}"))?
                    {
                        bytes.extend_from_slice(chunk);
                    }
                }
                json!({ "type": "bytes", "hex": hex::encode(bytes) })
            }
            Header::Text(length) => {
                let mut buffer = [0u8; 4096];
                let mut text = String::new();
                let mut segments = self.decoder.text(length);
                while let Some(mut segment) =
                    segments.pull().map_err(|e| format!("CBOR text: {e:?}"))?
                {
                    while let Some(chunk) = segment
                        .pull(&mut buffer)
                        .map_err(|e| format!("CBOR text: {e:?}"))?
                    {
                        text.push_str(chunk);
                    }
                }
                json!({ "type": "string", "value": text })
            }
            Header::Array(length) => {
                let mut items = Vec::new();
                while self.has_next(length, items.len())? {
                    items.push(self.value(depth + 1)?);
                }
                json!({ "type": "array", "items": items })
            }
            Header::Map(length) => {
                let mut entries = Vec::new();
                while self.has_next(length, entries.len())? {
                    let key = self.value(depth + 1)?;
                    let value = self.value(depth + 1)?;
                    entries.push(json!({ "key": key, "value": value }));
                }
                json!({ "type": "map", "entries": entries })
            }
            Header::Break => {
                return Err("Unexpected CBOR break outside an indefinite container.".into())
            }
        })
    }
    fn has_next(&mut self, length: Option<usize>, count: usize) -> Result<bool, String> {
        if let Some(length) = length {
            return Ok(count < length);
        }
        let header = self.header()?;
        if header == Header::Break {
            return Ok(false);
        }
        self.decoder.push(header);
        Ok(true)
    }
}
pub fn inspect(bytes: &[u8]) -> Result<Value, String> {
    let mut reader = Reader {
        decoder: Decoder::from(bytes),
        remaining_nodes: 50_000,
    };
    let tree = reader.value(0)?;
    if reader.decoder.offset() != bytes.len() {
        return Err("Trailing bytes found. Provide exactly one encoded value.".into());
    }
    Ok(crate::workbench::data(tree))
}
