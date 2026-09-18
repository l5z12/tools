// SPDX-License-Identifier: AGPL-3.0-only
import { imageCore } from "./image-core";
export type Raster = {
  width: number;
  height: number;
  pixels: Uint8Array<ArrayBuffer>;
};
export function unpackRaster(bytes: Uint8Array<ArrayBuffer>): Raster {
  const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    width: header.getUint32(0, true),
    height: header.getUint32(4, true),
    pixels: bytes.slice(8),
  };
}
export async function decodeRaster(file: File): Promise<Raster> {
  if (file.size > 32 * 1024 * 1024) throw Error("Image exceeds 32 MiB.");
  return unpackRaster(
    await imageCore({
      kind: "decode",
      width: 0,
      height: 0,
      pixels: new Uint8Array(await file.arrayBuffer()),
    }),
  );
}
export async function encodeRaster(
  image: Raster,
  format = "png",
  quality = 80,
): Promise<Uint8Array<ArrayBuffer>> {
  return imageCore({ kind: "encode", ...image, format, quality });
}
export async function resizeRaster(
  image: Raster,
  width: number,
  height: number,
  contain = false,
  background = new Uint8Array(),
): Promise<Raster> {
  return unpackRaster(
    await imageCore({
      kind: "resize",
      ...image,
      targetWidth: width,
      targetHeight: height,
      contain,
      fallback: background,
    }),
  );
}
