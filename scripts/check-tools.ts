// SPDX-License-Identifier: AGPL-3.0-only
import { workbenchIds } from "../src/lib/workbench-tools";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { tools } from "../src/lib/catalog";
import init, { run } from "../public/wasm/l5z12_tools.js";
await init({
  module_or_path: await readFile(
    new URL("../public/wasm/l5z12_tools_bg.wasm", import.meta.url),
  ),
});
const browserOnly = [
  "uuid",
  "password",
  "file-sha256",
  "image-inspect",
  "image-resize",
  "image-webp",
  "image-jpeg",
  "image-png",
];
for (const tool of tools.filter(
  (t) =>
    !workbenchIds.has(t.id) &&
    !browserOnly.includes(t.id) &&
    !t.id.startsWith("image-"),
)) {
  const value = run(tool.id, tool.sample, tool.option);
  assert.equal(typeof value, "string", tool.id);
  assert.ok(value.length, `${tool.id}: empty result`);
}
assert.equal(
  run("base64-decode", run("base64-encode", "Hello 🌍", ""), ""),
  "Hello 🌍",
);
assert.equal(
  run("base-convert", "-ff", "16"),
  "Binary: -11111111\nOctal: -377\nDecimal: -255\nHexadecimal: -FF",
);
assert.equal(run("gcd-lcm", "48 180", ""), "GCD: 12\nLCM: 720");
assert.throws(() => run("json-format", '{"broken":', ""));
assert.throws(() => run("hex-decode", "xyz", ""));
assert.throws(() => run("percentage-change", "0, 10", ""));
assert.throws(() => run("csv-to-json", "x,x\n1,2", ""));
console.log(
  `${tools.filter((t) => !workbenchIds.has(t.id) && !browserOnly.includes(t.id) && !t.id.startsWith("image-")).length} WASM examples passed; known answers and invalid inputs passed.`,
);
