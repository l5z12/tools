// SPDX-License-Identifier: AGPL-3.0-only
use wasm_bindgen::prelude::*;

fn size(w: u32, h: u32) -> Result<usize, String> {
    if w == 0
        || h == 0
        || crate::limits::over(w as usize, 8192)
        || crate::limits::over(h as usize, 8192)
        || (!crate::limits::enabled() && u64::from(w) * u64::from(h) > 8_388_608)
    {
        return Err("Use images up to 8 megapixels and 8192 pixels per side.".into());
    }
    Ok(w as usize * h as usize * 4)
}
fn chunk(out: &mut Vec<u8>, kind: &[u8; 4], data: &[u8]) {
    out.extend_from_slice(&(data.len() as u32).to_be_bytes());
    out.extend_from_slice(kind);
    out.extend_from_slice(data);
    let mut crc = crc32fast::Hasher::new();
    crc.update(kind);
    crc.update(data);
    out.extend_from_slice(&crc.finalize().to_be_bytes());
}
fn compressed(pixels: &[u8], w: u32, h: u32) -> Vec<u8> {
    let stride = w as usize * 4;
    let mut filtered = Vec::with_capacity(pixels.len() + h as usize);
    for row in pixels.chunks_exact(stride) {
        filtered.push(1);
        for (i, &byte) in row.iter().enumerate() {
            filtered.push(byte.wrapping_sub(if i >= 4 { row[i - 4] } else { 0 }));
        }
    }
    miniz_oxide::deflate::compress_to_vec_zlib(&filtered, 6)
}
fn control(seq: u32, w: u32, h: u32, delay: u16, blend: u8) -> Vec<u8> {
    let mut data = Vec::new();
    for n in [seq, w, h, 0, 0] {
        data.extend_from_slice(&n.to_be_bytes())
    }
    data.extend_from_slice(&delay.to_be_bytes());
    data.extend_from_slice(&1000u16.to_be_bytes());
    data.extend_from_slice(&[0, blend]);
    data
}
pub fn animation(
    w: u32,
    h: u32,
    pixels: &[u8],
    delays: &[u16],
    loops: u32,
    fallback: &[u8],
) -> Result<Vec<u8>, String> {
    let frame_size = size(w, h)?;
    if delays.is_empty()
        || delays.len() > 100
        || delays.iter().any(|d| *d < 10)
        || pixels.len() != frame_size * delays.len()
        || pixels.len() > 128 * 1024 * 1024
    {
        return Err(
            "Use 1–100 frames, 10–65535 ms each, and at most 128 MB of decoded frames.".into(),
        );
    }
    if !fallback.is_empty() && fallback.len() != frame_size {
        return Err("Fallback dimensions do not match.".into());
    }
    let extra = !fallback.is_empty() && delays.len() == 1;
    let mut out = b"\x89PNG\r\n\x1a\n".to_vec();
    let mut header = Vec::new();
    header.extend_from_slice(&w.to_be_bytes());
    header.extend_from_slice(&h.to_be_bytes());
    header.extend_from_slice(&[8, 6, 0, 0, 0]);
    chunk(&mut out, b"IHDR", &header);
    let mut actl = Vec::new();
    actl.extend_from_slice(&((delays.len() + usize::from(extra)) as u32).to_be_bytes());
    actl.extend_from_slice(&loops.to_be_bytes());
    chunk(&mut out, b"acTL", &actl);
    if !fallback.is_empty() {
        chunk(&mut out, b"IDAT", &compressed(fallback, w, h))
    }
    let mut seq = 0;
    for (i, p) in pixels.chunks_exact(frame_size).enumerate() {
        chunk(&mut out, b"fcTL", &control(seq, w, h, delays[i], 0));
        seq += 1;
        let bytes = compressed(p, w, h);
        if i == 0 && fallback.is_empty() {
            chunk(&mut out, b"IDAT", &bytes)
        } else {
            let mut data = seq.to_be_bytes().to_vec();
            seq += 1;
            data.extend_from_slice(&bytes);
            chunk(&mut out, b"fdAT", &data)
        }
    }
    if extra {
        chunk(&mut out, b"fcTL", &control(seq, 1, 1, 100, 1));
        seq += 1;
        let mut data = seq.to_be_bytes().to_vec();
        data.extend_from_slice(&compressed(&[0, 0, 0, 0], 1, 1));
        chunk(&mut out, b"fdAT", &data)
    }
    chunk(&mut out, b"IEND", &[]);
    Ok(out)
}
#[wasm_bindgen]
pub fn encode_apng(
    w: u32,
    h: u32,
    pixels: &[u8],
    delays: &[u16],
    loops: u32,
    fallback: &[u8],
) -> Result<Vec<u8>, JsValue> {
    animation(w, h, pixels, delays, loops, fallback).map_err(|e| JsValue::from_str(&e))
}

