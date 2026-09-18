// SPDX-License-Identifier: AGPL-3.0-only
import type { SuiteOptions, SuiteResult } from "../workbench-types";
import { armTimeout, overLimit } from "../limits";
let activeCancel: (() => void) | undefined;
export function cancelRust(): void {
  activeCancel?.();
}
export function configureRust(container: HTMLElement): void {
  const status = document.createElement("p");
  status.dataset.rustStatus = "";
  status.setAttribute("role", "status");
  status.textContent = "Rust loads on the first run.";
  const stop = document.createElement("button");
  stop.type = "button";
  stop.dataset.rustStop = "";
  stop.textContent = "Stop Rust";
  stop.disabled = true;
  stop.onclick = cancelRust;
  container.append(status, stop);
}
export async function runRust(
  id: string,
  input: string,
  file: File | undefined,
  options: SuiteOptions,
  container: HTMLElement,
): Promise<SuiteResult> {
  cancelRust();
  if (file && overLimit(file.size, 1024 * 1024, options))
    throw Error("Choose a Rust file up to 1 MiB.");
  const status = container.querySelector<HTMLElement>("[data-rust-status]")!;
  const stop = container.querySelector<HTMLButtonElement>("[data-rust-stop]")!;
  let worker: Worker | undefined;
  let workerUrl: string | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let rejectStop: (error: Error) => void = () => {};
  const stopped = new Promise<never>((_, reject) => {
    rejectStop = reject;
  });
  const cancel = () => rejectStop(Error("Rust stopped."));
  activeCancel = cancel;
  stop.disabled = false;
  try {
    const source = file ? await Promise.race([file.text(), stopped]) : input;
    if (!source.trim()) throw Error("Enter Rust code first.");
    if (
      overLimit(
        new TextEncoder().encode(source).length,
        1024 * 1024,
        options,
      ) ||
      overLimit(String(options.stdin ?? "").length, 1024 * 1024, options)
    )
      throw Error("Rust source and input are limited to 1 MiB each.");
    // A blob bootstrap inherits the page CSP even on hosts without worker headers.
    workerUrl = URL.createObjectURL(
      new Blob(
        [
          `import ${JSON.stringify(new URL("/rust/runner.js", location.href).href)};`,
        ],
        { type: "text/javascript" },
      ),
    );
    worker = new Worker(workerUrl, { type: "module" });
    const result = new Promise<SuiteResult>((resolve, reject) => {
      worker!.onmessage = ({ data }) => {
        if (data.type === "status") status.textContent = data.text;
        else if (data.type === "error") reject(Error(data.error));
        else if (data.type === "result") resolve(data.result);
      };
      worker!.onerror = (event) =>
        reject(Error(event.message || "Rust worker failed."));
    });
    timer = armTimeout(
      () =>
        rejectStop(
          Error("Rust exceeded the 120-second limit. The worker was stopped."),
        ),
      120_000,
      options,
    );
    worker.postMessage({
      source,
      edition: String(options.edition ?? "2024"),
      stdin: String(options.stdin ?? ""),
      bypassLimits: options.bypassLimits === true,
      mode:
        id === "rust-check"
          ? "check"
          : options.mode === "Compile only"
            ? "compile"
            : "run",
    });
    const output = await Promise.race([result, stopped]);
    status.textContent = "Finished.";
    return output;
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    worker?.terminate();
    if (workerUrl) URL.revokeObjectURL(workerUrl);
    clearTimeout(timer);
    stop.disabled = true;
    if (activeCancel === cancel) activeCancel = undefined;
  }
}
