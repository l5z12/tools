// SPDX-License-Identifier: AGPL-3.0-only
import type { SuiteOptions, SuiteResult } from "../workbench-types";

type GoRuntime = {
  importObject: WebAssembly.Imports;
  run(instance: WebAssembly.Instance): Promise<void>;
};
type GoGlobals = typeof globalThis & {
  Go: new () => GoRuntime;
  runGoTool: (id: string, input: Uint8Array, options: string) => string;
  goToolVersion: string;
};

export async function loadGoEngine(
  runtimeURL: string,
  wasm: ArrayBuffer,
): Promise<{
  version: string;
  run(id: string, input: Uint8Array, options: SuiteOptions): SuiteResult;
}> {
  await import(/* @vite-ignore */ runtimeURL);
  const globals = globalThis as GoGlobals;
  const go = new globals.Go();
  const module = await WebAssembly.instantiate(wasm, go.importObject);
  let runtimeError: unknown;
  // Go registers its synchronous entry point before parking its main goroutine.
  void go.run(module.instance).catch((error) => {
    runtimeError = error;
  });
  if (!globals.runGoTool) throw Error("Go runtime did not initialize.");
  return {
    version: globals.goToolVersion,
    run(id, input, options) {
      if (runtimeError) throw runtimeError;
      const result = JSON.parse(
        globals.runGoTool(id, input, JSON.stringify(options)),
      ) as SuiteResult & { error?: string };
      if (result.error) throw Error(result.error);
      // Preserve both views when the shared UI copies or downloads raw output.
      if (result.rows && result.data !== undefined) {
        result.text = JSON.stringify(
          { rows: result.rows, data: result.data },
          null,
          2,
        );
      }
      return result;
    },
  };
}
