// SPDX-License-Identifier: AGPL-3.0-only
import { fetchRuntimeAsset } from "./runtime-assets";
import init, { suite_run } from "./generated/l5z12_tools";
import type { SuiteRequest } from "./workers/protocol";
let ready: ReturnType<typeof init> | undefined;
self.onmessage = async ({ data }: { data: SuiteRequest }) => {
  try {
    await (ready ??= init({
      module_or_path: fetchRuntimeAsset("/wasm/l5z12_tools_bg.wasm"),
    }));
    if (data.id.startsWith("crypto-")) {
      const { prepareCrypto } = await import("./crypto-runtime");
      data.options = prepareCrypto(data.id, data.options);
    }
    const result = JSON.parse(
      suite_run(data.id, data.input, data.bytes, JSON.stringify(data.options)),
    );
    self.postMessage({ result });
  } catch (error) {
    self.postMessage({ error: String(error) });
  }
};
