// SPDX-License-Identifier: AGPL-3.0-only
import { copyFile, mkdir } from "node:fs/promises";

await mkdir("public/sql", { recursive: true });
await copyFile(
  "node_modules/sql.js/dist/sql-wasm.wasm",
  "public/sql/sql-wasm.wasm",
);
await copyFile("node_modules/sql.js/LICENSE", "public/sql/LICENSE.sql.js.txt");
const build = await Bun.build({
  entrypoints: ["src/sql/worker.ts"],
  outdir: "public/sql",
  naming: "runner.js",
  target: "browser",
  format: "esm",
  external: ["node:fs", "node:crypto"],
  banner:
    "// SPDX-License-Identifier: AGPL-3.0-only\n// Includes sql.js (MIT), see LICENSE.sql.js.txt. SQLite is public domain.",
});
if (!build.success)
  throw new AggregateError(build.logs, "SQLite worker build failed.");
console.log("Prepared local SQLite WebAssembly runtime.");
