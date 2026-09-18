// SPDX-License-Identifier: AGPL-3.0-only
import {
  Directory,
  File,
  OpenFile,
  PreopenDirectory,
  WASI,
} from "@bjorn3/browser_wasi_shim";
import { CapturedOutput, legacyImports, readCppSysroot } from "./wasi";
import type { SuiteResult } from "../workbench-types";

export type CppRequest = {
  source: string;
  standard: string;
  optimization: string;
  stdin: string;
  mode: "run" | "compile" | "check" | "preprocess" | "assembly";
};
export type CppAssets = {
  clang: WebAssembly.Module;
  sysroot: Uint8Array;
  linker: () => Promise<WebAssembly.Module>;
};
type WasiInstance = Parameters<WASI["start"]>[0];
const encoder = new TextEncoder();

export async function compileCpp(
  assets: CppAssets,
  request: CppRequest,
  status: (text: string) => void,
): Promise<SuiteResult> {
  if (
    !["c99", "c11", "c17", "c++11", "c++14", "c++17"].includes(request.standard)
  )
    throw Error("Unsupported language standard.");
  if (!["0", "1", "2", "3", "s", "z"].includes(request.optimization))
    throw Error("Unsupported optimization level.");
  if (
    encoder.encode(request.source).length > 1024 * 1024 ||
    encoder.encode(request.stdin).length > 1024 * 1024
  )
    throw Error("Source and stdin are limited to 1 MiB each.");
  const root = readCppSysroot(assets.sysroot);
  const sourceName = request.standard.startsWith("c++") ? "main.cpp" : "main.c";
  const work = new Directory(
    new Map([[sourceName, new File(encoder.encode(request.source))]]),
  );
  root.set("work", work);
  root.set("tmp", new Directory(new Map()));
  const diagnostics = new CapturedOutput();
  const compilerOutput = new CapturedOutput(1024 * 1024);
  const args = [
    "clang",
    "-cc1",
    "-triple",
    "wasm32-unknown-wasi",
    "-isysroot",
    "/",
    "-internal-isystem",
    "/include/c++/v1",
    "-internal-isystem",
    "/include",
    "-internal-isystem",
    "/lib/clang/8.0.1/include",
    "-ferror-limit",
    "20",
    "-std=" + request.standard,
    "-O" + request.optimization,
    "-Wall",
    "-Wextra",
    "-x",
    request.standard.startsWith("c++") ? "c++" : "c",
  ];
  switch (request.mode) {
    case "check":
      args.push("-fsyntax-only");
      break;
    case "preprocess":
      args.push("-E", "-P", "-o", "-");
      break;
    case "assembly":
      args.push("-S", "-o", "-");
      break;
    default:
      args.push("-emit-obj", "-o", "/work/main.o");
  }
  args.push("/work/" + sourceName);
  status("Compiling C/C++ locally…");
  const invoke = async (module: WebAssembly.Module, argv: string[]) => {
    const wasi = new WASI(
      argv,
      ["PWD=/", "TMPDIR=/tmp"],
      [
        new OpenFile(new File([])),
        compilerOutput,
        diagnostics,
        new PreopenDirectory("/", root),
      ],
      { debug: false },
    );
    const instance = await WebAssembly.instantiate(module, legacyImports(wasi));
    return wasi.start(instance as unknown as WasiInstance);
  };
  const exit = await invoke(assets.clang, args);
  if (exit !== 0)
    return {
      kind: "code",
      text: diagnostics.finish() || `Compiler exited with code ${exit}.`,
    };
  if (request.mode === "check")
    return {
      kind: "code",
      text: `${diagnostics.finish()}\nSyntax and type checks passed.`.trim(),
    };
  if (request.mode === "preprocess" || request.mode === "assembly")
    return {
      kind: "code",
      text: [diagnostics.finish(), compilerOutput.finish()]
        .filter(Boolean)
        .join("\n"),
    };
  status("Linking WebAssembly…");
  const linker = await assets.linker();
  const linkExit = await invoke(linker, [
    "wasm-ld",
    "--no-threads",
    "-z",
    "stack-size=1048576",
    "--max-memory=268435456",
    "-L/lib/wasm32-wasi",
    "/lib/wasm32-wasi/crt1.o",
    "/work/main.o",
    "-lc",
    "-lc++",
    "-lc++abi",
    "-o",
    "/work/program.wasm",
  ]);
  if (linkExit !== 0)
    return {
      kind: "code",
      text: diagnostics.finish() || `Linker exited with code ${linkExit}.`,
    };
  const binary = work.contents.get("program.wasm");
  if (!(binary instanceof File) || !binary.data.length)
    throw Error("The compiler produced no WebAssembly output.");
  const bytes = new Uint8Array(binary.data);
  const result: SuiteResult = {
    kind: "code",
    text: diagnostics.finish() || "Compiled successfully.",
    mediaFiles: [{ name: "program.wasm", mime: "application/wasm", bytes }],
  };
  if (request.mode === "compile") return result;
  status("Running compiled program…");
  const stdout = new CapturedOutput();
  const stderr = new CapturedOutput();
  const runtime = new WASI(
    ["program"],
    [],
    [
      new OpenFile(new File(encoder.encode(request.stdin), { readonly: true })),
      stdout,
      stderr,
    ],
    { debug: false },
  );
  try {
    const instance = await WebAssembly.instantiate(
      bytes,
      legacyImports(runtime, true),
    );
    const code = runtime.start(instance.instance as unknown as WasiInstance);
    result.text = [
      diagnostics.finish(),
      stdout.finish(),
      stderr.finish(),
      `Exit code: ${code}`,
    ]
      .filter(Boolean)
      .join("\n");
  } catch (error) {
    result.text = [
      diagnostics.finish(),
      stdout.finish(),
      stderr.finish(),
      `Runtime error: ${String(error)}`,
    ]
      .filter(Boolean)
      .join("\n");
  }
  return result;
}
