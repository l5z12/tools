// SPDX-License-Identifier: AGPL-3.0-only
import { decodeRaster, encodeRaster, resizeRaster } from "./raster-client";
import { imageCore } from "./image-core";
import type { ImageArtifact } from "./image-tools";
import { overLimit, formBypassLimits } from "./limits";
import { t } from "./i18n";

interface Frame {
  file: File;
  delay: number;
  url: string;
}
let frames: Frame[] = [];
let active = "";
const node = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
function clearFrames() {
  frames.forEach((f) => URL.revokeObjectURL(f.url));
  frames = [];
}
function changed() {
  node("file").dispatchEvent(new Event("animationchange"));
}
function list() {
  const root = node("frames");
  root.replaceChildren();
  frames.forEach((frame, index) => {
    const row = document.createElement("div");
    row.className = "frame-row";
    const img = document.createElement("img");
    img.src = frame.url;
    img.alt = t("frameAlt", { n: index + 1 });
    const label = document.createElement("span");
    label.textContent = `${index + 1}. ${frame.file.name}`;
    const delay = document.createElement("input");
    delay.type = "number";
    delay.min = "10";
    delay.max = "65535";
    delay.value = String(frame.delay);
    delay.setAttribute("aria-label", t("frameDuration", { n: index + 1 }));
    delay.oninput = () => {
      frame.delay = Number(delay.value);
      changed();
    };
    row.append(img, label, delay);
    for (const [caption, shift] of [
      ["↑", -1],
      ["↓", 1],
    ] as const) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = caption;
      button.setAttribute(
        "aria-label",
        t(shift < 0 ? "moveFrameUp" : "moveFrameDown", { n: index + 1 }),
      );
      button.disabled = index + shift < 0 || index + shift >= frames.length;
      button.onclick = () => {
        [frames[index], frames[index + shift]] = [
          frames[index + shift],
          frames[index],
        ];
        list();
        changed();
      };
      row.append(button);
    }
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = t("remove");
    remove.onclick = () => {
      URL.revokeObjectURL(frame.url);
      frames.splice(index, 1);
      list();
      changed();
    };
    row.append(remove);
    root.append(row);
  });
}
export function configureAnimation(id: string) {
  active = id;
  clearFrames();
  list();
  const animation = id === "image-apng" || id === "image-fallback-apng";
  node("animation-options").hidden = !animation;
  node("fallback-options").hidden = id !== "image-fallback-apng";
  node<HTMLInputElement>("file").multiple = id === "image-apng";
  node<HTMLInputElement>("fallback-file").value = "";
}
export function loadAnimationFiles() {
  if (active !== "image-apng" && active !== "image-fallback-apng") return;
  clearFrames();
  const selected = Array.from(node<HTMLInputElement>("file").files ?? []);
  const keep = formBypassLimits() ? selected.length : 101;
  frames = selected
    .slice(0, keep)
    .map((file) => ({ file, delay: 100, url: URL.createObjectURL(file) }));
  list();
}
async function bitmap(file: File, bypass = false) {
  const limits = { bypassLimits: bypass };
  if (overLimit(file.size, 25 * 1024 * 1024, limits))
    throw Error("Each source image must be at most 25 MB.");
  const image = await decodeRaster(file, limits);
  if (
    overLimit(image.width, 8192, limits) ||
    overLimit(image.height, 8192, limits) ||
    overLimit(image.width * image.height, 8_388_608, limits)
  ) {
    throw Error(
      "Each source image must be at most 8 megapixels and 8192 pixels per side.",
    );
  }
  return image;
}
export async function processAnimation(bypass = false): Promise<ImageArtifact> {
  const limits = { bypassLimits: bypass };
  if (overLimit(frames.length, 100, limits) || !frames.length)
    throw Error("Choose 1–100 frames.");
  const snapshot = frames.map((f) => ({ ...f }));
  if (
    snapshot.some(
      (f) => !Number.isInteger(f.delay) || f.delay < 10 || f.delay > 65535,
    )
  )
    throw Error("Frame duration must be 10–65535 milliseconds.");
  const loopsText = node<HTMLInputElement>("animation-loops").value;
  const loops = Number(loopsText);
  if (!loopsText || !Number.isInteger(loops) || loops < 0 || loops > 65535)
    throw Error("Loop count must be 0–65535; 0 repeats forever.");
  const mode = active;
  const fallbackFile = node<HTMLInputElement>("fallback-file").files?.[0];
  const color = node<HTMLInputElement>("fallback-color").value;
  const first = await bitmap(snapshot[0].file, bypass);
  const w = first.width,
    h = first.height;
  const size = w * h * 4;
  if (overLimit(size * snapshot.length, 128 * 1024 * 1024, limits))
    throw Error(
      "Combined decoded frames exceed 128 MB. Reduce image dimensions or frame count.",
    );
  const all = new Uint8Array(size * snapshot.length);
  for (let i = 0; i < snapshot.length; i++) {
    const source = i === 0 ? first : await bitmap(snapshot[i].file, bypass);
    const frame = await resizeRaster(source, w, h, true);
    all.set(frame.pixels, i * size);
  }
  let fallback = new Uint8Array();
  let fallbackPreview: Blob | undefined;
  if (mode === "image-fallback-apng") {
    const background = new Uint8Array([
      parseInt(color.slice(1, 3), 16),
      parseInt(color.slice(3, 5), 16),
      parseInt(color.slice(5, 7), 16),
      255,
    ]);
    const source = fallbackFile
      ? await bitmap(fallbackFile, bypass)
      : {
          width: 1,
          height: 1,
          pixels: background,
        };
    const image = await resizeRaster(source, w, h, true, background);
    fallback = image.pixels;
    fallbackPreview = new Blob([await encodeRaster(image)], {
      type: "image/png",
    });
  }
  const bytes = await imageCore({
    kind: "animation",
    width: w,
    height: h,
    pixels: all,
    delays: new Uint16Array(snapshot.map((f) => f.delay)),
    loops,
    fallback,
    ...limits,
  });
  const blob = new Blob([bytes], { type: "image/png" });
  const meta = {
    Width: w,
    Height: h,
    Frames: snapshot.length,
    Loops: loops === 0 ? "Forever" : loops,
    Bytes: blob.size,
  };
  return {
    blob,
    url: URL.createObjectURL(blob),
    meta,
    text: JSON.stringify(meta, null, 2),
    secondaryUrl: fallbackPreview
      ? URL.createObjectURL(fallbackPreview)
      : undefined,
  };
}
