// SPDX-License-Identifier: AGPL-3.0-only
import { fetchRuntimeAsset } from "./runtime-assets";
import init from "./generated/l5z12_tools";

import { runImageRequest } from "./raster-engine";

import type { ImageRequest } from "./workers/protocol";
export type { ImageRequest } from "./workers/protocol";

const ready = init({
  module_or_path: fetchRuntimeAsset("/wasm/l5z12_tools_bg.wasm"),
});
self.onmessage = async ({ data }: MessageEvent<ImageRequest>) => {
  try {
    await ready;
    const result = await runImageRequest(data);
    self.postMessage({ result }, { transfer: [result.buffer] });
  } catch (error) {
    self.postMessage({ error: String(error) });
  }
};
