// SPDX-License-Identifier: AGPL-3.0-only
import { mkdir, copyFile } from "node:fs/promises";

const build = Bun.spawn(
  [
    "wasm-pack",
    "build",
    "core",
    "--target",
    "web",
    "--out-dir",
    "../public/wasm",
    "--release",
    "--locked",
  ],
  { stdout: "inherit", stderr: "inherit" },
);
if ((await build.exited) !== 0) process.exit(1);
const gluePath = "public/wasm/l5z12_tools.js";
const original = await Bun.file(gluePath).text();
const adapted = original
  .replace('/* @ts-self-types="./l5z12_tools.d.ts" */', "// @ts-nocheck")
  .replace("let wasmModule, wasmInstance, wasm;", "let wasm;")
  .replace(
    `function __wbg_finalize_init(instance, module) {
    wasmInstance = instance;
    wasm = instance.exports;
    wasmModule = module;`,
    `function __wbg_finalize_init(instance) {
    wasm = instance.exports;`,
  )
  .replace(
    "new URL('l5z12_tools_bg.wasm', import.meta.url)",
    "new URL(/* @vite-ignore */ 'l5z12_tools_bg.wasm', import.meta.url)",
  );
if (
  adapted === original ||
  !adapted.includes("// @ts-nocheck") ||
  !adapted.includes("/* @vite-ignore */") ||
  adapted.includes("wasmModule") ||
  adapted.includes("wasmInstance")
)
  throw Error(
    "wasm-pack glue no longer matches the expected Wasm URL or types pragma.",
  );
await Bun.write(gluePath, adapted);
await mkdir("src/generated", { recursive: true });
for (const file of ["l5z12_tools.js", "l5z12_tools.d.ts"]) {
  await copyFile(`public/wasm/${file}`, `src/generated/${file}`);
}
