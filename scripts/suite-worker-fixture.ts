// SPDX-License-Identifier: AGPL-3.0-only
import type { SuiteOptions } from "../src/workbench-types";

/** Exercise browser adapters against the actual WASM exports in Bun tests. */
export function installSuiteWorker(
  run: (
    id: string,
    input: string,
    bytes: Uint8Array,
    options: string,
  ) => string,
): void {
  Object.assign(globalThis, {
    Worker: class {
      onmessage?: (event: {
        data: { result?: unknown; error?: string };
      }) => void;
      terminated = false;
      terminate() {
        this.terminated = true;
      }
      postMessage(request: {
        id: string;
        input: string;
        bytes: Uint8Array;
        options: SuiteOptions;
      }) {
        queueMicrotask(() => {
          if (this.terminated) return;
          try {
            const result = JSON.parse(
              run(
                request.id,
                request.input,
                request.bytes,
                JSON.stringify(request.options),
              ),
            );
            this.onmessage?.({ data: { result } });
          } catch (error) {
            this.onmessage?.({ data: { error: String(error) } });
          }
        });
      }
    },
  });
}
