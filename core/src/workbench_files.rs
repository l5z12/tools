// SPDX-License-Identifier: AGPL-3.0-only
use super::workbench::{data, file, option};
use serde_json::{json, Value};
use std::io::{Cursor, Read, Write};
const LIMIT: usize = 64 * 1024 * 1024;
fn bounded(mut r: impl Read) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    r.by_ref()
        .take(crate::limits::cap(LIMIT).saturating_add(1) as u64)
        .read_to_end(&mut out)
        .map_err(|e| e.to_string())?;
    crate::limits::check(out.len(), LIMIT, "Expanded output exceeds 64 MiB.")?;
    Ok(out)
}
pub fn execute(id: &str, bytes: &[u8], o: &Value) -> Result<Value, String> {
    match id {
        "encoding-file" => {
            let from = encoding_rs::Encoding::for_label(option(o, "from", "utf-8").as_bytes())
                .ok_or("Unknown source encoding.")?;
            let (text, _, bad) = from.decode(bytes);
            if bad {
                return Err("Input contains invalid sequences for the selected encoding.".into());
            }
            let to = option(o, "to", "utf-8");
            let output = if to == "utf-16le" || to == "utf-16be" {
                let mut v = Vec::new();
                if o["bom"] == true {
                    v.extend_from_slice(if to == "utf-16le" {
                        &[255, 254]
                    } else {
                        &[254, 255]
                    })
                }
                for c in text.encode_utf16() {
                    v.extend_from_slice(&if to == "utf-16le" {
                        c.to_le_bytes()
                    } else {
                        c.to_be_bytes()
                    })
                }
                v
            } else {
                let enc = encoding_rs::Encoding::for_label(to.as_bytes())
                    .ok_or("Unknown target encoding.")?;
                let (v, _, bad) = enc.encode(&text);
                if bad {
                    return Err(
                        "Some characters cannot be represented in the target encoding.".into(),
                    );
                }
                let mut v = v.into_owned();
                if to == "utf-8" && o["bom"] == true {
                    v.splice(0..0, [239, 187, 191]);
                }
                v
            };
            Ok(
                json!({"kind":"code","text":text,"files":[file("converted.txt","application/octet-stream",&output)]}),
            )
        }
        "compression-workbench" => {
            let algorithm = option(o, "algorithm", "gzip");
            let compress = option(o, "mode", "compress") == "compress";
            let out = match (algorithm, compress) {
                ("gzip", true) => {
                    let mut w =
                        flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
                    w.write_all(bytes).map_err(|e| e.to_string())?;
                    w.finish().map_err(|e| e.to_string())?
                }
                ("gzip", false) => bounded(flate2::read::MultiGzDecoder::new(bytes))?,
                ("brotli", true) => {
                    let mut v = Vec::new();
                    {
                        let mut w = brotli::CompressorWriter::new(&mut v, 4096, 5, 22);
                        w.write_all(bytes).map_err(|e| e.to_string())?;
                    }
                    v
                }
                ("brotli", false) => bounded(brotli::Decompressor::new(bytes, 4096))?,
                ("zstd", true) => ruzstd::encoding::compress_to_vec(
                    bytes,
                    ruzstd::encoding::CompressionLevel::Fastest,
                ),
                ("zstd", false) => {
                    check_zstd(bytes)?;
                    let mut r = ruzstd::decoding::StreamingDecoder::new(Cursor::new(bytes))
                        .map_err(|e| e.to_string())?;
                    let v = bounded(&mut r)?;
                    if r.into_inner().position() != bytes.len() as u64 {
                        return Err("Only one Zstd frame is supported; trailing data found.".into());
                    }
                    v
                }
                _ => return Err("Unsupported compression format.".into()),
            };
            let ext = match algorithm {
                "gzip" => "gz",
                "brotli" => "br",
                _ => "zst",
            };
            let name = if compress {
                format!("{}.{}", option(o, "filename", "file"), ext)
            } else {
                format!("{}.decoded", option(o, "filename", "file"))
            };
            Ok(
                json!({"kind":"data","data":{"inputBytes":bytes.len(),"outputBytes":out.len(),"format":algorithm},"text":format!("{} → {} bytes",bytes.len(),out.len()),"files":[file(&name,"application/octet-stream",&out)]}),
            )
        }
        "archive-explorer" => crate::archives::explore(bytes, o),
        "apng-extract" => apng(bytes),
        _ => Err("Unknown file tool.".into()),
    }
}
fn check_zstd(b: &[u8]) -> Result<(), String> {
    if b.len() < 6 || b[..4] != [0x28, 0xb5, 0x2f, 0xfd] {
        return Err("Expected a standard Zstd frame.".into());
    }
    let d = b[4];
    let single = d & 32 != 0;
    let mut p = 5;
    let mut window = 0u64;
    if !single {
        let w = b[p];
        p += 1;
        let base = 1u64 << (10 + (w >> 3));
        window = base + base / 8 * u64::from(w & 7);
    }
    p += match d & 3 {
        0 => 0,
        1 => 1,
        2 => 2,
        _ => 4,
    };
    let size = match d >> 6 {
        0 => {
            if single {
                1
            } else {
                0
            }
        }
        1 => 2,
        2 => 4,
        _ => 8,
    };
    if p + size > b.len() {
        return Err("Truncated Zstd header.".into());
    }
    let mut fcs = 0u64;
    for i in 0..size {
        fcs |= (b[p + i] as u64) << (8 * i)
    }
    if size == 2 {
        fcs += 256
    }
    if single {
        window = fcs
    }
    if !crate::limits::enabled() && (window > LIMIT as u64 || fcs > LIMIT as u64) {
        return Err("Zstd window or output exceeds 64 MiB.".into());
    }
    Ok(())
}
fn chunk(out: &mut Vec<u8>, kind: &[u8; 4], body: &[u8]) {
    out.extend_from_slice(&(body.len() as u32).to_be_bytes());
    out.extend_from_slice(kind);
    out.extend_from_slice(body);
    let mut h = crc32fast::Hasher::new();
    h.update(kind);
    h.update(body);
    out.extend_from_slice(&h.finalize().to_be_bytes());
}
fn png(header: &[u8], shared: &[([u8; 4], Vec<u8>)], compressed: &[u8]) -> Vec<u8> {
    let mut v = b"\x89PNG\r\n\x1a\n".to_vec();
    chunk(&mut v, b"IHDR", header);
    for (k, b) in shared {
        chunk(&mut v, k, b)
    }
    chunk(&mut v, b"IDAT", compressed);
    chunk(&mut v, b"IEND", &[]);
    v
}
fn apng(bytes: &[u8]) -> Result<Value, String> {
    if !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Err("Expected PNG/APNG.".into());
    }
    let mut p = 8;
    let mut header = Vec::new();
    let mut shared = Vec::new();
    let mut fallback = Vec::new();
    let mut frames: Vec<(Vec<u8>, Vec<u8>)> = Vec::new();
    let mut declared = None;
    let mut loops = 0;
    let mut seq = 0u32;
    let mut ended = false;
    let mut seen_idat = false;
    let mut default_frame = false;
    while p + 12 <= bytes.len() {
        let n = u32::from_be_bytes(bytes[p..p + 4].try_into().unwrap()) as usize;
        if n > bytes.len() - p - 12 {
            return Err("Truncated PNG chunk.".into());
        }
        let k: &[u8; 4] = bytes[p + 4..p + 8].try_into().unwrap();
        let b = &bytes[p + 8..p + 8 + n];
        let crc = u32::from_be_bytes(bytes[p + 8 + n..p + 12 + n].try_into().unwrap());
        if crc32fast::hash(&bytes[p + 4..p + 8 + n]) != crc {
            return Err("PNG chunk CRC mismatch.".into());
        }
        match k {
            b"IHDR" => {
                if p != 8 || n != 13 {
                    return Err("Invalid PNG header.".into());
                }
                header = b.to_vec()
            }
            b"acTL" => {
                if n != 8 || declared.is_some() || seen_idat {
                    return Err("Invalid animation control.".into());
                }
                declared = Some(u32::from_be_bytes(b[..4].try_into().unwrap()));
                loops = u32::from_be_bytes(b[4..8].try_into().unwrap());
            }
            b"fcTL" => {
                if n != 26 || declared.is_none() || crate::limits::at_least(frames.len(), 500) {
                    return Err("Invalid or excessive animation frames.".into());
                }
                if u32::from_be_bytes(b[..4].try_into().unwrap()) != seq {
                    return Err("Invalid frame sequence.".into());
                }
                seq += 1;
                if frames.is_empty() {
                    default_frame = !seen_idat;
                }
                frames.push((b.to_vec(), Vec::new()));
            }
            b"IDAT" => {
                if frames.len() > 1 {
                    return Err("IDAT appears after a later animation frame.".into());
                }
                seen_idat = true;
                fallback.extend_from_slice(b);
                if default_frame {
                    frames
                        .first_mut()
                        .ok_or("Missing frame control.")?
                        .1
                        .extend_from_slice(b)
                }
            }
            b"fdAT" => {
                if !seen_idat || (default_frame && frames.len() == 1) {
                    return Err("Unexpected animation data before a later frame.".into());
                }
                if n < 4 || u32::from_be_bytes(b[..4].try_into().unwrap()) != seq {
                    return Err("Invalid frame data sequence.".into());
                }
                seq += 1;
                frames
                    .last_mut()
                    .ok_or("Missing frame control.")?
                    .1
                    .extend_from_slice(&b[4..]);
            }
            b"PLTE" | b"tRNS" => {
                if seen_idat || n > 768 || shared.iter().any(|(kind, _)| kind == k) {
                    return Err("Invalid palette or transparency chunk.".into());
                }
                shared.push((*k, b.to_vec()));
            }
            b"IEND" => {
                if n != 0 {
                    return Err("Invalid end chunk.".into());
                }
                ended = true;
                p += 12;
                break;
            }
            _ => {}
        }
        p += 12 + n;
    }
    if !ended || p != bytes.len() || header.len() != 13 || fallback.is_empty() {
        return Err("Incomplete PNG.".into());
    }
    if declared.unwrap_or(0) as usize != frames.len() || frames.is_empty() {
        return Err("No valid APNG animation found.".into());
    }
    let cw = u32::from_be_bytes(header[..4].try_into().unwrap());
    let ch = u32::from_be_bytes(header[4..8].try_into().unwrap());
    if cw == 0
        || ch == 0
        || crate::limits::over(cw as usize, 8192)
        || crate::limits::over(ch as usize, 8192)
        || (!crate::limits::enabled() && cw as u64 * ch as u64 > 8_388_608)
    {
        return Err("APNG canvas exceeds 8 megapixels or 8192 pixels per side.".into());
    }
    let mut files = vec![file(
        "fallback.png",
        "image/png",
        &png(&header, &shared, &fallback),
    )];
    let mut rows = Vec::new();
    let mut output_size = fallback.len() + 1024;
    for (i, (control, compressed)) in frames.iter().enumerate() {
        let read = |p| u32::from_be_bytes(control[p..p + 4].try_into().unwrap());
        let (w, h, x, y) = (read(4), read(8), read(12), read(16));
        if i == 0 && default_frame && (w != cw || h != ch || x != 0 || y != 0) {
            return Err("The default animation frame must fill the canvas.".into());
        }
        if w == 0
            || h == 0
            || x as u64 + w as u64 > cw as u64
            || y as u64 + h as u64 > ch as u64
            || control[24] > 2
            || control[25] > 1
            || compressed.is_empty()
        {
            return Err("Invalid frame dimensions, operations or data.".into());
        }
        let numerator = u16::from_be_bytes(control[20..22].try_into().unwrap());
        let denominator = u16::from_be_bytes(control[22..24].try_into().unwrap());
        let denominator = if denominator == 0 { 100 } else { denominator };
        let mut fh = header.clone();
        fh[..4].copy_from_slice(&w.to_be_bytes());
        fh[4..8].copy_from_slice(&h.to_be_bytes());
        output_size += compressed.len() + 1024;
        crate::limits::check(output_size, LIMIT, "Extracted PNGs exceed 64 MiB.")?;
        files.push(file(
            &format!("frame-{}.png", i + 1),
            "image/png",
            &png(&fh, &shared, compressed),
        ));
        rows.push(json!({"frame":i+1,"width":w,"height":h,"x":x,"y":y,"milliseconds":1000.0*numerator as f64/denominator as f64,"dispose":control[24],"blend":control[25]}));
    }
    let mut v = data(
        json!({"canvas":{"width":cw,"height":ch},"loops":loops,"defaultImageIsFrame":default_frame,"frames":rows,"note":"Extracted frames are raw rectangles, not composited animation snapshots."}),
    );
    v["files"] = json!(files);
    Ok(v)
}
