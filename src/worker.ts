// SPDX-License-Identifier: AGPL-3.0-only
import { fetchRuntimeAsset } from "./runtime-assets";
interface ToolRequest {
  request: number;
  id: string;
  input: string;
  option: string;
}

import init, { run } from "./generated/l5z12_tools";
const ready = init({
  module_or_path: fetchRuntimeAsset("/wasm/l5z12_tools_bg.wasm"),
}).then(() => {
  self.postMessage({ ready: true });
  return { run };
});
ready.catch((error: unknown) => self.postMessage({ fatal: String(error) }));

self.onmessage = async ({ data }: MessageEvent<ToolRequest>) => {
  try {
    const { run } = await ready;
    self.postMessage({
      request: data.request,
      result: run(data.id, data.input, data.option),
    });
  } catch (error) {
    self.postMessage({ request: data.request, error: String(error) });
  }
};
