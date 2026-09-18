// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import init, { suite_run } from "../public/wasm/l5z12_tools";
import { rustTools, rustCompilerIds } from "../src/lib/rust-tools";
import { compileRust, readSysroot } from "../src/rust/engine";
import type { SuiteOptions, SuiteResult } from "../src/workbench-types";

await init({
  module_or_path: await readFile("public/wasm/l5z12_tools_bg.wasm"),
});
const run = (
  id: string,
  text: string,
  options: SuiteOptions = {},
  bytes = new Uint8Array(),
): SuiteResult =>
  JSON.parse(suite_run(id, text, bytes, JSON.stringify(options)));
for (const tool of rustTools) {
  if (rustCompilerIds.has(tool.id) || tool.inputMode === "file") continue;
  const options = Object.fromEntries(
    tool.fields.map((field) => [
      field.key,
      field.type === "checkbox" ? field.value === "true" : (field.value ?? ""),
    ]),
  );
  assert.ok(run(tool.id, tool.sample, options).kind, tool.id);
}
const wat = rustTools.find((tool) => tool.id === "wasm-compile")!.sample;
const binary = new Uint8Array(
  Buffer.from(run("wasm-compile", wat).files![0].base64, "base64"),
);
const instance = await WebAssembly.instantiate(binary);
assert.equal(
  (instance.instance.exports.add as (a: number, b: number) => number)(20, 22),
  42,
);
const inspected = run("wasm-inspect", "", { fileProvided: true }, binary)
  .data as { valid: boolean; exports: { name: string }[] };
assert.equal(inspected.valid, true);
assert.equal(inspected.exports[0].name, "add");
assert.match(
  run("wasm-disassemble", "", { fileProvided: true }, binary).text!,
  /i32.add/,
);
assert.throws(() =>
  run("wasm-inspect", "", { fileProvided: true }, binary.slice(0, 10)),
);
assert.throws(() => run("wasm-compile", "(module (func (result i32)))"));
assert.throws(() => run("rust-source", "fn main( {"));
const outline = run(
  "rust-source",
  "mod inner { pub struct S; impl S { fn value() -> u32 { 1 } } }",
).data as { items: { kind: string; name: string; line: number }[] };
assert.ok(
  outline.items.some(
    (item) =>
      item.kind === "method" && item.name === "value" && item.line === 1,
  ),
);
assert.equal(
  run("rust-demangle", "_ZN4test3foo17h05af221e174051e9E").rows![0].demangled,
  "test::foo",
);
const versions = run("cargo-version", "1.2.3\n1.3.0-beta.1\n2.0.0", {
  requirement: "^1.0",
}).rows!;
assert.deepEqual(
  versions.map((row) => row.matches),
  [true, false, false],
);
const duplicates = run(
  "cargo-lock",
  'version = 4\n[[package]]\nname="a"\nversion="1.0.0"\n[[package]]\nname="a"\nversion="2.0.0"\n[[package]]\nname="b"\nversion="1.0.0"',
  { duplicates: true },
).rows!;
assert.equal(duplicates.length, 2);
const manifest = run(
  "cargo-manifest",
  '[workspace.dependencies]\nserde="1"\n[target.\'cfg(unix)\'.dependencies]\nlibc="0.2"',
).data as { dependencies: { name: string; target: string }[] };
assert.deepEqual(
  manifest.dependencies.map((row) => row.target),
  ["workspace defaults", "cfg(unix)"],
);
const uploaded = new TextEncoder().encode(
  '[package]\nname="uploaded"\nversion="0.1.0"',
);
assert.equal(
  (
    run("cargo-manifest", "not TOML", { fileProvided: true }, uploaded)
      .data as { package: { name: string } }
  ).package.name,
  "uploaded",
);
assert.throws(() => readSysroot(new Uint8Array(10)), /Invalid/);

const module = await WebAssembly.compile(
  await readFile("public/rust/rustc.wasm"),
);
const bundle = new Uint8Array(
  await readFile("public/rust/sysroot-wasip1.bundle"),
);
const compile = (
  source: string,
  mode: "run" | "compile" | "check" = "run",
  stdin = "",
) =>
  compileRust(
    module,
    bundle,
    { source, mode, stdin, edition: "2024" },
    () => {},
  );
const hello = await compile('fn main() { println!("Hello from Rust WASM"); }');
assert.match(hello.text!, /Hello from Rust WASM/);
assert.match(hello.text!, /Exit code: 0/);
assert.ok(WebAssembly.validate(hello.mediaFiles![0].bytes));
const check = await compile(
  'fn main() { panic!("must not execute"); }',
  "check",
);
assert.match(check.text!, /checks passed/);
const error = await compile(
  'fn main() { let text = String::from("hello"); let moved = text; println!("{text}"); }',
  "check",
);
assert.match(error.text!, /E0382/);
const io = await compile(
  'use std::io::{self, Read}; fn main() { let mut text = String::new(); io::stdin().read_to_string(&mut text).unwrap(); print!("{text}"); }',
  "run",
  "Input ✓",
);
assert.match(io.text!, /Input ✓/);
const only = await compile('fn main() { panic!("do not run"); }', "compile");
assert.ok(only.mediaFiles?.length);
assert.doesNotMatch(only.text!, /Runtime error/);
console.log(
  "Rust checks passed: all catalogs, Cargo parsing, source inspection, WAT roundtrip, real rustc compilation, borrow errors, stdin, and compile-only mode.",
);
