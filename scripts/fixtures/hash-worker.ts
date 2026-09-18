// SPDX-License-Identifier: AGPL-3.0-only
import { readFile } from "node:fs/promises";
import init, { suite_run } from "../../public/wasm/l5z12_tools";
import type { SuiteOptions } from "../../src/workbench-types";

const ready = readFile(
  new URL("../../public/wasm/l5z12_tools_bg.wasm", import.meta.url),
).then((bytes) => init({ module_or_path: bytes }));
self.onmessage = async ({
  data,
}: MessageEvent<{
  id: string;
  input: string;
  bytes: Uint8Array;
  options: SuiteOptions;
}>) => {
  try {
    await ready;
    const result = JSON.parse(
      suite_run(data.id, data.input, data.bytes, JSON.stringify(data.options)),
    );
    self.postMessage({ result });
  } catch (error) {
    self.postMessage({ error: String(error) });
  }
};
