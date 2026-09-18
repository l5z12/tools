// SPDX-License-Identifier: AGPL-3.0-only
use serde::de::{DeserializeSeed, Deserializer, Error, MapAccess, SeqAccess, Visitor};
use serde_json::{json, Value};
use std::{collections::BTreeMap, fmt};

#[derive(Default)]
struct Audit {
    rows: Vec<Value>,
    nodes: usize,
}
struct Walker<'a> {
    audit: &'a mut Audit,
    path: String,
}

fn child_path(parent: &str, key: &str) -> String {
    format!("{parent}/{}", key.replace('~', "~0").replace('/', "~1"))
}
impl<'de> DeserializeSeed<'de> for Walker<'_> {
    type Value = ();
    fn deserialize<D: Deserializer<'de>>(self, deserializer: D) -> Result<(), D::Error> {
        self.audit.nodes += 1;
        if self.audit.nodes > 100_000 {
            return Err(D::Error::custom("Use at most 100,000 JSON values."));
        }
        deserializer.deserialize_any(self)
    }
}
impl<'de> Visitor<'de> for Walker<'_> {
    type Value = ();
    fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
        formatter.write_str("a JSON value")
    }
    fn visit_unit<E: Error>(self) -> Result<(), E> {
        Ok(())
    }
    fn visit_bool<E: Error>(self, _: bool) -> Result<(), E> {
        Ok(())
    }
    fn visit_i64<E: Error>(self, _: i64) -> Result<(), E> {
        Ok(())
    }
    fn visit_u64<E: Error>(self, _: u64) -> Result<(), E> {
        Ok(())
    }
    fn visit_f64<E: Error>(self, _: f64) -> Result<(), E> {
        Ok(())
    }
    fn visit_str<E: Error>(self, _: &str) -> Result<(), E> {
        Ok(())
    }
    fn visit_seq<A: SeqAccess<'de>>(self, mut sequence: A) -> Result<(), A::Error> {
        let mut index = 0;
        while sequence
            .next_element_seed(Walker {
                audit: self.audit,
                path: child_path(&self.path, &index.to_string()),
            })?
            .is_some()
        {
            index += 1;
        }
        Ok(())
    }
    fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<(), A::Error> {
        let mut seen: BTreeMap<String, usize> = BTreeMap::new();
        while let Some(key) = map.next_key::<String>()? {
            let count = seen.entry(key.clone()).or_default();
            *count += 1;
            let path = child_path(&self.path, &key);
            if *count > 1 {
                self.audit
                    .rows
                    .push(json!({ "pointer": path, "key": key, "occurrence": count }));
            }
            map.next_value_seed(Walker {
                audit: self.audit,
                path,
            })?;
        }
        Ok(())
    }
}
pub fn inspect(text: &str) -> Result<Value, String> {
    let mut audit = Audit::default();
    let mut deserializer = serde_json::Deserializer::from_str(text);
    Walker {
        audit: &mut audit,
        path: String::new(),
    }
    .deserialize(&mut deserializer)
    .map_err(|e| e.to_string())?;
    deserializer.end().map_err(|e| e.to_string())?;
    let summary = json!({ "validJson": true, "duplicateOccurrences": audit.rows.len(), "valuesVisited": audit.nodes });
    let text =
        serde_json::to_string_pretty(&json!({ "summary": summary, "duplicates": audit.rows }))
            .unwrap();
    Ok(json!({ "kind": "table", "rows": audit.rows, "data": summary, "text": text }))
}
