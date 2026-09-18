// SPDX-License-Identifier: AGPL-3.0-only
import { fetchRuntimeAsset } from "./runtime-assets";
import init, {
  reference_load,
  reference_search,
  reference_decode,
  set_bypass_limits,
} from "./generated/l5z12_tools";
import { referenceDataset, referenceBrowsers } from "./lib/reference-tools";
import type { SuiteOptions } from "./workbench-types";
const ready = init({
  module_or_path: fetchRuntimeAsset("/wasm/l5z12_tools_bg.wasm"),
});
const loaded = new Map<string, Promise<void>>();
async function load(key: string) {
  let promise = loaded.get(key);
  if (!promise) {
    promise = (async () => {
      await ready;
      const response = await fetch(`/data/references/${key}.json`);
      if (!response.ok)
        throw Error(
          "The reference snapshot could not load. Reload the page to retry.",
        );
      const json = await response.text();
      reference_load(key, json);
    })();
    loaded.set(key, promise);
    promise.catch(() => loaded.delete(key));
  }
  await promise;
}
self.onmessage = async ({
  data,
}: {
  data: {
    request: number;
    id: string;
    input: string;
    options: SuiteOptions;
    page: number;
  };
}) => {
  try {
    const key = referenceDataset[data.id];
    if (!key) throw Error("Unknown reference tool.");
    await load(key);
    set_bypass_limits(data.options.bypassLimits === true);
    try {
      const result = referenceBrowsers.has(data.id)
        ? reference_search(
            key,
            data.input,
            String(data.options.family ?? "All"),
            data.page,
          )
        : reference_decode(data.id, data.input, JSON.stringify(data.options));
      self.postMessage({ request: data.request, result: JSON.parse(result) });
    } finally {
      set_bypass_limits(false);
    }
  } catch (error) {
    self.postMessage({ request: data.request, error: String(error) });
  }
};
