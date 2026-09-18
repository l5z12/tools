// SPDX-License-Identifier: AGPL-3.0-only
import { bypassLimits } from "./limits";
import type { SuiteOptions, SuiteResult } from "./workbench-types";
import type { SuiteRequest } from "./workers/protocol";
import { runWorkerTask } from "./workers/task";

export function suiteCore(
  id: string,
  input = "",
  bytes: Uint8Array = new Uint8Array(),
  options: SuiteOptions = {},
  signal?: AbortSignal,
): Promise<SuiteResult> {
  return runWorkerTask<SuiteRequest, SuiteResult>({
    createWorker: () =>
      new Worker(new URL("./workbench-worker.ts", import.meta.url), {
        type: "module",
      }),
    request: { id, input, bytes, options },
    timeoutMs: bypassLimits(options) ? 0 : 60_000,
    timeoutMessage: "Processing exceeded 60 seconds. Try a smaller input.",
    failureMessage: "Workbench worker failed.",
    signal,
  });
}
