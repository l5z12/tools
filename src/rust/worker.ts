// SPDX-License-Identifier: AGPL-3.0-only
import { fetchRuntimeAsset } from "../runtime-assets";
import { compileRust, type RustRequest } from "./engine";

self.onmessage = async (event: MessageEvent<RustRequest>) => {
  const status = (text: string) => self.postMessage({ type: "status", text });
  try {
    status(
      "Loading the local Rust compiler and standard library (about 150 MiB)…",
    );
    const [compiler, bundle] = await Promise.all([
      fetchRuntimeAsset(new URL("./rustc.wasm", import.meta.url)),
      fetchRuntimeAsset(new URL("./sysroot-wasip1.bundle", import.meta.url)),
    ]);
    if (!compiler.ok || !bundle.ok)
      throw Error(
        "Could not load local Rust compiler assets. Run build:rust and retry.",
      );
    const [module, sysroot] = await Promise.all([
      WebAssembly.compileStreaming(compiler),
      bundle.arrayBuffer(),
    ]);
    const result = await compileRust(
      module,
      new Uint8Array(sysroot),
      event.data,
      status,
    );
    self.postMessage({ type: "result", result });
  } catch (error) {
    self.postMessage({
      type: "error",
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
