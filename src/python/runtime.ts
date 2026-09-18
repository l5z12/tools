// SPDX-License-Identifier: AGPL-3.0-only
import type { SuiteOptions, SuiteResult } from "../workbench-types";
import type { createTerminal } from "./terminal";
import {
  PYTHON_SOURCE_LIMIT,
  PYTHON_TEXT_LIMIT,
  type PythonMessage,
} from "./protocol";
import { armTimeout, bypassLimits, overLimit } from "../limits";

let activeCancel: (() => void) | undefined;
let activeTerminal: ReturnType<typeof createTerminal> | undefined;
export function cancelPython(): void {
  activeCancel?.();
}
export function disposePython(): void {
  cancelPython();
  activeTerminal?.dispose();
  activeTerminal = undefined;
}

let terminalStyles: Promise<void> | undefined;
function loadTerminalStyles(): Promise<void> {
  return (terminalStyles ??= new Promise<void>((resolve, reject) => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "/python/xterm.css";
    link.onload = () => resolve();
    link.onerror = () => {
      link.remove();
      terminalStyles = undefined;
      reject(Error("Could not load terminal styles."));
    };
    document.head.append(link);
  }));
}

export function configurePython(
  container: HTMLElement,
  analysis = false,
): void {
  const status = document.createElement("p");
  status.dataset.pythonStatus = "";
  status.setAttribute("role", "status");
  status.textContent = "Python is ready to load on your first run.";
  const stop = document.createElement("button");
  stop.type = "button";
  stop.dataset.pythonStop = "";
  stop.textContent = "Stop Python";
  stop.disabled = true;
  stop.onclick = cancelPython;
  const label = document.createElement("h3");
  label.textContent = "Console";
  const output = document.createElement("pre");
  output.dataset.pythonConsole = "";
  output.className = "python-console";
  output.setAttribute("aria-label", "Python console");
  output.tabIndex = 0;
  output.textContent = "Output will appear here.";
  output.hidden = label.hidden = analysis;
  const terminal = document.createElement("div");
  terminal.dataset.pythonTerminal = "";
  terminal.hidden = true;
  container.append(status, stop, label, output, terminal);
  const mode = container.querySelector<HTMLSelectElement>("#suite-mode");
  const inputMode =
    container.querySelector<HTMLSelectElement>("#suite-inputMode");
  const updateFields = () => {
    const repl = mode?.value === "Interactive REPL";
    const editor = document.getElementById("input");
    const header = document.querySelector<HTMLElement>(".field-header");
    if (editor) editor.hidden = repl;
    if (header) header.hidden = repl;
    const picker = container.querySelector<HTMLElement>("#suite-file");
    if (picker) {
      picker.hidden = repl;
      if (picker.previousElementSibling instanceof HTMLElement)
        picker.previousElementSibling.hidden = repl;
      if (picker.nextElementSibling instanceof HTMLElement)
        picker.nextElementSibling.hidden = repl;
    }
    const prefilled =
      mode?.value !== "Interactive REPL" &&
      inputMode?.value === "Prefilled input";
    for (const field of container.querySelectorAll<HTMLElement>(
      '#suite-stdin, label[for="suite-stdin"]',
    ))
      field.hidden = !prefilled;
    if (inputMode) inputMode.disabled = mode?.value === "Interactive REPL";
  };
  mode?.addEventListener("change", updateFields);
  inputMode?.addEventListener("change", updateFields);
  updateFields();
}

