// SPDX-License-Identifier: AGPL-3.0-only
export type WorkerReply<Result> = { result: Result } | { error: string };

interface WorkerTask<Request> {
  createWorker: () => Worker;
  request: Request;
  timeoutMs: number;
  timeoutMessage: string;
  failureMessage: string;
  signal?: AbortSignal;
}

/** Run one request in an isolated worker and release it on every exit path. */
export function runWorkerTask<Request, Result>(
  task: WorkerTask<Request>,
): Promise<Result> {
  return new Promise((resolve, reject) => {
    let worker: Worker | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    const finish = (outcome: WorkerReply<Result>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      task.signal?.removeEventListener("abort", abort);
      worker?.terminate();
      if ("error" in outcome) reject(new Error(outcome.error));
      else resolve(outcome.result);
    };
    const abort = () => finish({ error: "Processing cancelled." });
    if (task.signal?.aborted) {
      abort();
      return;
    }
    try {
      worker = task.createWorker();
      task.signal?.addEventListener("abort", abort, { once: true });
      worker.onmessage = ({ data }: MessageEvent<WorkerReply<Result>>) =>
        finish(data);
      worker.onerror = () => finish({ error: task.failureMessage });
      worker.onmessageerror = () =>
        finish({ error: "The worker returned an unreadable result." });
      if (task.timeoutMs > 0) {
        timer = setTimeout(
          () => finish({ error: task.timeoutMessage }),
          task.timeoutMs,
        );
      }
      worker.postMessage(task.request);
    } catch (error) {
      finish({ error: error instanceof Error ? error.message : String(error) });
    }
  });
}
