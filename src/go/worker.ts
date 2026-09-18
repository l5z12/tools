// SPDX-License-Identifier: AGPL-3.0-only
import { loadGoEngine } from "./engine";
import type { SuiteOptions } from "../workbench-types";

self.onmessage = async ({
  data,
}: MessageEvent<{ id: string; bytes: Uint8Array; options: SuiteOptions }>) => {
  try {
    self.postMessage({ type: "status", text: "Loading Go WebAssembly…" });
    const response = await fetch(new URL("/go/tools.wasm", import.meta.url));
    if (!response.ok) throw Error(`Could not load Go (${response.status}).`);
    const engine = await loadGoEngine(
      new URL("/go/wasm_exec.js", import.meta.url).href,
      await response.arrayBuffer(),
    );
    self.postMessage({ type: "status", text: `Running ${engine.version}…` });
    self.postMessage({
      type: "result",
      result: engine.run(data.id, data.bytes, data.options),
      version: engine.version,
    });
  } catch (error) {
    self.postMessage({
      type: "error",
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
