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
await mkdir("src/generated", { recursive: true });
for (const file of ["l5z12_tools.js", "l5z12_tools.d.ts"]) {
  await copyFile(`public/wasm/${file}`, `src/generated/${file}`);
}
