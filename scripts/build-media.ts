// SPDX-License-Identifier: AGPL-3.0-only
import { copyFile, mkdir } from "node:fs/promises";

await mkdir("public/ffmpeg", { recursive: true });
for (const name of ["ffmpeg-core.js", "ffmpeg-core.wasm"]) {
  await copyFile(
    `node_modules/@ffmpeg/core/dist/esm/${name}`,
    `public/ffmpeg/${name}`,
  );
}
for (const name of [
  "worker.js",
  "const.js",
  "errors.js",
  "classes.js",
  "utils.js",
]) {
  await copyFile(
    `node_modules/@ffmpeg/ffmpeg/dist/esm/${name}`,
    `public/ffmpeg/${name}`,
  );
}
console.log("Prepared local FFmpeg browser assets.");
