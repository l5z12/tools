// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { inflateSync } from "node:zlib";
import init, {
  decode_raster,
  encode_raster,
  resize_raster,
  sprite_raster,
  encode_apng,
  transform_pixels,
} from "../public/wasm/l5z12_tools";

await init({
  module_or_path: await readFile("public/wasm/l5z12_tools_bg.wasm"),
});
function crc(bytes: Uint8Array) {
  let n = 0xffffffff;
  for (const byte of bytes) {
    n ^= byte;
    for (let i = 0; i < 8; i++) n = (n >>> 1) ^ (n & 1 ? 0xedb88320 : 0);
  }
  return (n ^ 0xffffffff) >>> 0;
}
function chunks(bytes: Uint8Array) {
  const b = Buffer.from(bytes);
  assert.equal(b.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  const out: { type: string; data: Buffer }[] = [];
  let p = 8;
  while (p < b.length) {
    const length = b.readUInt32BE(p);
    const type = b.toString("ascii", p + 4, p + 8);
    const data = b.subarray(p + 8, p + 8 + length);
    assert.equal(
      crc(b.subarray(p + 4, p + 8 + length)),
      b.readUInt32BE(p + 8 + length),
    );
    out.push({ type, data });
    p += length + 12;
  }
  assert.equal(p, b.length);
  return out;
}
function pixels(data: Buffer, width: number, height: number) {
  const raw = inflateSync(data);
  assert.equal(raw.length, (width * 4 + 1) * height);
  const out = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 4 + 1);
    assert.equal(raw[row], 1);
    for (let x = 0; x < width * 4; x++)
      out[y * width * 4 + x] =
        (raw[row + 1 + x] + (x >= 4 ? out[y * width * 4 + x - 4] : 0)) & 255;
  }
  return out;
}
const red = new Uint8Array([255, 0, 0, 255, 128, 0, 0, 128]);
const blue = new Uint8Array([0, 0, 255, 255, 0, 0, 128, 128]);
const animation = chunks(
  encode_apng(
    2,
    1,
    new Uint8Array([...red, ...blue]),
    new Uint16Array([100, 250]),
    3,
    new Uint8Array(),
  ),
);
assert.deepEqual(
  animation.map((c) => c.type),
  ["IHDR", "acTL", "fcTL", "IDAT", "fcTL", "fdAT", "IEND"],
);
assert.equal(animation[1].data.readUInt32BE(0), 2);
assert.equal(animation[1].data.readUInt32BE(4), 3);
assert.deepEqual(pixels(animation[3].data, 2, 1), red);
assert.deepEqual(pixels(animation[5].data.subarray(4), 2, 1), blue);
assert.equal(animation[4].data.readUInt16BE(20), 250);
const fallback = chunks(
  encode_apng(2, 1, red, new Uint16Array([100]), 0, blue),
);
assert.deepEqual(
  fallback.map((c) => c.type),
  ["IHDR", "acTL", "IDAT", "fcTL", "fdAT", "fcTL", "fdAT", "IEND"],
);
assert.deepEqual(pixels(fallback[2].data, 2, 1), blue);
assert.deepEqual(pixels(fallback[4].data.subarray(4), 2, 1), red);
assert.deepEqual(pixels(fallback[6].data.subarray(4), 1, 1), new Uint8Array(4));
assert.deepEqual(
  fallback
    .filter((c) => c.type === "fcTL" || c.type === "fdAT")
    .map((c) => c.data.readUInt32BE(0)),
  [0, 1, 2, 3],
);
assert.equal(fallback[5].data[25], 1);
assert.deepEqual(
  transform_pixels(2, 1, red, "flip-horizontal", new Float64Array()),
  new Uint8Array([128, 0, 0, 128, 255, 0, 0, 255]),
);
assert.throws(() =>
  encode_apng(2, 1, red, new Uint16Array([0]), 0, new Uint8Array()),
);
console.log(
  "APNG checksums, frame order, timing, fallback pixels, transparent overlay, and pixel transform passed.",
);

// Independent native decoder verifies the new Rust raster codecs and composition.
const raster = new Uint8Array([255, 0, 0, 255, 0, 0, 255, 255]);
const encodedPng = encode_raster(2, 1, raster, "png", 80);
const pngImage = await loadImage(Buffer.from(encodedPng));
assert.equal(pngImage.width, 2);
assert.equal(pngImage.height, 1);
const nativeCanvas = createCanvas(2, 1);
nativeCanvas.getContext("2d").drawImage(pngImage, 0, 0);
assert.deepEqual(
  new Uint8Array(nativeCanvas.getContext("2d").getImageData(0, 0, 2, 1).data),
  raster,
);
assert.deepEqual(decode_raster(encodedPng).slice(8), raster);
const jpegImage = await loadImage(
  Buffer.from(encode_raster(2, 1, raster, "jpeg", 90)),
);
assert.equal(jpegImage.width, 2);
const contained = resize_raster(
  2,
  1,
  raster,
  4,
  4,
  true,
  new Uint8Array([0, 255, 0, 255]),
);
assert.deepEqual(Array.from(contained.slice(0, 8)), [4, 0, 0, 0, 4, 0, 0, 0]);
assert.deepEqual(Array.from(contained.slice(8, 12)), [0, 255, 0, 255]);
const sprite = sprite_raster(raster, "[[1,1],[1,1]]", 2, 1);
assert.deepEqual(
  Array.from(sprite.slice(8)),
  [255, 0, 0, 255, 0, 0, 0, 0, 0, 0, 255, 255],
);
assert.throws(() => decode_raster(new Uint8Array([1, 2, 3])));
assert.throws(() => encode_raster(2, 2, raster, "png", 80));
assert.throws(() =>
  resize_raster(2, 1, raster, 9000, 2, true, new Uint8Array()),
);
assert.throws(() => sprite_raster(raster, "[[4294967295,1]]", 2, 256));
await mkdir(".astro", { recursive: true });
await writeFile(".astro/wasm-raster-test.png", encodedPng);
await writeFile(
  ".astro/wasm-raster-test.avif",
  await nativeCanvas.encode("avif"),
);
console.log(
  "Rust raster decode, PNG/JPEG encode, resizing, sprite composition, malformed files, and allocation bounds passed.",
);
