// SPDX-License-Identifier: AGPL-3.0-only
import type { SuiteOptions, SuiteResult } from "../workbench-types";
import { armTimeout, overLimit } from "../limits";

let activeCancel: (() => void) | undefined;
export function cancelGo(): void {
  activeCancel?.();
}

export function configureGo(container: HTMLElement): void {
  const status = document.createElement("p");
  status.dataset.goStatus = "";
  status.setAttribute("role", "status");
  status.textContent = "Go loads on the first run.";
  const stop = document.createElement("button");
  stop.type = "button";
  stop.dataset.goStop = "";
  stop.textContent = "Stop Go";
  stop.disabled = true;
  stop.onclick = cancelGo;
  container.append(status, stop);
}

export async function runGo(
  id: string,
  input: string,
  file: File | undefined,
  options: SuiteOptions,
  container: HTMLElement,
): Promise<SuiteResult> {
  cancelGo();
  const maximum = (id === "go-build-info" ? 32 : 2) * 1024 * 1024;
  if (file && overLimit(file.size, maximum, options))
    throw Error(`Choose a file up to ${maximum / 1024 / 1024} MiB.`);
  if (id === "go-build-info" && !file)
    throw Error("Choose a Go executable first.");
  const status = container.querySelector<HTMLElement>("[data-go-status]")!;
  const stop = container.querySelector<HTMLButtonElement>("[data-go-stop]")!;
  let worker: Worker | undefined;
  let workerURL: string | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let rejectStop: (error: Error) => void = () => {};
  const stopped = new Promise<never>((_, reject) => {
    rejectStop = reject;
  });
  const cancel = () => rejectStop(Error("Go stopped."));
  activeCancel = cancel;
  stop.disabled = false;
  try {
    const bytes = file
      ? new Uint8Array(await Promise.race([file.arrayBuffer(), stopped]))
      : new TextEncoder().encode(input);
    if (overLimit(bytes.byteLength, maximum, options))
      throw Error("Text is limited to 2 MiB.");
    // Inherit the page CSP on static hosts that do not supply worker headers.
    workerURL = URL.createObjectURL(
      new Blob(
        [
          `import ${JSON.stringify(new URL("/go/runner.js", location.href).href)};`,
        ],
        { type: "text/javascript" },
      ),
    );
    worker = new Worker(workerURL, { type: "module" });
    const result = new Promise<SuiteResult>((resolve, reject) => {
      worker!.onmessage = ({ data }) => {
        if (data.type === "status") status.textContent = data.text;
        else if (data.type === "error") reject(Error(data.error));
        else if (data.type === "result") {
          status.textContent = `Finished · ${data.version}`;
          resolve(data.result);
        }
      };
      worker!.onerror = (event) =>
        reject(Error(event.message || "Go worker failed."));
    });
    timer = armTimeout(
      () =>
        rejectStop(
          Error("Go exceeded the 30-second limit. The worker was stopped."),
        ),
      30_000,
      options,
    );
    worker.postMessage({ id, bytes, options }, [bytes.buffer]);
    return await Promise.race([result, stopped]);
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    worker?.terminate();
    if (workerURL) URL.revokeObjectURL(workerURL);
    clearTimeout(timer);
    stop.disabled = true;
    if (activeCancel === cancel) activeCancel = undefined;
  }
}
