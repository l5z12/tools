// SPDX-License-Identifier: AGPL-3.0-only
import { probe, type Signal } from "./signals";
export type HashBytes = (bytes: Uint8Array) => Promise<string>;

export async function canvasSignal(
  document: Document,
  hash: HashBytes,
): Promise<Signal> {
  const base = { group: "Rendering", name: "Canvas RGBA SHA-256" };
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 280;
    canvas.height = 80;
    const context = canvas.getContext("2d");
    if (!context) return { ...base, status: "unavailable", value: null };
    context.fillStyle = "#f6e7cc";
    context.fillRect(0, 0, 280, 80);
    context.font = "18px sans-serif";
    context.textBaseline = "alphabetic";
    context.fillStyle = "#17365d";
    context.fillText("L5Z12 · Aa Ω 中 🌍", 8, 27);
    context.globalCompositeOperation = "multiply";
    for (const [x, color] of [
      [90, "#f47c7c"],
      [115, "#6a9de5"],
      [140, "#79c898"],
    ] as const) {
      context.beginPath();
      context.fillStyle = color;
      context.arc(x, 53, 20, 0, Math.PI * 2);
      context.fill();
    }
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    return {
      ...base,
      status: "available",
      value: await hash(new Uint8Array(pixels)),
    };
  } catch {
    return { ...base, status: "blocked or failed", value: null };
  }
}

export function webglSignals(document: Document): Signal[] {
  let context: WebGLRenderingContext | null = null;
  const signals: Signal[] = [];
  const availability = probe("Rendering", "WebGL context", () => {
    context = document.createElement("canvas").getContext("webgl");
    return context ? "WebGL 1" : null;
  });
  signals.push(availability);
  if (!context) return signals;
  const gl = context as WebGLRenderingContext;
  try {
    const parameter = (name: string, key: number) =>
      signals.push(probe("WebGL", name, () => gl.getParameter(key)));
    parameter("Vendor", gl.VENDOR);
    parameter("Renderer", gl.RENDERER);
    parameter("Version", gl.VERSION);
    parameter("Shading language", gl.SHADING_LANGUAGE_VERSION);
    parameter("Maximum texture size", gl.MAX_TEXTURE_SIZE);
    parameter("Maximum vertex attributes", gl.MAX_VERTEX_ATTRIBS);
    signals.push(
      probe("WebGL", "Extensions", () => gl.getSupportedExtensions()?.sort()),
    );
    signals.push(
      probe("WebGL", "Unmasked renderer", () => {
        const extension = gl.getExtension("WEBGL_debug_renderer_info");
        return extension
          ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL)
          : null;
      }),
    );
    signals.push(
      probe("WebGL", "Unmasked vendor", () => {
        const extension = gl.getExtension("WEBGL_debug_renderer_info");
        return extension
          ? gl.getParameter(extension.UNMASKED_VENDOR_WEBGL)
          : null;
      }),
    );
  } finally {
    // Release the GPU context even when an individual capability is blocked.
    try {
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    } catch {
      /* Nothing else to release. */
    }
  }
  return signals;
}