export async function runPython(
  source: string,
  file: File | undefined,
  options: SuiteOptions,
  container: HTMLElement,
  operation?: string,
): Promise<SuiteResult> {
  const repl = options.mode === "Interactive REPL";
  if (!repl && file && overLimit(file.size, PYTHON_SOURCE_LIMIT, options))
    throw Error("Choose a Python script up to 1 MiB.");
  // Register cancellation before any asynchronous read, so changing tools cannot
  // start an orphaned interpreter when the old file finishes loading.
  disposePython();
  const status = container.querySelector<HTMLElement>("[data-python-status]")!;
  const stop =
    container.querySelector<HTMLButtonElement>("[data-python-stop]")!;
  const console = container.querySelector<HTMLElement>(
    "[data-python-console]",
  )!;
  let worker: Worker | undefined;
  let workerURL: string | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let terminal: ReturnType<typeof createTerminal> | undefined;
  const terminalHost = container.querySelector<HTMLElement>(
    "[data-python-terminal]",
  )!;
  let rejectStop: (error: Error) => void = () => {};
  const stopped = new Promise<never>((_, reject) => {
    rejectStop = reject;
  });
  const cancel = () =>
    rejectStop(Error("Python stopped. The session was cleared."));
  const wait = <T>(promise: Promise<T>) => Promise.race([promise, stopped]);
  activeCancel = cancel;
  stop.disabled = false;
  console.textContent = "";
  try {
    const code = repl ? "" : file ? await wait(file.text()) : source;
    const stdin = String(options.stdin ?? "");
    const interactive = repl || options.inputMode === "Interactive terminal";
    if (!code.trim() && !repl && !operation)
      throw Error("Enter Python code or choose a .py file first.");
    if (
      overLimit(
        new TextEncoder().encode(code).length,
        PYTHON_SOURCE_LIMIT,
        options,
      ) ||
      overLimit(
        new TextEncoder().encode(stdin).length,
        PYTHON_SOURCE_LIMIT,
        options,
      )
    )
      throw Error("Code and standard input must each be at most 1 MiB.");
    const seconds = Number(options.seconds ?? 30);
    if (!bypassLimits(options) && ![10, 30, 60, 120].includes(seconds))
      throw Error("Choose a valid execution time limit.");
    let remaining = seconds * 1000;
    let runningSince: number | undefined;
    let waitingKind: "repl" | "stdin" | undefined;
    const pauseClock = () => {
      clearTimeout(deadline);
      if (runningSince !== undefined)
        remaining -= performance.now() - runningSince;
      runningSince = undefined;
    };
    const resumeClock = () => {
      clearTimeout(deadline);
      runningSince = performance.now();
      deadline = armTimeout(
        () =>
          rejectStop(
            Error(
              `Python stopped after ${seconds} seconds of execution. The session was cleared.`,
            ),
          ),
        Math.max(0, remaining),
        options,
      );
    };
    console.hidden = interactive || !!operation;
    terminalHost.hidden = !interactive;
    if (interactive) {
      status.textContent = "Loading terminal…";
      await wait(loadTerminalStyles());
      const moduleURL = new URL("/python/terminal.js", location.origin).href;
      const { createTerminal } = (await wait(
        import(/* @vite-ignore */ moduleURL),
      )) as typeof import("./terminal");
      terminal = createTerminal(
        terminalHost,
        (reply) => {
          if (!waitingKind) return;
          if (waitingKind === "repl") remaining = seconds * 1000;
          waitingKind = undefined;
          resumeClock();
          status.textContent = "Running Python…";
          worker?.postMessage({ type: "input", reply });
        },
        cancel,
        (columns, rows) =>
          worker?.postMessage({ type: "resize", columns, rows }),
      );
      activeTerminal = terminal;
    }
    status.textContent = "Loading Python…";
    // Blob workers inherit the document's CSP, including on static hosts that
    // cannot attach CSP headers to worker responses. Only the entry module is
    // in this blob; the interpreter and its assets are served from this site.
    const entry = new URL("/python/runner.js", location.origin).href;
    workerURL = URL.createObjectURL(
      new Blob([`import ${JSON.stringify(entry)};`], {
        type: "text/javascript",
      }),
    );
    worker = new Worker(workerURL, { type: "module" });
    deadline = armTimeout(
      () => rejectStop(Error("Python took too long to load. Try again.")),
      120000,
      options,
    );
    const result = await wait(
      new Promise<SuiteResult>((resolve, reject) => {
        worker!.onerror = () =>
          reject(
            Error("Python could not start. Reload the page and try again."),
          );
        worker!.onmessageerror = () =>
          reject(Error("Could not read Python's response."));
        worker!.onmessage = ({ data }: MessageEvent<PythonMessage>) => {
          if (data.type === "running") {
            resumeClock();
            status.textContent = "Running Python…";
          } else if (data.type === "input-needed") {
            pauseClock();
            waitingKind = data.kind;
            status.textContent =
              data.kind === "repl"
                ? "Python REPL ready. Enter a command below."
                : "Python is waiting for input…";
            terminal?.requestInput();
          } else if (data.type === "output") {
            terminal?.write(data.text);
            const remaining =
              (bypassLimits(options)
                ? Number.MAX_SAFE_INTEGER
                : PYTHON_TEXT_LIMIT + 17000) -
              (console.textContent?.length ?? 0);
            if (remaining > 0)
              console.append(
                document.createTextNode(data.text.slice(0, remaining)),
              );
            console.scrollTop = console.scrollHeight;
          } else if (data.type === "error") {
            reject(Error(data.message));
          } else if (data.type === "tool-result") {
            status.textContent = "Analysis complete.";
            resolve(data.result);
          } else if (data.type === "complete") {
            const { text, failed, elapsed } = data.report;
            status.textContent = `${failed ? "Python finished with an error" : "Finished"} · ${(elapsed / 1000).toFixed(2)} seconds`;
            resolve({ kind: "code", text: text || "Finished with no output." });
          }
        };
        worker!.postMessage({
          type: "start",
          request: {
            code,
            stdin,
            interactive,
            repl,
            operation,
            options,
            ...terminal?.size(),
          },
        });
      }),
    );
    return result;
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    clearTimeout(deadline);
    worker?.terminate();
    if (workerURL) URL.revokeObjectURL(workerURL);
    stop.disabled = true;
    terminal?.finish();
    if (activeCancel === cancel) activeCancel = undefined;
  }
}
