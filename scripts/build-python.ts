// SPDX-License-Identifier: AGPL-3.0-only
import { copyFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { pythonPackages } from "../src/python/packages";

await mkdir("public/python", { recursive: true });
await mkdir("public/python/packages", { recursive: true });
await copyFile("src/python/analysis.py", "public/python/analysis.py");
for (const pkg of pythonPackages) {
  const file = Bun.file(`public/python/packages/${pkg.filename}`);
  let bytes: Uint8Array;
  if (await file.exists()) bytes = new Uint8Array(await file.arrayBuffer());
  else {
    const response = await fetch(pkg.url);
    if (!response.ok) throw Error(`Could not fetch ${pkg.filename}`);
    bytes = new Uint8Array(await response.arrayBuffer());
  }
  if (createHash("sha256").update(bytes).digest("hex") !== pkg.sha256)
    throw Error(`Checksum mismatch for ${pkg.filename}`);
  if (!(await file.exists())) await Bun.write(file, bytes);
}
for (const name of [
  "pyodide.mjs",
  "pyodide.asm.mjs",
  "pyodide.asm.wasm",
  "python_stdlib.zip",
  "pyodide-lock.json",
]) {
  await copyFile(`node_modules/pyodide/${name}`, `public/python/${name}`);
}
const result = await Bun.build({
  entrypoints: ["src/python/worker.ts"],
  outdir: "public/python",
  naming: "runner.js",
  target: "browser",
  format: "esm",
  banner: "// SPDX-License-Identifier: AGPL-3.0-only",
});
if (!result.success)
  throw new AggregateError(result.logs, "Python worker build failed.");
const terminal = await Bun.build({
  entrypoints: ["src/python/terminal.ts"],
  outdir: "public/python",
  naming: "terminal.js",
  target: "browser",
  format: "esm",
  minify: true,
  banner:
    "// SPDX-License-Identifier: AGPL-3.0-only\n// Bundles xterm.js and addon-fit (MIT); see LICENSE.xterm.txt and LICENSE.xterm-fit.txt.",
});
if (!terminal.success)
  throw new AggregateError(terminal.logs, "Terminal build failed.");
await copyFile(
  "node_modules/@xterm/xterm/css/xterm.css",
  "public/python/xterm.css",
);
await copyFile(
  "node_modules/@xterm/xterm/LICENSE",
  "public/python/LICENSE.xterm.txt",
);
await copyFile(
  "node_modules/@xterm/addon-fit/LICENSE",
  "public/python/LICENSE.xterm-fit.txt",
);
console.log("Prepared local Python WebAssembly assets and worker.");
