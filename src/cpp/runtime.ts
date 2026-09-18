// SPDX-License-Identifier: AGPL-3.0-only
import type { SuiteOptions, SuiteResult } from "../workbench-types";
import { armTimeout, overLimit } from "../limits";
import { t } from "../i18n";

let activeCancel: (() => void) | undefined;
export function cancelCpp(): void {
  activeCancel?.();
}

export function configureCpp(container: HTMLElement): void {
  const status = document.createElement("p");
  status.dataset.cppStatus = "";
  status.setAttribute("role", "status");
  status.textContent = t("cppLoading");
  const stop = document.createElement("button");
  stop.type = "button";
  stop.dataset.cppStop = "";
  stop.textContent = t("stopCpp");
  stop.disabled = true;
  stop.onclick = cancelCpp;
  container.append(status, stop);
}

export async function runCpp(
  id: string,
  input: string,
  file: File | undefined,
  options: SuiteOptions,
  container: HTMLElement,
): Promise<SuiteResult> {
  cancelCpp();
  const maximum = 1024 * 1024;
  if (file && overLimit(file.size, maximum, options))
    throw Error(`Choose a file up to ${maximum / 1024 / 1024} MiB.`);
  const status = container.querySelector<HTMLElement>("[data-cpp-status]")!;
  const stop = container.querySelector<HTMLButtonElement>("[data-cpp-stop]")!;
  let worker: Worker | undefined;
  let workerURL: string | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let rejectStop: (error: Error) => void = () => {};
  const stopped = new Promise<never>((_, reject) => {
    rejectStop = reject;
  });
  const cancel = () => rejectStop(Error("C/C++ stopped."));
  activeCancel = cancel;
  stop.disabled = false;
  try {
    const bytes = file
      ? new Uint8Array(await Promise.race([file.arrayBuffer(), stopped]))
      : new TextEncoder().encode(input);
    if (overLimit(bytes.byteLength, maximum, options))
      throw Error("Text is limited to 1 MiB.");
    // Inherit the page CSP on static hosts that do not supply worker headers.
    workerURL = URL.createObjectURL(
      new Blob(
        [
          `import ${JSON.stringify(new URL("/cpp/runner.js", location.href).href)};`,
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
          status.textContent = "Finished.";
          resolve(data.result);
        }
      };
      worker!.onerror = (event) =>
        reject(Error(event.message || "C/C++ worker failed."));
    });
    timer = armTimeout(
      () =>
        rejectStop(
          Error("C/C++ exceeded the 60-second limit. The worker was stopped."),
        ),
      60_000,
      options,
    );
    worker.postMessage({
      id,
      source: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      options,
    });
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
