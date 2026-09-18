// SPDX-License-Identifier: AGPL-3.0-only
use super::{ArchiveFile, LIMIT};
use crate::workbench::option;
use serde_json::Value;
use sevenz_rust2::{
    encoder_options::{AesEncoderOptions, Lzma2Options},
    ArchiveEntry, ArchiveWriter, EncoderConfiguration, EncoderMethod, SourceReader,
};
use std::io::{Cursor, Write};

fn sevenz_methods(level: u32, password: &str) -> Vec<EncoderConfiguration> {
    let mut methods = Vec::new();
    if !password.is_empty() {
        let mut aes = AesEncoderOptions::new(password.into());
        aes.num_cycles_power = 19;
        methods.push(aes.into());
    }
    if level == 0 {
        methods.push(EncoderMethod::COPY.into());
    } else {
        let mut lzma = Lzma2Options::from_level(level.min(5));
        lzma.set_dictionary_size(4 * 1024 * 1024);
        methods.push(lzma.into());
    }
    methods
}
pub fn encode(files: &[ArchiveFile], options: &Value) -> Result<Vec<u8>, String> {
    let format = option(options, "format", "zip");
    let password = option(options, "outputPassword", "");
    crate::limits::check(password.len(), 1024, "Password exceeds 1024 bytes.")?;
    if !password.is_empty() && !["zip", "7z", "rar"].contains(&format) {
        return Err("Password encryption requires ZIP or 7z or RAR.".into());
    }
    let level = match option(options, "level", "balanced") {
        "store" => 0,
        "fast" => 1,
        "balanced" => 5,
        "maximum" => 9,
        _ => return Err("Unknown compression level.".into()),
    };
    let output = match format {
        "rar" => encode_rar(files, options, password, level)?,
        "zip" => {
            let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
            let settings = zip::write::SimpleFileOptions::default()
                .unix_permissions(0o644)
                .compression_method(if level == 0 {
                    zip::CompressionMethod::Stored
                } else {
                    zip::CompressionMethod::Deflated
                })
                .compression_level(if level == 0 { None } else { Some(level as i64) });
            let settings = if password.is_empty() {
                settings
            } else {
                settings.with_aes_encryption(zip::AesMode::Aes256, password)
            };
            for entry in files {
                writer
                    .start_file(&entry.name, settings)
                    .map_err(|e| e.to_string())?;
                writer.write_all(&entry.bytes).map_err(|e| e.to_string())?;
            }
            writer.finish().map_err(|e| e.to_string())?.into_inner()
        }
        "tar" | "tar.gz" => {
            let mut writer = tar::Builder::new(Vec::new());
            for entry in files {
                let mut header = tar::Header::new_gnu();
                header.set_size(entry.bytes.len() as u64);
                header.set_mode(0o644);
                header.set_mtime(0);
                header.set_cksum();
                writer
                    .append_data(&mut header, &entry.name, entry.bytes.as_slice())
                    .map_err(|e| e.to_string())?;
            }
            let tar = writer.into_inner().map_err(|e| e.to_string())?;
            if format == "tar.gz" {
                let mut gzip =
                    flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::new(level));
                gzip.write_all(&tar).map_err(|e| e.to_string())?;
                gzip.finish().map_err(|e| e.to_string())?
            } else {
                tar
            }
        }
        "7z" => {
            let mut writer =
                ArchiveWriter::new(Cursor::new(Vec::new())).map_err(|e| e.to_string())?;
            writer.set_encrypt_header(options["encryptNames"] != false);
            if options["solid"] != false && files.iter().any(|f| !f.bytes.is_empty()) {
                writer.set_content_methods(sevenz_methods(level, password));
                let entries = files
                    .iter()
                    .filter(|f| !f.bytes.is_empty())
                    .map(|f| ArchiveEntry::new_file(&f.name))
                    .collect();
                let sources = files
                    .iter()
                    .filter(|f| !f.bytes.is_empty())
                    .map(|f| SourceReader::new(f.bytes.as_slice()))
                    .collect();
                writer
                    .push_archive_entries(entries, sources)
                    .map_err(|e| e.to_string())?;
                for entry in files.iter().filter(|f| f.bytes.is_empty()) {
                    writer
                        .push_archive_entry::<&[u8]>(ArchiveEntry::new_file(&entry.name), None)
                        .map_err(|e| e.to_string())?;
                }
            } else {
                for entry in files {
                    // New salt/IV for each independently encrypted stream.
                    writer.set_content_methods(sevenz_methods(level, password));
                    writer
                        .push_archive_entry(
                            ArchiveEntry::new_file(&entry.name),
                            if entry.bytes.is_empty() {
                                None
                            } else {
                                Some(entry.bytes.as_slice())
                            },
                        )
                        .map_err(|e| e.to_string())?;
                }
            }
            // The header is a separate stream and must also get a fresh salt/IV.
            writer.set_content_methods(sevenz_methods(level, password));
            writer.finish().map_err(|e| e.to_string())?.into_inner()
        }
        _ => return Err("Choose ZIP, RAR, TAR, TAR.GZ or 7z.".into()),
    };
    crate::limits::check(output.len(), LIMIT, "Archive output exceeds 64 MiB.")?;
    Ok(output)
}

fn encode_rar(
    files: &[ArchiveFile],
    options: &Value,
    password: &str,
    level: u32,
) -> Result<Vec<u8>, String> {
    let mut builder = rars::Builder::new(rars::ArchiveVersion::Rar50)
        .store(level == 0)
        .compression_level(Some(match level {
            0 => 0,
            1 => 1,
            5 => 3,
            _ => 5,
        }))
        .solid(options["solid"] != false)
        .password((!password.is_empty()).then(|| password.as_bytes().to_vec()))
        .header_encryption(!password.is_empty() && options["encryptNames"] != false);
    for entry in files {
        builder
            .add_bytes(
                entry.name.as_bytes().to_vec(),
                entry.bytes.clone(),
                Some(0),
                Some(0o644),
            )
            .map_err(|e| e.to_string())?;
    }
    let mut output = LimitedArchiveOutput(Vec::new());
    builder
        .write_to(
            &mut output,
            &rars::WriterResources::new(256 * 1024 * 1024),
            None,
        )
        .map_err(|e| e.to_string())?;
    Ok(output.0)
}

struct LimitedArchiveOutput(Vec<u8>);

impl Write for LimitedArchiveOutput {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        if crate::limits::over(bytes.len(), LIMIT.saturating_sub(self.0.len())) {
            return Err(std::io::Error::other("Archive output exceeds 64 MiB."));
        }
        self.0.extend_from_slice(bytes);
        Ok(bytes.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}