pub fn transform(
    w: u32,
    h: u32,
    pixels: &[u8],
    kind: &str,
    args: &[f64],
) -> Result<Vec<u8>, String> {
    if pixels.len() != size(w, h)? {
        return Err("Incomplete image pixels.".into());
    }
    if args.iter().any(|n| !n.is_finite()) {
        return Err("Invalid numeric option.".into());
    }
    let mut out = pixels.to_vec();
    match kind {
        "grayscale" | "invert" | "brightness" | "threshold" => {
            let value = args.first().copied().unwrap_or(0.0);
            if kind == "brightness" && !(-255.0..=255.0).contains(&value)
                || kind == "threshold" && !(0.0..=255.0).contains(&value)
            {
                return Err("Image adjustment is out of range.".into());
            }
            for p in out.chunks_exact_mut(4) {
                let gray = (0.2126 * p[0] as f64 + 0.7152 * p[1] as f64 + 0.0722 * p[2] as f64)
                    .round() as u8;
                for channel in &mut p[..3] {
                    *channel = match kind {
                        "grayscale" => gray,
                        "invert" => 255 - *channel,
                        "threshold" => {
                            if gray as f64 >= value {
                                255
                            } else {
                                0
                            }
                        }
                        _ => (*channel as f64 + value).clamp(0.0, 255.0).round() as u8,
                    };
                }
            }
        }
        "flip-horizontal" | "flip-vertical" | "rotate" => {
            for y in 0..h {
                for x in 0..w {
                    let (dx, dy, dw) = match kind {
                        "flip-horizontal" => (w - 1 - x, y, w),
                        "flip-vertical" => (x, h - 1 - y, w),
                        _ => (h - 1 - y, x, h),
                    };
                    let a = ((y * w + x) * 4) as usize;
                    let b = ((dy * dw + dx) * 4) as usize;
                    out[b..b + 4].copy_from_slice(&pixels[a..a + 4]);
                }
            }
        }
        "crop" => {
            if args.len() != 4
                || args
                    .iter()
                    .any(|n| *n < 0.0 || n.fract() != 0.0 || *n > 8192.0)
            {
                return Err("Crop needs x, y, width, height as nonnegative integers.".into());
            }
            let (x, y, cw, ch) = (
                args[0] as u32,
                args[1] as u32,
                args[2] as u32,
                args[3] as u32,
            );
            size(cw, ch)?;
            if x + cw > w || y + ch > h {
                return Err("Crop rectangle extends beyond the image.".into());
            }
            out = Vec::with_capacity(cw as usize * ch as usize * 4);
            for row in y..y + ch {
                let start = ((row * w + x) * 4) as usize;
                out.extend_from_slice(&pixels[start..start + cw as usize * 4]);
            }
        }
        _ => return Err("Unknown image transformation.".into()),
    }
    Ok(out)
}
#[wasm_bindgen]
pub fn transform_pixels(
    w: u32,
    h: u32,
    pixels: &[u8],
    kind: &str,
    args: &[f64],
) -> Result<Vec<u8>, JsValue> {
    transform(w, h, pixels, kind, args).map_err(|e| JsValue::from_str(&e))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn pixels() {
        let p = [255, 0, 0, 255, 0, 255, 0, 128];
        assert_eq!(
            transform(2, 1, &p, "flip-horizontal", &[]).unwrap(),
            [0, 255, 0, 128, 255, 0, 0, 255]
        );
        assert_eq!(
            transform(2, 1, &p, "crop", &[1., 0., 1., 1.]).unwrap(),
            [0, 255, 0, 128]
        );
        assert!(transform(2, 1, &p, "crop", &[1., 0., 2., 1.]).is_err());
    }
    #[test]
    fn encoding() {
        let p = [255, 0, 0, 255];
        let out = animation(1, 1, &p, &[100], 0, &[0, 0, 0, 255]).unwrap();
        assert_eq!(&out[..8], b"\x89PNG\r\n\x1a\n");
        assert!(out.windows(4).any(|s| s == b"fdAT"));
        assert!(animation(1, 1, &p, &[0], 0, &[]).is_err());
    }
}
