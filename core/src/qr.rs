// SPDX-License-Identifier: AGPL-3.0-only
use crate::workbench::file;
use rqrr::PreparedImage;
use serde_json::{json, Value};

fn dimensions(bytes: &[u8], options: &Value) -> Result<(usize, usize), String> {
    let dimension = |key| {
        options[key]
            .as_u64()
            .and_then(|value| usize::try_from(value).ok())
            .filter(|&value| value > 0)
            .ok_or_else(|| "QR decoding requires positive integer image dimensions.".to_string())
    };
    let width = dimension("width")?;
    let height = dimension("height")?;
    let pixels = width
        .checked_mul(height)
        .ok_or("Invalid image dimensions.")?;
    if pixels.checked_mul(4) != Some(bytes.len()) {
        return Err("Invalid RGBA byte length.".into());
    }
    if crate::limits::over(width, 8192)
        || crate::limits::over(height, 8192)
        || crate::limits::over(pixels, 8_388_608)
    {
        return Err("QR images must be at most 8 MP and 8192 pixels per side.".into());
    }
    Ok((width, height))
}

pub fn decode(bytes: &[u8], options: &Value) -> Result<Value, String> {
    let (width, height) = dimensions(bytes, options)?;
    // Composite transparency onto white so transparent black backgrounds do not
    // obscure the dark modules, then prepare luminance for adaptive thresholding.
    let gray: Vec<u8> = bytes
        .chunks_exact(4)
        .map(|pixel| {
            let luminance = (299 * u32::from(pixel[0])
                + 587 * u32::from(pixel[1])
                + 114 * u32::from(pixel[2])
                + 500)
                / 1000;
            ((luminance * u32::from(pixel[3]) + 255 * (255 - u32::from(pixel[3])) + 127) / 255)
                as u8
        })
        .collect();

    let mut rows = Vec::new();
    let mut files = Vec::new();
    let mut single_text = None;
    // Retry light-on-dark codes if the normal scan could not decode any payload.
    for inverted in [false, true] {
        let mut image = PreparedImage::prepare_from_greyscale(width, height, |x, y| {
            let value = gray[y * width + x];
            if inverted {
                255 - value
            } else {
                value
            }
        });
        let mut grids = image.detect_grids();
        grids.sort_by_key(|grid| {
            (
                grid.bounds.iter().map(|point| point.y).min().unwrap_or(0),
                grid.bounds.iter().map(|point| point.x).min().unwrap_or(0),
            )
        });
        let mut attempts = Vec::new();
        for (index, grid) in grids.iter().enumerate() {
            let number = index + 1;
            let mut payload = Vec::new();
            match grid.decode_to(&mut payload) {
                Ok(metadata) => {
                    let text = std::str::from_utf8(&payload).ok();
                    let (extension, mime) = if text.is_some() {
                        ("txt", "text/plain;charset=utf-8")
                    } else {
                        ("bin", "application/octet-stream")
                    };
                    files.push(file(&format!("qr-{number}.{extension}"), mime, &payload));
                    single_text = text.map(str::to_owned);
                    attempts.push(json!({
                        "code": number,
                        "status": "Decoded",
                        "text": text,
                        "bytes": payload.len(),
                        "version": metadata.version.0,
                        "errorCorrection": (["M", "L", "H", "Q"][usize::from(metadata.ecc_level)]),
                    }));
                }
                Err(error) => attempts.push(json!({
                    "code": number,
                    "status": format!("Could not decode: {error}"),
                    "text": null,
                })),
            }
        }
        if !attempts.is_empty() {
            rows = attempts;
        }
        if !files.is_empty() {
            break;
        }
    }
    if rows.is_empty() {
        return Err("No QR code found. Try a clearer image with the entire code visible.".into());
    }
    let text = match (rows.len(), single_text) {
        (1, Some(text)) => text,
        _ => serde_json::to_string_pretty(&rows).map_err(|error| error.to_string())?,
    };
    Ok(json!({"kind": "table", "rows": rows, "text": text, "files": files}))
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{imageops, Rgba, RgbaImage};
    use qrcode::{Color, QrCode};

    fn qr(payload: &[u8]) -> RgbaImage {
        let code = QrCode::new(payload).unwrap();
        let side = (code.width() + 8) * 6;
        RgbaImage::from_fn(side as u32, side as u32, |x, y| {
            let x = x as usize / 6;
            let y = y as usize / 6;
            let dark = x >= 4
                && y >= 4
                && x < code.width() + 4
                && y < code.width() + 4
                && code[(x - 4, y - 4)] == Color::Dark;
            Rgba(if dark { [0, 0, 0, 255] } else { [255; 4] })
        })
    }

    fn scan(image: &RgbaImage) -> Result<Value, String> {
        decode(
            image.as_raw(),
            &json!({"width": image.width(), "height": image.height()}),
        )
    }

    #[test]
    fn text_unicode_rotation_and_transparency() {
        for text in [
            "0123456789",
            "HELLO WORLD",
            "https://example.com/?a=1&b=2",
            "你好 🌍\nsecond line",
        ] {
            let image = qr(text.as_bytes());
            for image in [
                image.clone(),
                imageops::rotate90(&image),
                imageops::flip_horizontal(&image),
            ] {
                let result = scan(&image).unwrap();
                assert_eq!(result["text"], text);
                assert_eq!(result["rows"][0]["status"], "Decoded");
                assert_eq!(result["rows"][0]["bytes"], text.len());
                assert_eq!(
                    result["files"][0],
                    file("qr-1.txt", "text/plain;charset=utf-8", text.as_bytes())
                );
            }
        }
        let mut transparent = qr(b"transparent");
        for pixel in transparent.pixels_mut() {
            if pixel[0] == 255 {
                *pixel = Rgba([0; 4]);
            }
        }
        assert_eq!(scan(&transparent).unwrap()["text"], "transparent");
        let mut inverted = qr(b"inverted");
        imageops::invert(&mut inverted);
        assert_eq!(scan(&inverted).unwrap()["text"], "inverted");
    }

    #[test]
    fn multiple_codes_and_binary_payloads() {
        let first = qr(b"first");
        let second = qr(b"second");
        let mut image = RgbaImage::from_pixel(
            first.width() + second.width() + 48,
            first.height(),
            Rgba([255; 4]),
        );
        imageops::replace(&mut image, &first, 0, 0);
        imageops::replace(&mut image, &second, i64::from(first.width() + 48), 0);
        let result = scan(&image).unwrap();
        assert_eq!(result["rows"].as_array().unwrap().len(), 2);
        assert_eq!(result["rows"][0]["text"], "first");
        assert_eq!(result["rows"][1]["text"], "second");
        assert_eq!(result["files"].as_array().unwrap().len(), 2);
        let binary = [0, 0xff, 0x80, 0, 1];
        let result = scan(&qr(&binary)).unwrap();
        assert!(result["rows"][0]["text"].is_null());
        assert_eq!(
            result["files"][0],
            file("qr-1.bin", "application/octet-stream", &binary)
        );
    }

    #[test]
    fn missing_codes_and_invalid_pixels() {
        for size in [1, 100] {
            assert!(scan(&RgbaImage::from_pixel(size, size, Rgba([255; 4])))
                .unwrap_err()
                .contains("No QR code"));
        }
        for options in [
            json!({}),
            json!({"width": 0, "height": 1}),
            json!({"width": -1, "height": 1}),
            json!({"width": 1.5, "height": 1}),
            json!({"width": 1, "height": 1}),
            json!({"width": u64::MAX, "height": u64::MAX}),
        ] {
            assert!(decode(&[], &options).is_err());
        }
        assert!(
            decode(&vec![255; 8193 * 4], &json!({"width": 8193, "height": 1}))
                .unwrap_err()
                .contains("8192")
        );
    }

    #[test]
    fn damaged_codes_do_not_hide_successful_payloads() {
        let good = qr(b"readable");
        let mut damaged = qr(b"damaged");
        // Retain the three finder patterns, but destroy most payload modules.
        for y in 72..damaged.height() - 24 {
            for x in 72..damaged.width() - 24 {
                damaged.put_pixel(x, y, Rgba([255; 4]));
            }
        }
        let failed = scan(&damaged).unwrap();
        assert!(failed["files"].as_array().unwrap().is_empty());
        assert!(failed["rows"][0]["status"]
            .as_str()
            .unwrap()
            .contains("Could not decode"));
        let mut combined = RgbaImage::from_pixel(
            good.width() + damaged.width() + 48,
            good.height(),
            Rgba([255; 4]),
        );
        imageops::replace(&mut combined, &good, 0, 0);
        imageops::replace(&mut combined, &damaged, i64::from(good.width() + 48), 0);
        let result = scan(&combined).unwrap();
        assert_eq!(result["rows"].as_array().unwrap().len(), 2);
        assert_eq!(result["files"].as_array().unwrap().len(), 1);
        assert_eq!(result["rows"][0]["text"], "readable");
        assert!(result["rows"][1]["status"]
            .as_str()
            .unwrap()
            .contains("Could not decode"));
    }
}
