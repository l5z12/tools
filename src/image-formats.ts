// SPDX-License-Identifier: AGPL-3.0-only
export const imageAccept =
  "image/png,image/jpeg,image/webp,image/gif,image/avif,image/bmp,image/heic,image/heif,image/heic-sequence,image/heif-sequence,.heic,.heif";

/** Read aligned ISO-BMFF file brands, excluding the minor version field. */
export function rasterContainer(
  bytes: Uint8Array,
): "avif" | "heif" | undefined {
  if (bytes.length < 16) return;
  const text = new TextDecoder();
  if (text.decode(bytes.subarray(4, 8)) !== "ftyp") return;
  const size = new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  ).getUint32(0);
  if (size < 16 || size > bytes.length || size % 4 !== 0) return;
  const brands = [text.decode(bytes.subarray(8, 12))];
  for (let offset = 16; offset < size; offset += 4)
    brands.push(text.decode(bytes.subarray(offset, offset + 4)));
  if (brands.some((brand) => ["avif", "avis"].includes(brand))) return "avif";
  if (
    brands.some((brand) =>
      [
        "heic",
        "heix",
        "hevc",
        "hevx",
        "heim",
        "heis",
        "hevm",
        "hevs",
        "mif1",
        "msf1",
      ].includes(brand),
    )
  )
    return "heif";
}
