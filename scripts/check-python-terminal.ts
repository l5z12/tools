// SPDX-License-Identifier: AGPL-3.0-only
import { mkdir } from "node:fs/promises";
await mkdir("work/python", { recursive: true });
const build = await Bun.build({
  entrypoints: ["scripts/lib/python-terminal-cases.ts"],
  outdir: "work/python",
  naming: "terminal-tests.mjs",
  target: "node",
  format: "esm",
  external: ["pyodide"],
});
if (!build.success)
  throw new AggregateError(build.logs, "Could not build terminal tests.");
// Bun does not yet expose JSPI. Node supplies the same stack-switching API as
// supported browsers; the production runtime remains entirely in the browser.
const result = Bun.spawnSync(
  ["node", "--experimental-wasm-jspi", "work/python/terminal-tests.mjs"],
  { stdout: "inherit", stderr: "inherit" },
);
if (result.exitCode !== 0) throw Error("Interactive Python tests failed.");
