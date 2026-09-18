// SPDX-License-Identifier: AGPL-3.0-only
import { mkdir, copyFile } from "node:fs/promises";
await mkdir("public/image-codecs", { recursive: true });
for (const [packageName, paths] of [
  ["webp", ["codec/enc/webp_enc.wasm", "codec/enc/webp_enc_simd.wasm"]],
  ["avif", ["codec/dec/avif_dec.wasm"]],
] as const) {
  for (const path of paths)
    await copyFile(
      `node_modules/@jsquash/${packageName}/${path}`,
      `public/image-codecs/${path.split("/").at(-1)}`,
    );
  await copyFile(
    `node_modules/@jsquash/${packageName}/LICENSE`,
    `public/image-codecs/LICENSE.${packageName}.txt`,
  );
}
console.log("Prepared local AVIF and WebP WASM codecs.");
