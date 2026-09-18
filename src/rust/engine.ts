// SPDX-License-Identifier: AGPL-3.0-only
import {
  Directory,
  Fd,
  File,
  OpenFile,
  PreopenDirectory,
  WASI,
  type Inode,
} from "@bjorn3/browser_wasi_shim";
import type { SuiteResult } from "../workbench-types";

export type RustRequest = {
  source: string;
  mode: "run" | "compile" | "check";
  edition: string;
  stdin: string;
};
const textLimit = 128 * 1024;
class Output extends Fd {
  text = "";
  private decoder = new TextDecoder();
  fd_write(bytes: Uint8Array) {
    if (this.text.length < textLimit)
      this.text = (
        this.text + this.decoder.decode(bytes, { stream: true })
      ).slice(0, textLimit);
    return { ret: 0, nwritten: bytes.length };
  }
}

// RIWB1 is the indexed standard-library bundle published with Weblings.
export function readSysroot(bytes: Uint8Array): PreopenDirectory {
  const decoder = new TextDecoder();
  if (decoder.decode(bytes.subarray(0, 6)) !== "RIWB1\n" || bytes.length < 10)
    throw Error("Invalid Rust standard-library bundle.");
  const length = new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  ).getUint32(6, true);
  const base = 10 + length;
  if (base > bytes.length) throw Error("Truncated Rust bundle index.");
  const index = JSON.parse(decoder.decode(bytes.subarray(10, base))) as {
    files: { p: string; o: number; l: number }[];
  };
  const root = new Map<string, Inode>();
  for (const item of index.files) {
    if (item.p === "manifest.json") continue;
    const parts = item.p.split("/");
    if (
      parts.some((part) => !part || part === "." || part === "..") ||
      !Number.isSafeInteger(item.o) ||
      !Number.isSafeInteger(item.l) ||
      item.o < 0 ||
      item.l < 0 ||
      base + item.o + item.l > bytes.length
    )
      throw Error("Invalid Rust bundle entry.");
    let directory = root;
    for (const part of parts.slice(0, -1)) {
      if (!directory.has(part)) directory.set(part, new Directory(new Map()));
      const child = directory.get(part);
      if (!(child instanceof Directory))
        throw Error("Conflicting bundle paths.");
      directory = child.contents;
    }
    directory.set(
      parts.at(-1)!,
      new File(bytes.slice(base + item.o, base + item.o + item.l), {
        readonly: true,
      }),
    );
  }
  return new PreopenDirectory("/sysroot", root);
}

type WasiInstance = Parameters<WASI["start"]>[0];
export async function compileRust(
  module: WebAssembly.Module,
  sysroot: Uint8Array,
  request: RustRequest,
  status: (message: string) => void,
): Promise<SuiteResult> {
  if (!["2015", "2018", "2021", "2024"].includes(request.edition))
    throw Error("Unsupported Rust edition.");
  status(
    request.mode === "check"
      ? "Checking Rust types and borrows…"
      : "Compiling Rust to WebAssembly…",
  );
  const log = new Output();
  const work = new PreopenDirectory(
    "/work",
    new Map([["main.rs", new File(new TextEncoder().encode(request.source))]]),
  );
  const args = [
    "rustc",
    "/work/main.rs",
    "--crate-name",
    "program",
    "--sysroot",
    "/sysroot",
    "--target",
    "wasm32-wasip1",
    "--edition",
    request.edition,
    "--color=never",
  ];
  const check = request.mode === "check";
  args.push(
    ...(check
      ? ["--emit=metadata", "-o", "/work/program.rmeta"]
      : [
          "-Zunstable-options",
          "-O",
          "-Cpanic=abort",
          "-o",
          "/work/program.wasm",
        ]),
  );
  const wasi = new WASI(
    args,
    ["CLIF2WASM_OBJECT=1"],
    [
      new OpenFile(new File([])),
      log,
      log,
      new PreopenDirectory("/tmp", new Map()),
      readSysroot(sysroot),
      work,
    ],
    { debug: false },
  );
  let exit: number;
  try {
    const instance = await WebAssembly.instantiate(module, {
      wasi_snapshot_preview1: wasi.wasiImport,
    });
    exit = wasi.start(instance as unknown as WasiInstance);
  } catch (error) {
    return { kind: "code", text: log.text || String(error) };
  }
  if (exit !== 0)
    return {
      kind: "code",
      text: log.text || `Compiler exited with code ${exit}.`,
    };
  if (check)
    return {
      kind: "code",
      text: `${log.text}\nType and borrow checks passed.`.trim(),
    };
  const binary = work.dir.contents.get("program.wasm");
  if (!(binary instanceof File) || !binary.data.length)
    throw Error(
      log.text || "The compiler did not produce a WebAssembly module.",
    );
  const bytes = new Uint8Array(binary.data);
  const result: SuiteResult = {
    kind: "code",
    text: log.text || "Compiled successfully.",
    mediaFiles: [{ name: "program.wasm", mime: "application/wasm", bytes }],
  };
  if (request.mode === "compile") return result;
  status("Running compiled Rust…");
  const output = new Output();
  const errors = new Output();
  const runtime = new WASI(
    ["program"],
    [],
    [
      new OpenFile(new File(new TextEncoder().encode(request.stdin))),
      output,
      errors,
      new PreopenDirectory("/sandbox", new Map()),
    ],
    { debug: false },
  );
  try {
    const program = await WebAssembly.instantiate(bytes, {
      wasi_snapshot_preview1: runtime.wasiImport,
    });
    const code = runtime.start(program.instance as unknown as WasiInstance);
    result.text = [log.text, output.text, errors.text, `Exit code: ${code}`]
      .filter(Boolean)
      .join("\n");
  } catch (error) {
    result.text = [
      log.text,
      output.text,
      errors.text,
      `Runtime error: ${String(error)}`,
    ]
      .filter(Boolean)
      .join("\n");
  }
  return result;
}
