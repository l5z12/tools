// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { runWorkerTask } from "../src/workers/task";

class TestWorker {
  onmessage?: (event: { data: unknown }) => void;
  onerror?: () => void;
  onmessageerror?: () => void;
  terminations = 0;
  failPosting = false;
  postMessage() {
    if (this.failPosting) throw Error("Cannot clone request.");
  }
  terminate() {
    this.terminations++;
  }
  reply(data: unknown) {
    this.onmessage?.({ data });
  }
}
function start(worker: TestWorker, signal?: AbortSignal, timeoutMs = 1000) {
  return runWorkerTask<string, number>({
    createWorker: () => worker as unknown as Worker,
    request: "test",
    timeoutMs,
    timeoutMessage: "Timeout",
    failureMessage: "Worker failed",
    signal,
  });
}
const successful = new TestWorker();
const result = start(successful);
successful.reply({ result: 42 });
successful.reply({ error: "Late failure" });
assert.equal(await result, 42);
assert.equal(successful.terminations, 1);

for (const failure of [
  "error",
  "message",
  "clone",
  "abort",
  "timeout",
] as const) {
  const worker = new TestWorker();
  const controller = new AbortController();
  worker.failPosting = failure === "clone";
  const pending = start(
    worker,
    controller.signal,
    failure === "timeout" ? 5 : 1000,
  );
  const rejected = assert.rejects(pending);
  if (failure === "error") worker.onerror?.();
  if (failure === "message") worker.onmessageerror?.();
  if (failure === "abort") controller.abort();
  await rejected;
  assert.equal(worker.terminations, 1, failure);
}
const cancelled = new AbortController();
cancelled.abort();
const unused = new TestWorker();
await assert.rejects(start(unused, cancelled.signal), /cancelled/);
assert.equal(
  unused.terminations,
  0,
  "A cancelled request must not create a worker.",
);
await assert.rejects(
  runWorkerTask({
    createWorker: () => {
      throw Error("Constructor failed");
    },
    request: null,
    timeoutMs: 1000,
    timeoutMessage: "Timeout",
    failureMessage: "Failure",
  }),
  /Constructor failed/,
);
console.log(
  "Worker lifecycle passed: success, late replies, crashes, clone failures, cancellation, and timeout cleanup.",
);
