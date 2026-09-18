// SPDX-License-Identifier: AGPL-3.0-only
use serde_json::{json, Value};
use std::{cell::RefCell, collections::BTreeMap};
use wasm_bindgen::prelude::*;
struct Row {
    raw: Value,
    search: String,
    family: String,
    value: Option<u32>,
    end: Option<u32>,
    name: String,
}
struct Dataset {
    meta: Value,
    rows: Vec<Row>,
}
thread_local! {static DATA:RefCell<BTreeMap<String,Dataset>>=RefCell::new(BTreeMap::new());}
fn err(e: String) -> JsValue {
    JsValue::from_str(&e)
}
#[wasm_bindgen]
pub fn reference_load(key: &str, input: &str) -> Result<(), JsValue> {
    load(key, input).map_err(err)
}
fn load(key: &str, input: &str) -> Result<(), String> {
    if !["microsoft", "ldap", "http", "dns", "mime", "ports"].contains(&key)
        || input.len() > 32 * 1024 * 1024
    {
        return Err("Invalid reference dataset or size.".into());
    }
    let mut meta: Value = serde_json::from_str(input).map_err(|e| e.to_string())?;
    if meta["schema"] != 1 || meta["id"] != key {
        return Err("Reference dataset version mismatch.".into());
    }
    let source_rows = meta["rows"].as_array().ok_or("Missing reference rows.")?;
    if source_rows.len() > 100_000 {
        return Err("Reference dataset exceeds 100,000 rows.".into());
    }
    let mut rows = Vec::new();
    for raw in source_rows {
        let family = raw["family"].as_str().ok_or("Missing family.")?.to_owned();
        let name = raw["name"]
            .as_str()
            .ok_or("Missing symbolic name.")?
            .to_owned();
        let value = raw["value"]
            .as_u64()
            .map(|v| u32::try_from(v).map_err(|_| "Code exceeds 32 bits."))
            .transpose()?;
        let end = raw["end"]
            .as_u64()
            .map(|v| u32::try_from(v).map_err(|_| "Range exceeds 32 bits."))
            .transpose()?;
        let search = format!(
            "{} {} {} {} {}",
            family,
            raw["code"].as_str().unwrap_or(""),
            name,
            raw["description"].as_str().unwrap_or(""),
            raw["details"]
        )
        .to_lowercase();
        rows.push(Row {
            raw: raw.clone(),
            search,
            family,
            value,
            end,
            name,
        });
    }
    meta.as_object_mut().unwrap().remove("rows");
    DATA.with(|d| d.borrow_mut().insert(key.into(), Dataset { meta, rows }));
    Ok(())
}
fn parse_code(input: &str, base: &str) -> Result<u32, String> {
    let s = input.trim();
    if s.is_empty() {
        return Err("Enter an error code or symbolic name.".into());
    }
    let hex = s.strip_prefix("0x").or_else(|| s.strip_prefix("0X"));
    let is_hex = base == "Hexadecimal"
        || hex.is_some()
        || (base != "Decimal"
            && !s.starts_with(['-', '+'])
            && (s.len() == 8 || s.bytes().any(|b| b.is_ascii_alphabetic())));
    if is_hex {
        let digits = hex.unwrap_or(s);
        if digits.is_empty() || digits.len() > 8 || !digits.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err("Enter a hexadecimal value of up to eight digits.".into());
        }
        u32::from_str_radix(digits, 16).map_err(|e| e.to_string())
    } else {
        let n = s.parse::<i64>().map_err(|_| {
            "Enter signed/unsigned 32-bit decimal, hexadecimal, or an exact symbolic name."
        })?;
        if !(-2_147_483_648..=4_294_967_295).contains(&n) {
            return Err("Value is outside the 32-bit range.".into());
        }
        Ok(n as u32)
    }
}
fn numbers(s: &str) -> Vec<u32> {
    let digits = s.trim_start_matches(['-', '+']);
    if !(s.starts_with("0x")
        || s.starts_with("0X")
        || (!digits.is_empty() && digits.bytes().all(|b| b.is_ascii_digit()))
        || (s.len() == 8 && s.bytes().all(|b| b.is_ascii_hexdigit())))
    {
        return Vec::new();
    }
    let mut out = Vec::new();
    if let Ok(n) = parse_code(s, "Decimal") {
        out.push(n)
    }
    if let Ok(n) = parse_code(s, "Auto") {
        if !out.contains(&n) {
            out.push(n)
        }
    }
    out
}
fn page(d: &Dataset, entries: Vec<Value>, matches: usize, page: usize, size: usize) -> Value {
    json!({"dataset":d.meta["id"],"title":d.meta["title"],"generated":d.meta["generated"],"notice":d.meta["notice"],"sources":d.meta["sources"],"matches":matches,"total":d.rows.len(),"page":page,"pageSize":size,"entries":entries,"download":format!("/data/references/{}.json",d.meta["id"].as_str().unwrap())})
}
#[wasm_bindgen]
pub fn reference_search(
    key: &str,
    query: &str,
    family: &str,
    requested_page: u32,
) -> Result<String, JsValue> {
    search(key, query, family, requested_page)
        .map(|v| v.to_string())
        .map_err(err)
}
fn search(key: &str, query: &str, family: &str, requested_page: u32) -> Result<Value, String> {
    crate::limits::check(
        query.len(),
        512,
        "Reference searches are limited to 512 bytes.",
    )?;
    DATA.with(|db|{let db=db.borrow();let d=db.get(key).ok_or("Reference dataset has not loaded.")?;let q=query.trim().to_lowercase();let nums=numbers(&q);let words:Vec<_>=q.split_whitespace().collect();let matches:Vec<_>=d.rows.iter().filter(|r|(family=="All"||family.is_empty()||r.family==family)&&if !nums.is_empty(){nums.iter().any(|n|r.value.is_some_and(|v|*n>=v&&*n<=r.end.unwrap_or(v)))}else{words.iter().all(|w|r.search.contains(w))}).collect();let size=50;let current=(requested_page as usize).min(matches.len().saturating_sub(1)/size);let entries:Vec<_>=matches.iter().skip(current*size).take(size).map(|r|r.raw.clone()).collect();Ok(json!({"kind":"reference","text":serde_json::to_string_pretty(&entries).unwrap(),"reference":page(d,entries,matches.len(),current,size)}))})
}
fn lookup(d: &Dataset, n: u32, family: &str) -> Vec<Value> {
    d.rows
        .iter()
        .filter(|r| r.value == Some(n) && r.family == family)
        .map(|r| r.raw.clone())
        .collect()
}
fn representation(n: u32) -> Value {
    json!({"hex":format!("0x{n:08X}"),"unsignedDecimal":n,"signedDecimal":n as i32,"binary":format!("{n:032b}")})
}
fn field(label: &str, high: u32, low: u32, n: u32) -> Value {
    json!({"label":label,"high":high,"low":low,"value":(n>>low)&((1u32<<(high-low+1))-1)})
}
#[wasm_bindgen]
pub fn reference_decode(id: &str, input: &str, options: &str) -> Result<String, JsValue> {
    decode(id, input, options)
        .map(|v| v.to_string())
        .map_err(err)
}
fn decode(id: &str, input: &str, options: &str) -> Result<Value, String> {
    crate::limits::check(input.len(), 512, "Code input exceeds the size limit.")?;
    crate::limits::check(options.len(), 4096, "Code input exceeds the size limit.")?;
    let o: Value = serde_json::from_str(options).map_err(|e| e.to_string())?;
    DATA.with(|db|{let db=db.borrow();let d=db.get("microsoft").ok_or("Microsoft reference has not loaded.")?;let direction=o["direction"].as_str().unwrap_or("Win32 to HRESULT");let family=match id{"hresult-decode"=>"HRESULT","ntstatus-decode"=>"NTSTATUS","win32-hresult"=>if direction=="HRESULT to Win32"{"HRESULT"}else{"Win32"},_=>return Err("Unknown error decoder.".into())};let symbol=d.rows.iter().find(|r|r.family==family&&r.name.eq_ignore_ascii_case(input.trim())).and_then(|r|r.value);let n=match symbol{Some(n)=>n,None=>parse_code(input,o["base"].as_str().unwrap_or("Auto"))?};let mut data=representation(n);let mut entries=lookup(d,n,family);let mut fields=Vec::new();let mut notes=Vec::new();
match id{
"hresult-decode"=>{let nt=n&0x10000000!=0;let facility=(n>>16)&0x7ff;data["severity"]=json!(if n&0x80000000!=0{"Failure"}else{"Success"});data["customerDefined"]=json!(n&0x20000000!=0);data["NTSTATUSWrapped"]=json!(nt);data["facility"]=json!(facility);data["facilityNames"]=d.meta["facilities"][facility.to_string()].clone();data["code"]=json!(n&0xffff);fields=vec![field("Severity",31,31,n),field("R",30,30,n),field("Customer",29,29,n),field("NT",28,28,n),field("X",27,27,n),field("Facility",26,16,n),field("Code",15,0,n)];if nt{let status=n&!0x10000000;data["underlyingNTSTATUS"]=representation(status);data["NTFacility"]=json!((status>>16)&0xfff);data["facilityNames"]=Value::Null;entries.extend(lookup(d,status,"NTSTATUS"));notes.push("The NT bit marks a wrapped NTSTATUS; interpret the underlying status using its 12-bit facility.".to_string());}else{if n&0x48000000!=0{notes.push("Reserved R or X bits are set.".into())}if n&0xffff0000==0x80070000{let win32=n&0xffff;data["underlyingWin32"]=representation(win32);entries.extend(lookup(d,win32,"Win32"));}}},
"ntstatus-decode"=>{data["severity"]=json!(["Success","Informational","Warning","Error"][(n>>30)as usize]);data["NT_SUCCESS"]=json!((n as i32)>=0);data["customerDefined"]=json!(n&0x20000000!=0);data["reservedN"]=json!(n&0x10000000!=0);data["facility"]=json!((n>>16)&0xfff);data["code"]=json!(n&0xffff);fields=vec![field("Severity",31,30,n),field("Customer",29,29,n),field("Reserved N",28,28,n),field("Facility",27,16,n),field("Code",15,0,n)];if n&0x10000000!=0{notes.push("NTSTATUS reserved N bit is set; the value may already be a wrapped HRESULT.".into())}else{data["HRESULT_FROM_NT"]=representation(n|0x10000000);}},
"win32-hresult"=>{if direction=="HRESULT to Win32"{if n!=0&&n&0xffff0000!=0x80070000{return Err("This HRESULT is not zero or an 0x8007XXXX Win32 wrapper. There is no general reverse conversion.".into())}let value=n&0xffff;data["Win32"]=representation(value);entries.extend(lookup(d,value,"Win32"));notes.push("This recovers the low 16 bits only; original high bits, if truncated by the forward macro, are not recoverable.".into());}else{let value=if(n as i32)<=0{n}else{0x80070000|(n&0xffff)};data["HRESULT"]=representation(value);data["inputPreserved"]=json!((n as i32)<=0);entries.extend(lookup(d,value,"HRESULT"));if(n as i32)>0&&n>0xffff{notes.push("The macro truncates this positive input to its low 16 bits.".into())}if(n as i32)<=0{notes.push("HRESULT_FROM_WIN32 preserves zero and negative signed 32-bit inputs unchanged.".into())}}},_=>unreachable!()}
if entries.is_empty(){notes.push("No matching symbol in this MS-ERREF snapshot. Field decoding does not require a named entry.".into())}data["notes"]=json!(notes);let count=entries.len();Ok(json!({"kind":"reference","text":serde_json::to_string_pretty(&json!({"decoded":data,"matches":entries})).unwrap(),"data":data,"bits":fields,"reference":page(d,entries,count,0,50)}))})
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn numeric_formats() {
        assert_eq!(parse_code("-2147024891", "Auto").unwrap(), 0x80070005);
        assert_eq!(parse_code("80070005", "Auto").unwrap(), 0x80070005);
        assert_eq!(parse_code("80070005", "Decimal").unwrap(), 80070005);
        assert!(parse_code("4294967296", "Decimal").is_err());
        assert!(parse_code("-2147483649", "Auto").is_err());
        assert!(parse_code("0x100000000", "Auto").is_err());
    }
}
