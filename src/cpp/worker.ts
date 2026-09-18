// SPDX-License-Identifier: AGPL-3.0-only
import { fetchRuntimeAsset } from "../runtime-assets";
import initFormat, { format } from "@wasm-fmt/clang-format/web";
import { compileCpp, type CppRequest } from "./engine";
import type { SuiteOptions, SuiteResult } from "../workbench-types";
import { overLimit } from "../limits";

async function asset(name: string): Promise<ArrayBuffer> {
  const response = await fetchRuntimeAsset(
    new URL(`/cpp/${name}`, import.meta.url),
  );
  if (!response.ok) throw Error(`Could not load ${name} (${response.status}).`);
  return response.arrayBuffer();
}

self.onmessage = async ({
  data,
}: MessageEvent<{ id: string; source: string; options: SuiteOptions }>) => {
  const status = (text: string) => self.postMessage({ type: "status", text });
  try {
    const options = data.options;
    let result: SuiteResult;
    if (data.id === "cpp-format") {
      status("Loading clang-format…");
      await initFormat(await asset("clang-format.wasm"));
      const style =
        options.style === "Custom"
          ? String(options.customStyle ?? "")
          : String(options.style ?? "LLVM");
      if (!style.trim() || overLimit(style.length, 65536, options))
        throw Error("Enter a formatting style up to 64 KiB.");
      result = {
        kind: "code",
        text: format(
          data.source,
          options.language === "C" ? "main.c" : "main.cpp",
          style,
        ),
      };
    } else {
      status("Loading Clang and its standard library…");
      const [clang, sysroot] = await Promise.all([
        asset("clang.wasm").then((bytes) => WebAssembly.compile(bytes)),
        asset("sysroot.tar").then((bytes) => new Uint8Array(bytes)),
      ]);
      const modes: Record<string, CppRequest["mode"]> = {
        "cpp-check": "check",
        "cpp-preprocess": "preprocess",
        "cpp-assembly": "assembly",
      };
      result = await compileCpp(
        {
          clang,
          sysroot,
          linker: () =>
            asset("lld.wasm").then((bytes) => WebAssembly.compile(bytes)),
        },
        {
          source: data.source,
          standard: String(options.standard ?? "c++17"),
          optimization: String(options.optimization ?? "0"),
          stdin: String(options.stdin ?? ""),
          bypassLimits: options.bypassLimits === true,
          mode:
            modes[data.id] ??
            (options.action === "Compile only" ? "compile" : "run"),
        },
        status,
      );
    }
    self.postMessage(
      { type: "result", result },
      result.mediaFiles?.map((file) => file.bytes.buffer) ?? [],
    );
  } catch (error) {
    self.postMessage({
      type: "error",
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
