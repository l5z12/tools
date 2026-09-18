// SPDX-License-Identifier: AGPL-3.0-only
import { executePython } from "./engine";
import { analyzePython } from "./analysis";
import type {
  PythonCommand,
  PythonInputReply,
  PythonMessage,
  PythonRequest,
} from "./protocol";

const send = (message: PythonMessage) => postMessage(message);
let started = false;
let pendingInput: ((reply: PythonInputReply) => void) | undefined;
let size = { rows: 18, columns: 80 };

self.onmessage = (event: MessageEvent<PythonCommand>) => {
  const command = event.data;
  if (command.type === "input") {
    const resolve = pendingInput;
    pendingInput = undefined;
    resolve?.(command.reply);
  } else if (command.type === "resize") {
    size = { rows: command.rows, columns: command.columns };
  } else if (command.type === "start" && !started) {
    started = true;
    void start(command.request);
  }
};

async function start(request: PythonRequest): Promise<void> {
  try {
    if (request.interactive && !("Suspending" in WebAssembly)) {
      throw Error(
        "Interactive input needs browser support for WebAssembly JSPI. Use a browser with JSPI support, or select Prefilled input to run a script.",
      );
    }
    size = { rows: request.rows ?? 18, columns: request.columns ?? 80 };
    const base = new URL("./", import.meta.url).href;
    const { loadPyodide } = (await import(
      /* @vite-ignore */ `${base}pyodide.mjs`
    )) as typeof import("pyodide");
    const python = await loadPyodide({
      indexURL: base,
      packageBaseUrl: base,
      enableRunUntilComplete: !!request.interactive,
      stdout: () => {},
      stderr: () => {},
    });
    send({ type: "running" });
    if (request.operation) {
      const result = await analyzePython(python, request, async (name) => {
        const response = await fetch(new URL(name, base));
        if (!response.ok)
          throw Error(`Could not load Python tool asset: ${name}`);
        return new Uint8Array(await response.arrayBuffer());
      });
      send({ type: "tool-result", result });
      return;
    }
    const terminal = request.interactive
      ? {
          size: () => size,
          readLine: (kind: "repl" | "stdin") =>
            new Promise<PythonInputReply>((resolve) => {
              pendingInput = resolve;
              send({ type: "input-needed", kind });
            }),
        }
      : undefined;
    const report = await executePython(
      python,
      request,
      (text) => send({ type: "output", text }),
      terminal,
    );
    send({ type: "complete", report });
  } catch (error) {
    send({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
