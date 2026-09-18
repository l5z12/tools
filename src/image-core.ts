// SPDX-License-Identifier: AGPL-3.0-only
import { bypassLimits } from "./limits";
import type { ImageRequest } from "./workers/protocol";
import { runWorkerTask } from "./workers/task";

export function imageCore(
  request: ImageRequest,
  signal?: AbortSignal,
): Promise<Uint8Array<ArrayBuffer>> {
  return runWorkerTask<ImageRequest, Uint8Array<ArrayBuffer>>({
    createWorker: () =>
      new Worker(new URL("./image-worker.ts", import.meta.url), {
        type: "module",
      }),
    request,
    timeoutMs: bypassLimits(request) ? 0 : 60_000,
    timeoutMessage:
      "Image processing exceeded 60 seconds. Use fewer or smaller images.",
    failureMessage: "Image worker failed.",
    signal,
  });
}
