// SPDX-License-Identifier: AGPL-3.0-only
import { imageCore } from "./image-core";
import {
  decodeRaster,
  encodeRaster,
  resizeRaster,
  unpackRaster,
  type Raster,
} from "./raster-client";
import { suiteCore } from "./workbench-core";
import type { SuiteFile, SuiteOptions, SuiteResult } from "./workbench-types";
const b64 = (bytes: Uint8Array) => {
  let s = "";
  for (let i = 0; i < bytes.length; i += 8192)
    s += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(s);
};
async function png(image: Raster, name: string): Promise<SuiteFile> {
  return { name, mime: "image/png", base64: b64(await encodeRaster(image)) };
}
const textFile = (name: string, mime: string, text: string): SuiteFile => ({
  name,
  mime,
  base64: b64(new TextEncoder().encode(text)),
});
export async function imageSuite(
  id: string,
  files: File[],
  o: SuiteOptions,
): Promise<SuiteResult> {
  if (!files.length) throw Error("Choose an image first.");
  if (files.length > 64) throw Error("Choose at most 64 images.");
  if (id === "image-compare" && files.length !== 2)
    throw Error("Choose exactly two images.");
  if (!["sprite-builder", "image-compare"].includes(id) && files.length !== 1)
    throw Error("Choose one image.");
  const images: Raster[] = [];
  let total = 0;
  for (const f of files) {
    if (f.size > 32 * 1024 * 1024)
      throw Error("Each file must be under 32 MiB.");
    const im = await decodeRaster(f);
    images.push(im);
    total += im.width * im.height;
    if (
      im.width * im.height > 8_388_608 ||
      im.width > 8192 ||
      im.height > 8192 ||
      total > 16_777_216
    )
      throw Error("Images exceed the pixel limit (8 MP each, 16 MP total).");
  }
  const first = images[0];
  if (id === "palette-extractor") {
    const count = Number(o.count);
    if (!Number.isInteger(count) || count < 2 || count > 32)
      throw Error("Choose 2–32 colors.");
    const r = await suiteCore("palette-core", "", first.pixels, { count });
    r.files = [textFile("palette.json", "application/json", r.text ?? "[]")];
    return r;
  }
  if (id === "image-compare") {
    if (first.width !== images[1].width || first.height !== images[1].height)
      throw Error("Images must have identical dimensions. Resize them first.");
    if (first.width * first.height > 4_194_304)
      throw Error("Comparison accepts up to 4 megapixels per image.");
    const before = await png(first, "before.png");
    const after = await png(images[1], "after.png");
    const bytes = new Uint8Array(first.pixels.length * 2);
    bytes.set(first.pixels);
    bytes.set(images[1].pixels, first.pixels.length);
    const r = await suiteCore("compare-core", "", bytes);
    const heatmap = await png(
      {
        ...first,
        pixels: Uint8Array.from(atob(r.rgba!), (c) => c.charCodeAt(0)),
      },
      "difference.png",
    );
    r.comparison = {
      before: before.base64,
      after: after.base64,
      heatmap: heatmap.base64,
    };
    r.files = [heatmap];
    r.text = JSON.stringify(r.data, null, 2);
    delete r.rgba;
    return r;
  }
  if (id === "sprite-builder") {
    const columns = Number(o.columns),
      gap = Number(o.gap);
    if (
      !Number.isInteger(columns) ||
      columns < 1 ||
      columns > 64 ||
      !Number.isInteger(gap) ||
      gap < 0 ||
      gap > 256
    )
      throw Error("Columns must be 1–64 and gap 0–256.");
    const cols = Math.min(columns, images.length);
    const w = Math.max(...images.map((i) => i.width)),
      h = Math.max(...images.map((i) => i.height));
    const pixels = new Uint8Array(
      images.reduce((size, image) => size + image.pixels.length, 0),
    );
    let offset = 0;
    for (const image of images) {
      pixels.set(image.pixels, offset);
      offset += image.pixels.length;
    }
    const sheet = unpackRaster(
      await imageCore({
        kind: "sprite",
        width: 0,
        height: 0,
        pixels,
        sizes: images.map((image) => [image.width, image.height]),
        columns,
        gap,
      }),
    );
    const coordinates = images.map((im, i) => {
      const x = (i % cols) * (w + gap),
        y = Math.floor(i / cols) * (h + gap);
      return {
        name: files[i].name,
        className: `sprite-${i + 1}`,
        x,
        y,
        width: im.width,
        height: im.height,
      };
    });
    const json = JSON.stringify(
      {
        image: "sprites.png",
        width: sheet.width,
        height: sheet.height,
        sprites: coordinates,
      },
      null,
      2,
    );
    const css = coordinates
      .map(
        (s) =>
          `.${s.className} { display: inline-block; width: ${s.width}px; height: ${s.height}px; background: url("sprites.png") -${s.x}px -${s.y}px no-repeat; }`,
      )
      .join("\n");
    return {
      kind: "table",
      rows: coordinates,
      text: json,
      files: [
        await png(sheet, "sprites.png"),
        textFile("sprites.json", "application/json", json),
        textFile("sprites.css", "text/css", css),
      ],
    };
  }
  if (id === "favicon-builder") {
    const output: SuiteFile[] = [];
    const entries: { size: number; length: number }[] = [];
    const chunks: Uint8Array[] = [];
    for (const size of [16, 32, 48, 64, 180, 192, 256, 512]) {
      const icon = await resizeRaster(first, size, size, true);
      const f = await png(icon, `icon-${size}.png`);
      output.push(f);
      if ([16, 32, 48, 256].includes(size)) {
        const bytes = Uint8Array.from(atob(f.base64), (c) => c.charCodeAt(0));
        entries.push({ size, length: bytes.length });
        chunks.push(bytes);
      }
    }
    const bytes = new Uint8Array(chunks.reduce((n, b) => n + b.length, 0));
    let p = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, p);
      p += chunk.length;
    }
    const ico = await suiteCore("ico-core", "", bytes, { entries });
    return {
      kind: "data",
      text: "Generated ICO and PNG icons.",
      data: {
        sizes: [16, 32, 48, 64, 180, 192, 256, 512],
        icoSizes: [16, 32, 48, 256],
      },
      files: [...ico.files!, ...output],
    };
  }
  throw Error("Unknown image tool.");
}
