// SPDX-License-Identifier: AGPL-3.0-only
use image::{
    imageops::{self, FilterType},
    DynamicImage, ImageDecoder, ImageEncoder, ImageReader, Rgba, RgbaImage,
};
use std::io::Cursor;
use wasm_bindgen::prelude::*;

fn check(width: u32, height: u32) -> Result<(), String> {
    if width == 0
        || height == 0
        || width > 8192
        || height > 8192
        || u64::from(width) * u64::from(height) > 32_000_000
    {
        return Err("Image exceeds 32 megapixels or 8192 pixels per side.".into());
    }
    Ok(())
}
fn pixels(width: u32, height: u32, bytes: &[u8]) -> Result<RgbaImage, String> {
    check(width, height)?;
    RgbaImage::from_raw(width, height, bytes.to_vec()).ok_or("Invalid RGBA byte length.".into())
}
fn packed(image: RgbaImage) -> Vec<u8> {
    let mut output = Vec::with_capacity(8 + image.len());
    output.extend_from_slice(&image.width().to_le_bytes());
    output.extend_from_slice(&image.height().to_le_bytes());
    output.extend_from_slice(image.as_raw());
    output
}

#[wasm_bindgen]
pub fn decode_raster(bytes: &[u8]) -> Result<Vec<u8>, JsValue> {
    (|| -> Result<Vec<u8>, String> {
        if bytes.len() > 32 * 1024 * 1024 {
            return Err("Image exceeds 32 MiB.".into());
        }
        let mut reader = ImageReader::new(Cursor::new(bytes))
            .with_guessed_format()
            .map_err(|e| e.to_string())?;
        let mut limits = image::Limits::default();
        limits.max_image_width = Some(8192);
        limits.max_image_height = Some(8192);
        limits.max_alloc = Some(192 * 1024 * 1024);
        reader.limits(limits);
        let mut decoder = reader.into_decoder().map_err(|e| e.to_string())?;
        let (width, height) = decoder.dimensions();
        check(width, height)?;
        let orientation = decoder.orientation().map_err(|e| e.to_string())?;
        let mut image = DynamicImage::from_decoder(decoder).map_err(|e| e.to_string())?;
        image.apply_orientation(orientation);
        Ok(packed(image.into_rgba8()))
    })()
    .map_err(|e| JsValue::from_str(&e))
}

#[wasm_bindgen]
pub fn encode_raster(
    width: u32,
    height: u32,
    bytes: &[u8],
    format: &str,
    quality: u8,
) -> Result<Vec<u8>, JsValue> {
    (|| -> Result<Vec<u8>, String> {
        let mut image = pixels(width, height, bytes)?;
        let mut output = Vec::new();
        match format {
            "png" => image::codecs::png::PngEncoder::new(&mut output)
                .write_image(
                    image.as_raw(),
                    width,
                    height,
                    image::ExtendedColorType::Rgba8,
                )
                .map_err(|e| e.to_string())?,
            "jpeg" => {
                if !(1..=100).contains(&quality) {
                    return Err("Quality must be 1–100.".into());
                }
                for pixel in image.pixels_mut() {
                    for channel in 0..3 {
                        pixel[channel] = ((u32::from(pixel[channel]) * u32::from(pixel[3])
                            + 255 * (255 - u32::from(pixel[3]))
                            + 127)
                            / 255) as u8;
                    }
                    pixel[3] = 255;
                }
                image::codecs::jpeg::JpegEncoder::new_with_quality(&mut output, quality)
                    .encode_image(&DynamicImage::ImageRgba8(image))
                    .map_err(|e| e.to_string())?;
            }
            _ => return Err("Unsupported raster encoding.".into()),
        }
        Ok(output)
    })()
    .map_err(|e| JsValue::from_str(&e))
}

#[wasm_bindgen]
pub fn resize_raster(
    width: u32,
    height: u32,
    bytes: &[u8],
    target_width: u32,
    target_height: u32,
    contain: bool,
    background: &[u8],
) -> Result<Vec<u8>, JsValue> {
    (|| -> Result<Vec<u8>, String> {
        let image = pixels(width, height, bytes)?;
        check(target_width, target_height)?;
        if !contain {
            return Ok(packed(imageops::resize(
                &image,
                target_width,
                target_height,
                FilterType::Lanczos3,
            )));
        }
        let scale = (target_width as f64 / width as f64).min(target_height as f64 / height as f64);
        let w = ((width as f64 * scale).round() as u32)
            .max(1)
            .min(target_width);
        let h = ((height as f64 * scale).round() as u32)
            .max(1)
            .min(target_height);
        let fill = if background.len() == 4 {
            Rgba([background[0], background[1], background[2], background[3]])
        } else {
            Rgba([0, 0, 0, 0])
        };
        let mut canvas = RgbaImage::from_pixel(target_width, target_height, fill);
        imageops::overlay(
            &mut canvas,
            &imageops::resize(&image, w, h, FilterType::Lanczos3),
            ((target_width - w) / 2) as i64,
            ((target_height - h) / 2) as i64,
        );
        Ok(packed(canvas))
    })()
    .map_err(|e| JsValue::from_str(&e))
}

#[wasm_bindgen]
pub fn sprite_raster(
    bytes: &[u8],
    descriptor: &str,
    columns: u32,
    gap: u32,
) -> Result<Vec<u8>, JsValue> {
    (|| -> Result<Vec<u8>, String> {
        let sizes: Vec<[u32; 2]> = serde_json::from_str(descriptor).map_err(|e| e.to_string())?;
        if sizes.is_empty() || sizes.len() > 64 || columns == 0 || columns > 64 || gap > 256 {
            return Err("Invalid sprite layout.".into());
        }
        for [width, height] in &sizes {
            check(*width, *height)?;
        }
        let columns = columns.min(sizes.len() as u32);
        let width = sizes.iter().map(|s| s[0]).max().unwrap();
        let height = sizes.iter().map(|s| s[1]).max().unwrap();
        let rows = (sizes.len() as u32).div_ceil(columns);
        let w = columns
            .checked_mul(width + gap)
            .and_then(|v| v.checked_sub(gap))
            .ok_or("Sprite width overflow.")?;
        let h = rows
            .checked_mul(height + gap)
            .and_then(|v| v.checked_sub(gap))
            .ok_or("Sprite height overflow.")?;
        check(w, h)?;
        if u64::from(w) * u64::from(h) > 8_388_608 {
            return Err("Sprite exceeds 8 megapixels.".into());
        }
        let mut canvas = RgbaImage::new(w, h);
        let mut offset = 0;
        for (index, size) in sizes.iter().enumerate() {
            check(size[0], size[1])?;
            let end = offset + (size[0] as usize * size[1] as usize * 4);
            let image = pixels(
                size[0],
                size[1],
                bytes.get(offset..end).ok_or("Invalid sprite bytes.")?,
            )?;
            imageops::overlay(
                &mut canvas,
                &image,
                ((index as u32 % columns) * (width + gap)) as i64,
                ((index as u32 / columns) * (height + gap)) as i64,
            );
            offset = end;
        }
        if offset != bytes.len() {
            return Err("Trailing sprite bytes.".into());
        }
        Ok(packed(canvas))
    })()
    .map_err(|e| JsValue::from_str(&e))
}
