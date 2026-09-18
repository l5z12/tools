// SPDX-License-Identifier: AGPL-3.0-only
import type { Field, Workbench } from "./tool-types";

const source = `fn main() {
    let squares: Vec<_> = (1..=5).map(|n| n * n).collect();
    println!("Squares: {squares:?}");
}
`;
const manifest = `[package]
name = "example"
version = "0.1.0"
edition = "2024"
license = "AGPL-3.0-only"

[dependencies]
serde = { version = "1", features = ["derive"], optional = true }

[features]
default = ["json"]
json = ["dep:serde"]
`;
function tool(
  id: string,
  name: string,
  description: string,
  sample: string,
  fields: Field[] = [],
  extra: Partial<Workbench> = {},
): Workbench {
  return {
    id,
    name,
    description,
    sample,
    fields,
    group: "Developer",
    tags: ["rust", "developer", "wasm"],
    keywords: ["rustc", "cargo", "webassembly"],
    option: "",
    optionLabel: "",
    inputMode: "optional-file",
    accept: ".rs,.txt,text/plain",
    ...extra,
  };
}
const edition: Field = {
  key: "edition",
  label: "Rust edition",
  choices: ["2024", "2021", "2018", "2015"],
  value: "2024",
};
const compilerHelp =
  "Runs locally in a stoppable worker. The experimental compiler and standard library load on first use (152 MiB before transfer compression). Single-file Rust targeting wasm32-wasip1; no downloaded crates, Cargo builds, network access, or OS threads. Maximum 1 MiB source, 120 seconds per run, and 128 KiB per output stream.";
const cargo = {
  tags: ["rust", "cargo", "developer", "analysis"],
  accept: ".toml,.lock,.json,.jsonl,.txt,text/plain,application/json",
  help: "Inspect a local file or pasted text. These tools do not invoke Cargo, resolve dependencies, or fetch crates.",
};

export const rustCompilerIds = new Set(["rust-playground", "rust-check"]);
export const rustTools: Workbench[] = [
  tool(
    "rust-playground",
    "Rust compiler & runner",
    "Compile Rust to WebAssembly, run it locally, and save the compiled module.",
    source,
    [
      {
        key: "mode",
        label: "Action",
        choices: ["Compile and run", "Compile only"],
        value: "Compile and run",
      },
      edition,
      { key: "stdin", label: "Standard input", type: "textarea", value: "" },
    ],
    { tags: ["rust", "wasm", "compilers", "developer"], help: compilerHelp },
  ),
  tool(
    "rust-check",
    "Rust type & borrow checker",
    "Run rustc type checking and borrow checking without executing the program.",
    source,
    [edition],
    { help: compilerHelp },
  ),
  tool(
    "rust-source",
    "Rust source inspector",
    "Check Rust syntax and explore modules, functions, types, imports, and methods.",
    source,
    [],
    {
      help: "Parses source with syn. No macro expansion or type checking; use the Rust type & borrow checker for compiler diagnostics. Limit: 256 KiB.",
    },
  ),
  tool(
    "rust-demangle",
    "Rust symbol demangler",
    "Decode legacy and v0 Rust symbols from stack traces and binaries.",
    "_ZN4test3foo17h05af221e174051e9E",
    [
      {
        key: "hash",
        label: "Include symbol hash",
        type: "checkbox",
        value: "false",
      },
    ],
  ),
  tool(
    "cargo-manifest",
    "Cargo manifest inspector",
    "Explore Cargo.toml dependencies, features, workspace defaults, targets, and profiles.",
    manifest,
    [],
    cargo,
  ),
  tool(
    "cargo-lock",
    "Cargo lockfile inspector",
    "Inspect locked packages, checksums, dependency references, and repeated package names.",
    `version = 4
[[package]]
name = "example"
version = "0.1.0"
dependencies = ["serde"]
[[package]]
name = "serde"
version = "1.0.219"
source = "registry+https://github.com/rust-lang/crates.io-index"
`,
    [
      {
        key: "duplicates",
        label: "Only packages with repeated names",
        type: "checkbox",
        value: "false",
      },
    ],
    cargo,
  ),
  tool(
    "cargo-metadata",
    "Cargo dependency graph viewer",
    "Explore workspace packages, enabled features, and the resolved graph from Cargo metadata.",
    JSON.stringify(
      {
        version: 1,
        packages: [
          {
            id: "path+file:///example#0.1.0",
            name: "example",
            version: "0.1.0",
            edition: "2024",
            license: "AGPL-3.0-only",
            dependencies: [],
            targets: [{ name: "example", kind: ["bin"] }],
            features: {},
          },
        ],
        workspace_members: ["path+file:///example#0.1.0"],
        resolve: {
          nodes: [{ id: "path+file:///example#0.1.0", deps: [], features: [] }],
          root: "path+file:///example#0.1.0",
        },
      },
      null,
      2,
    ),
    [],
    {
      ...cargo,
      help: "Paste or upload cargo metadata --format-version 1 JSON. Expand the resolved graph to inspect package IDs, dependency kinds, and enabled features. Output generated with --no-deps may omit the graph.",
    },
  ),
  tool(
    "cargo-diagnostics",
    "Cargo diagnostic viewer",
    "Read rustc and Clippy JSON diagnostics with codes, locations, and suggested fixes.",
    JSON.stringify({
      reason: "compiler-message",
      message: {
        level: "warning",
        code: { code: "unused_variables" },
        message: "unused variable: value",
        spans: [
          {
            file_name: "src/main.rs",
            line_start: 2,
            column_start: 9,
            is_primary: true,
          },
        ],
        children: [
          { level: "help", message: "prefix it with an underscore: _value" },
        ],
      },
    }),
    [],
    {
      ...cargo,
      help: "Paste newline-delimited JSON from cargo check --message-format=json, cargo clippy --message-format=json, or rustc --error-format=json. This viewer does not run Clippy.",
    },
  ),
  tool(
    "cargo-version",
    "Cargo version requirement matcher",
    "Check stable and prerelease versions against Cargo's semver requirements.",
    "0.9.0\n1.0.0\n1.5.2\n1.6.0-beta.1\n2.0.0",
    [{ key: "requirement", label: "Cargo version requirement", value: "^1.0" }],
    cargo,
  ),
  tool(
    "wasm-compile",
    "WAT to WebAssembly compiler",
    "Compile WebAssembly text into a validated .wasm binary locally.",
    `(module
  (func (export "add") (param i32 i32) (result i32)
    local.get 0
    local.get 1
    i32.add))`,
    [],
    {
      tags: ["wasm", "compilers", "converters", "developer"],
      accept: ".wat,.txt,text/plain",
    },
  ),
  tool(
    "wasm-disassemble",
    "WebAssembly to WAT",
    "Disassemble a WebAssembly binary to readable text and save a .wat file.",
    "",
    [],
    {
      inputMode: "file",
      accept: ".wasm,application/wasm",
      tags: ["wasm", "converters", "developer", "files"],
    },
  ),
  tool(
    "wasm-inspect",
    "WebAssembly module inspector",
    "Validate a WebAssembly module and inspect sections, exports, and custom metadata.",
    "",
    [],
    {
      inputMode: "file",
      accept: ".wasm,application/wasm",
      tags: ["wasm", "analysis", "developer", "files"],
    },
  ),
];
export const rustIds = new Set(rustTools.map((tool) => tool.id));
