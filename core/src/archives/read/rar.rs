// SPDX-License-Identifier: AGPL-3.0-only
use super::Inspection;
use crate::archives::{ArchiveFile, ENTRY_LIMIT, LIMIT};
use rars::{Archive, ArchiveFamily, ArchiveReadOptions, ArchiveReader};
use std::{cell::RefCell, io::Write, rc::Rc};

pub(super) fn matches(bytes: &[u8]) -> bool {
    bytes.starts_with(b"Rar!\x1a\x07\x00")
        || bytes.starts_with(b"Rar!\x1a\x07\x01\x00")
        || bytes.starts_with(b"RE\x7e\x5e")
}

struct Entry {
    raw_name: Vec<u8>,
    name: String,
    size: usize,
    keep: bool,
    redirected: bool,
}

#[derive(Default)]
struct Output {
    bytes: Vec<u8>,
    written: usize,
}

struct EntryWriter {
    output: Rc<RefCell<Output>>,
    total: Rc<RefCell<usize>>,
    expected: usize,
    keep: bool,
}

impl Write for EntryWriter {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        let mut output = self.output.borrow_mut();
        let mut total = self.total.borrow_mut();
        if bytes.len() > self.expected.saturating_sub(output.written)
            || bytes.len() > LIMIT.saturating_sub(*total)
        {
            return Err(std::io::Error::other(
                "RAR output exceeds its declared size or 64 MiB.",
            ));
        }
        output.written += bytes.len();
        *total += bytes.len();
        if self.keep {
            output.bytes.extend_from_slice(bytes);
        }
        Ok(bytes.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

fn check_archive(archive: &Archive) -> Result<Vec<bool>, String> {
    let mut redirected = Vec::new();
    match archive {
        Archive::Rar50Plus(archive) => {
            if archive.main.is_volume() {
                return Err(
                    "Multi-volume RAR sets are not supported. Choose a single-volume archive."
                        .into(),
                );
            }
            for file in archive.files() {
                let compression = file.decoded_compression_info().map_err(|e| e.to_string())?;
                if !file.is_stored() && compression.dictionary_size > LIMIT as u64 {
                    return Err("RAR dictionaries larger than 64 MiB are not supported.".into());
                }
                redirected.push(file.is_redirection());
            }
        }
        Archive::Rar15To40(archive) if archive.main.is_volume() => {
            return Err(
                "Multi-volume RAR sets are not supported. Choose a single-volume archive.".into(),
            );
        }
        _ => {}
    }
    Ok(redirected)
}

pub(super) fn inspect(
    bytes: &[u8],
    password: &str,
    job: &mut Inspection<'_>,
) -> Result<(), String> {
    let options = ArchiveReadOptions::with_optional_password(
        (!password.is_empty()).then_some(password.as_bytes()),
    )
    .with_rar50_buffered_decode_limit(LIMIT as u64);
    let archive = ArchiveReader::read_with_options(bytes, options).map_err(|e| e.to_string())?;
    let redirected = check_archive(&archive)?;
    let mut entries = Vec::new();
    for (index, member) in archive.members().enumerate() {
        if index >= ENTRY_LIMIT {
            return Err("Archive exceeds 500 entries.".into());
        }
        let meta = member.meta;
        if meta.is_split_before || meta.is_split_after {
            return Err(
                "Split RAR entries require a complete volume set and are not supported.".into(),
            );
        }
        let unix = match meta.family {
            ArchiveFamily::Rar50Plus => meta.host_os == Some(1),
            ArchiveFamily::Rar15To40 => meta.host_os == Some(3),
            _ => false,
        };
        let kind = meta.file_attr & 0o170000;
        let is_link = if unix {
            kind != 0 && kind != 0o100000 && kind != 0o040000
        } else {
            meta.file_attr & 0x400 != 0
        };
        let redirected = redirected.get(index).copied().unwrap_or(false);
        let decoded_name = std::str::from_utf8(&meta.name);
        // RAR uses backslashes as path separators, including on Windows.
        // Validate the normalized path through the same rules as ZIP and 7z.
        let name = String::from_utf8_lossy(&meta.name).replace('\\', "/");
        let keep = job.record(
            &name,
            meta.unpacked_size,
            !meta.is_directory && !is_link && !redirected && decoded_name.is_ok(),
        )?;
        entries.push(Entry {
            raw_name: meta.name,
            name,
            size: meta.unpacked_size as usize,
            keep,
            redirected,
        });
    }
    if job.mode == "inspect" {
        return Ok(());
    }

    let outputs: Vec<_> = entries
        .iter()
        .map(|_| Rc::new(RefCell::new(Output::default())))
        .collect();
    let total = Rc::new(RefCell::new(0));
    let mut next = 0;
    archive
        .extract_to_with_options(options, |meta| {
            while entries.get(next).is_some_and(|entry| entry.redirected) {
                next += 1;
            }
            let entry = entries
                .get(next)
                .ok_or(rars::Error::InvalidHeader("Unexpected RAR entry"))?;
            if entry.raw_name != meta.name {
                return Err(rars::Error::InvalidHeader("RAR entry order mismatch"));
            }
            let writer = EntryWriter {
                output: Rc::clone(&outputs[next]),
                total: Rc::clone(&total),
                expected: entry.size,
                keep: entry.keep,
            };
            next += 1;
            Ok(Box::new(writer))
        })
        .map_err(|e| e.to_string())?;

    for (entry, output) in entries.into_iter().zip(outputs) {
        let mut output = output.borrow_mut();
        if !entry.redirected && output.written != entry.size {
            return Err(format!("Size mismatch in {}.", entry.name));
        }
        if entry.keep {
            job.files.push(ArchiveFile {
                name: entry.name,
                bytes: std::mem::take(&mut output.bytes),
            });
        }
    }
    job.expanded = *total.borrow();
    Ok(())
}
