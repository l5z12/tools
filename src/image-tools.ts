// SPDX-License-Identifier: AGPL-3.0-only
import { imageCore } from "./image-core";
import { decodeRaster, encodeRaster, resizeRaster } from "./raster-client";
import { overLimit } from "./limits";

export interface ImageArtifact {
  secondaryUrl?: string;
  blob: Blob;
  url: string;
  meta: Record<string, string | number>;
  text: string;
}
export async function processImage(
  id: string,
  file: File | undefined,
  option: string,
  bypass = false,
): Promise<ImageArtifact> {
  if (!file) throw Error("Choose an image first.");
  const limits = { bypassLimits: bypass };
  let image = await decodeRaster(file, limits);
  if (id === "image-inspect") {
    const meta = {
      Name: file.name,
      Width: image.width,
      Height: image.height,
      Type: file.type,
      Bytes: file.size,
    };
    return {
      blob: file,
      url: URL.createObjectURL(file),
      meta,
      text: JSON.stringify(meta, null, 2),
    };
  }
  const effect = id.slice(6);
  if (
    [
      "crop",
      "rotate",
      "flip-horizontal",
      "flip-vertical",
      "grayscale",
      "invert",
      "brightness",
      "threshold",
    ].includes(effect)
  ) {
    const args = option.trim() ? option.split(/[ ,]+/).map(Number) : [];
    const pixels = await imageCore({
      kind: "transform",
      ...image,
      ...limits,
      operation: effect,
      args: new Float64Array(args),
    });
    image = {
      pixels,
      width:
        effect === "rotate"
          ? image.height
          : effect === "crop"
            ? args[2]
            : image.width,
      height:
        effect === "rotate"
          ? image.width
          : effect === "crop"
            ? args[3]
            : image.height,
    };
  } else {
    const n = Number(option);
    if (
      !option.trim() ||
      !Number.isInteger(n) ||
      n < 1 ||
      n >
        (id === "image-resize"
          ? bypass
            ? Number.MAX_SAFE_INTEGER
            : 8192
          : 100)
    )
      throw Error("Enter a valid width or quality.");
    if (id === "image-resize") {
      const scale = Math.min(1, n / image.width);
      image = await resizeRaster(
        image,
        Math.max(1, Math.round(image.width * scale)),
        Math.max(1, Math.round(image.height * scale)),
      );
    }
  }
  const format =
    id === "image-jpeg" ? "jpeg" : id === "image-webp" ? "webp" : "png";
  const blob = new Blob(
    [await encodeRaster(image, format, Number(option) || 80)],
    { type: `image/${format}` },
  );
  const meta = {
    Width: image.width,
    Height: image.height,
    Type: blob.type,
    "Original bytes": file.size,
    "Output bytes": blob.size,
  };
  return {
    blob,
    url: URL.createObjectURL(blob),
    meta,
    text: JSON.stringify(meta, null, 2),
  };
}
