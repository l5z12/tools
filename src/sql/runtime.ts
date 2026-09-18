// SPDX-License-Identifier: AGPL-3.0-only
import type { SuiteOptions, SuiteResult } from "../workbench-types";
import { updateDatabaseControls } from "./controls";
import { armTimeout, overLimit } from "../limits";

let activeCancel: (() => void) | undefined;
export function cancelSqlite(): void {
  activeCancel?.();
}

export function configureSqlite(container: HTMLElement): void {
  const status = document.createElement("p");
  status.dataset.sqlStatus = "";
  status.setAttribute("role", "status");
  status.textContent = "SQLite loads on the first run.";
  const stop = document.createElement("button");
  stop.type = "button";
  stop.dataset.sqlStop = "";
  stop.textContent = "Stop SQLite";
  stop.disabled = true;
  stop.onclick = cancelSqlite;
  container.append(status, stop);
}

export async function runSqlite(
  id: string,
  input: string,
  file: File | undefined,
  options: SuiteOptions,
  container: HTMLElement,
): Promise<SuiteResult> {
  cancelSqlite();
  container
    .querySelectorAll<HTMLButtonElement>("[data-sqlite-page]")
    .forEach((button) => {
      button.disabled = true;
    });
  const maximum = 32 * 1024 * 1024;
  if (file && overLimit(file.size, maximum, options))
    throw Error(`Choose a file up to ${maximum / 1024 / 1024} MiB.`);
  const status = container.querySelector<HTMLElement>("[data-sql-status]")!;
  const stop = container.querySelector<HTMLButtonElement>("[data-sql-stop]")!;
  let worker: Worker | undefined;
  let workerURL: string | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let rejectStop: (error: Error) => void = () => {};
  const stopped = new Promise<never>((_, reject) => {
    rejectStop = reject;
  });
  const cancel = () => rejectStop(Error("SQLite stopped."));
  activeCancel = cancel;
  stop.disabled = false;
  try {
    const bytes = file
      ? new Uint8Array(await Promise.race([file.arrayBuffer(), stopped]))
      : undefined;
    if (overLimit(input.length, 2_000_000, options))
      throw Error("SQL is limited to 2 MiB.");
    // Inherit the page CSP on static hosts that do not supply worker headers.
    workerURL = URL.createObjectURL(
      new Blob(
        [
          `import ${JSON.stringify(new URL("/sql/runner.js", location.href).href)};`,
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
          if (data.result.sqliteBrowser) {
            updateDatabaseControls(container, data.result.sqliteBrowser);
            status.textContent =
              data.result.sqliteBrowser.error ??
              `Database opened · ${data.result.sqliteBrowser.tables.length} tables/views · ${data.result.sqliteBrowser.matchingRows} matching rows.`;
          } else status.textContent = "Finished.";
          resolve(data.result);
        }
      };
      worker!.onerror = (event) =>
        reject(Error(event.message || "SQLite worker failed."));
    });
    timer = armTimeout(
      () =>
        rejectStop(
          Error("SQLite exceeded the 30-second limit. The worker was stopped."),
        ),
      30_000,
      options,
    );
    worker.postMessage({
      id,
      source: input,
      bytes,
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
