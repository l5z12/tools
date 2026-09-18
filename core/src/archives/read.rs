// SPDX-License-Identifier: AGPL-3.0-only
use super::{bounded, build_result, claim_path, ArchiveFile, ENTRY_LIMIT, LIMIT};
use crate::workbench::{file, option};
use serde_json::{json, Value};
use std::{
    collections::HashSet,
    io::{Cursor, Read},
};
mod rar;

struct Inspection<'a> {
    mode: &'a str,
    selected: HashSet<String>,
    select_all: bool,
    names: HashSet<String>,
    rows: Vec<Value>,
    files: Vec<ArchiveFile>,
    declared: u64,
    expanded: usize,
}
impl Inspection<'_> {
    fn record(&mut self, name: &str, size: u64, regular: bool) -> Result<bool, String> {
        if crate::limits::at_least(self.rows.len(), ENTRY_LIMIT) {
            return Err("Archive exceeds 500 entries.".into());
        }
        self.declared = self
            .declared
            .checked_add(size)
            .ok_or("Invalid archive sizes.")?;
        if !crate::limits::enabled() && self.declared > LIMIT as u64 {
            return Err("Declared archive expansion exceeds 64 MiB.".into());
        }
        let safe = regular && claim_path(&mut self.names, name);
        let selected = self.select_all || self.selected.contains(name);
        self.rows.push(json!({"name":name,"bytes":size,"type":if regular {"file"}else{"directory or link"},"extractable":safe,"selected":selected && safe}));
        Ok(safe && selected && ["extract", "repack"].contains(&self.mode))
    }

    fn accept(
        &mut self,
        name: &str,
        size: u64,
        regular: bool,
        reader: &mut dyn Read,
    ) -> Result<(), String> {
        let keep = self.record(name, size, regular)?;
        if self.mode != "inspect" {
            // Drain every stream: solid blocks, CRC checks and cumulative limits include skipped entries.
            let bytes = bounded(reader, LIMIT - self.expanded)?;
            self.expanded += bytes.len();
            if bytes.len() as u64 != size {
                return Err(format!("Size mismatch in {name}."));
            }
            if keep {
                self.files.push(ArchiveFile {
                    name: name.into(),
                    bytes,
                });
            }
        }
        Ok(())
    }
}
pub fn explore(bytes: &[u8], options: &Value) -> Result<Value, String> {
    let mode = option(options, "mode", "inspect");
    if !["inspect", "test", "extract", "repack"].contains(&mode) {
        return Err("Unknown archive operation.".into());
    }
    let password = option(options, "password", "");
    crate::limits::check(password.len(), 1024, "Password exceeds 1024 bytes.")?;
    let selected: HashSet<String> = options["selected"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();
    let mut job = Inspection {
        mode,
        selected,
        select_all: !options["selected"].is_array(),
        names: HashSet::new(),
        rows: vec![],
        files: vec![],
        declared: 0,
        expanded: 0,
    };
    let format;
    if rar::matches(bytes) {
        format = "rar";
        rar::inspect(bytes, password, &mut job)?;
    } else if bytes.starts_with(b"PK") {
        format = "zip";
        let mut archive = zip::ZipArchive::new(Cursor::new(bytes)).map_err(|e| e.to_string())?;
        if crate::limits::over(archive.len(), ENTRY_LIMIT) {
            return Err("Archive exceeds 500 entries.".into());
        }
        for index in 0..archive.len() {
            if mode == "inspect" {
                let entry = archive.by_index_raw(index).map_err(|e| e.to_string())?;
                let regular = entry.is_file()
                    && entry
                        .unix_mode()
                        .map(|m| m & 0o170000 != 0o120000)
                        .unwrap_or(true);
                job.accept(entry.name(), entry.size(), regular, &mut std::io::empty())?;
            } else {
                let mut entry = if password.is_empty() {
                    archive.by_index(index)
                } else {
                    archive.by_index_decrypt(index, password.as_bytes())
                }
                .map_err(|e| e.to_string())?;
                let regular = entry.is_file()
                    && entry
                        .unix_mode()
                        .map(|m| m & 0o170000 != 0o120000)
                        .unwrap_or(true);
                let name = entry.name().to_owned();
                let size = entry.size();
                job.accept(&name, size, regular, &mut entry)?;
            }
        }
    } else if bytes.starts_with(&[0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]) {
        format = "7z";
        let mut archive = sevenz_rust2::ArchiveReader::new(Cursor::new(bytes), password.into())
            .map_err(|e| e.to_string())?;
        archive.set_thread_count(1);
        if crate::limits::over(archive.archive().files.len(), ENTRY_LIMIT) {
            return Err("Archive exceeds 500 entries.".into());
        }
        let declared = archive
            .archive()
            .files
            .iter()
            .try_fold(0u64, |sum, f| sum.checked_add(f.size))
            .ok_or("Invalid archive sizes.")?;
        if !crate::limits::enabled() && declared > LIMIT as u64 {
            return Err("Declared archive expansion exceeds 64 MiB.".into());
        }
        let regular = |entry: &sevenz_rust2::ArchiveEntry| {
            !entry.is_directory
                && !entry.is_anti_item
                && (!entry.has_windows_attributes
                    || (entry.windows_attributes & 0x400 == 0
                        && (entry.windows_attributes >> 16) & 0o170000 != 0o120000))
        };
        if mode == "inspect" {
            for entry in &archive.archive().files {
                job.accept(
                    &entry.name,
                    entry.size,
                    regular(entry),
                    &mut std::io::empty(),
                )?;
            }
        } else {
            archive
                .for_each_entries(|entry, reader| {
                    job.accept(&entry.name, entry.size, regular(entry), reader)
                        .map(|_| true)
                        .map_err(|e| sevenz_rust2::Error::Other(e.into()))
                })
                .map_err(|e| e.to_string())?;
        }
    } else {
        let decoded;
        let tar_bytes = if bytes.starts_with(&[0x1f, 0x8b]) {
            format = "tar.gz";
            decoded = bounded(&mut flate2::read::MultiGzDecoder::new(bytes), LIMIT)?;
            decoded.as_slice()
        } else {
            format = "tar";
            bytes
        };
        if tar_bytes.len() < 1024 || tar_bytes.len() % 512 != 0 {
            return Err("Expected ZIP, RAR, TAR, TAR.GZ or 7z data.".into());
        }
        let mut archive = tar::Archive::new(tar_bytes);
        for entry in archive.entries().map_err(|e| e.to_string())? {
            let mut entry = entry.map_err(|e| e.to_string())?;
            let name = entry
                .path()
                .map_err(|e| e.to_string())?
                .to_str()
                .ok_or("Archive paths must be UTF-8.")?
                .to_owned();
            job.accept(
                &name,
                entry.size(),
                entry.header().entry_type().is_file(),
                &mut entry,
            )?;
        }
    }
    if mode == "repack" {
        let mut result = build_result(&job.files, options)?;
        result["data"]["sourceFormat"] = json!(format);
        result["data"]["skippedEntries"] =
            json!(job.rows.iter().filter(|r| r["selected"] != true).count());
        result["text"] = json!(serde_json::to_string_pretty(&result["data"]).unwrap());
        return Ok(result);
    }
    let files: Vec<Value> = job
        .files
        .iter()
        .enumerate()
        .map(|(index, f)| {
            file(
                &format!("{}-{}", index + 1, f.name.replace('/', "_")),
                "application/octet-stream",
                &f.bytes,
            )
        })
        .collect();
    let verification = match (mode, format) {
        ("test", "tar" | "tar.gz") => {
            "All payloads read; TAR has header checksums, not per-file content checksums."
        }
        ("test", "rar") => {
            "File payloads read and available CRC/hash checks verified; RAR link redirects are skipped."
        }
        ("test", _) => "All payloads read and available integrity checks verified.",
        _ => "Use Test to verify archive contents.",
    };
    let data = json!({
        "format": format,
        "entries": job.rows.len(),
        "expandedBytes": job.expanded,
        "operation": mode,
        "verification": verification,
    });
    Ok(
        json!({"kind":"table","text":serde_json::to_string_pretty(&job.rows).unwrap(),"rows":job.rows,"data":data,"files":files}),
    )
}
