// SPDX-License-Identifier: AGPL-3.0-only
use crate::workbench::{file, option};
use serde_json::{json, Value};
use std::{collections::HashSet, io::Read};
mod create;
mod read;
pub const LIMIT: usize = 64 * 1024 * 1024;
pub const ENTRY_LIMIT: usize = 500;
pub struct ArchiveFile {
    pub name: String,
    pub bytes: Vec<u8>,
}
pub fn claim_path(names: &mut HashSet<String>, name: &str) -> bool {
    let key = name.to_lowercase();
    if !safe_path(name)
        || name.ends_with('/')
        || names.iter().any(|other| {
            other == &key
                || key.starts_with(&format!("{other}/"))
                || other.starts_with(&format!("{key}/"))
        })
    {
        return false;
    }
    names.insert(key)
}

/// Restrict names to portable relative paths; never interpret them as filesystem targets.
pub fn safe_path(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 1024
        && !name.starts_with('/')
        && !name.contains('\\')
        && !name
            .chars()
            .any(|c| c.is_control() || ":*?\"<>|".contains(c))
        && name.trim_end_matches('/').split('/').all(|part| {
            let stem = part.split('.').next().unwrap_or("").to_ascii_uppercase();
            !part.is_empty()
                && part != "."
                && part != ".."
                && !part.ends_with(['.', ' '])
                && ![
                    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6",
                    "COM7", "COM8", "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7",
                    "LPT8", "LPT9",
                ]
                .contains(&stem.as_str())
        })
}
pub fn bounded(reader: &mut dyn Read, remaining: usize) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    reader
        .take((remaining + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() > remaining {
        return Err("Expanded archive exceeds 64 MiB.".into());
    }
    Ok(bytes)
}
pub fn create(bytes: &[u8], options: &Value) -> Result<Value, String> {
    let manifest = options["entries"]
        .as_array()
        .ok_or("Choose files to archive.")?;
    if manifest.is_empty() || manifest.len() > ENTRY_LIMIT {
        return Err("Choose 1–500 files.".into());
    }
    let mut offset = 0usize;
    let mut names = HashSet::new();
    let mut files = Vec::new();
    for entry in manifest {
        let name = entry["name"].as_str().ok_or("Missing archive path.")?;
        if !claim_path(&mut names, name) {
            return Err(format!("Unsafe or duplicate archive path: {name}"));
        }
        let size = entry["size"].as_u64().ok_or("Invalid file size.")?;
        if size > bytes.len() as u64 {
            return Err("Invalid file size.".into());
        }
        let end = offset
            .checked_add(size as usize)
            .filter(|end| *end <= bytes.len())
            .ok_or("File manifest exceeds input.")?;
        files.push(ArchiveFile {
            name: name.into(),
            bytes: bytes[offset..end].to_vec(),
        });
        offset = end;
    }
    if offset != bytes.len() {
        return Err("File manifest does not match input.".into());
    }
    build_result(&files, options)
}
pub fn build_result(files: &[ArchiveFile], options: &Value) -> Result<Value, String> {
    if files.is_empty() {
        return Err("No safe regular files selected.".into());
    }
    let format = option(options, "format", "zip");
    let bytes = create::encode(files, options)?;
    let stem = option(options, "archiveName", "archive");
    if !safe_path(stem) || stem.contains('/') {
        return Err("Use a plain archive name without folders.".into());
    }
    let name = format!("{stem}.{format}");
    let data = json!({"format":format,"files":files.len(),"inputBytes":files.iter().map(|f| f.bytes.len()).sum::<usize>(),"archiveBytes":bytes.len(),"encrypted":!option(options,"outputPassword","").is_empty()});
    Ok(
        json!({"kind":"data","text":serde_json::to_string_pretty(&data).unwrap(),"data":data,"files":[file(&name,"application/octet-stream",&bytes)]}),
    )
}
pub fn explore(bytes: &[u8], options: &Value) -> Result<Value, String> {
    read::explore(bytes, options)
}
