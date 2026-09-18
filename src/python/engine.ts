// SPDX-License-Identifier: AGPL-3.0-only
import type { PyodideAPI } from "pyodide";
import { terminalSetup, replProgram } from "./terminal-python";
import {
  PYTHON_TEXT_LIMIT,
  type PythonReport,
  type PythonRequest,
  type PythonInputReply,
} from "./protocol";

/** Run in a disposable interpreter; never reuse user-modified modules or globals. */
export async function executePython(
  python: PyodideAPI,
  request: PythonRequest,
  emit: (text: string) => void,
  terminal?: {
    readLine: (kind: "repl" | "stdin") => Promise<PythonInputReply>;
    size: () => { rows: number; columns: number };
  },
): Promise<PythonReport> {
  let text = "";
  let pending = "";
  let truncated = false;
  let lastFlush = -Infinity;
  let pendingFlush: ReturnType<typeof setTimeout> | undefined;
  const flush = () => {
    clearTimeout(pendingFlush);
    pendingFlush = undefined;
    if (pending) emit(pending);
    pending = "";
    lastFlush = performance.now();
  };
  const append = (chunk: string) => {
    if (truncated) return;
    const remaining = PYTHON_TEXT_LIMIT - text.length;
    const accepted = chunk.slice(0, remaining);
    text += accepted;
    pending += accepted;
    if (chunk.length > remaining) {
      const notice = "\n[Console output truncated at 65,536 characters.]\n";
      text += notice;
      pending += notice;
      truncated = true;
    }
    if (pending.length >= 1024 || performance.now() - lastFlush > 40) flush();
    else if (pending && pendingFlush === undefined)
      pendingFlush = setTimeout(flush, 40);
  };
  // write() preserves prompts, partial lines and UTF-8 characters without
  // inventing line breaks. Separate decoders keep each stream's bytes intact.
  const stdout = new TextDecoder();
  const stderr = new TextDecoder();
  const writer = (decoder: TextDecoder) => (bytes: Uint8Array) => {
    append(decoder.decode(bytes, { stream: true }));
    return bytes.length;
  };
  const terminalOptions = {
    isatty: !!terminal,
    getTerminalSize: terminal?.size,
  };
  python.setStdout({ write: writer(stdout), ...terminalOptions });
  python.setStderr({ write: writer(stderr), ...terminalOptions });
  const lines = request.stdin.replace(/\r\n?/g, "\n").split("\n");
  // A trailing newline ends the last line; it does not create another input.
  if (lines.at(-1) === "") lines.pop();
  let inputIndex = 0;
  python.setStdin({ stdin: () => lines[inputIndex++] ?? null });
  const globals = python.runPython("dict(__name__='__main__')");
  const evaluator = python.runPython("dict()");
  evaluator.set("source", request.code);
  evaluator.set("namespace", globals);
  const started = performance.now();
  let failed = false;
  try {
    if (terminal) {
      python.registerJsModule("_tools_terminal", {
        read_line: async (kind: "repl" | "stdin") => {
          flush();
          const reply = await terminal.readLine(kind);
          // The UI echoes input immediately. Include it in the transcript
          // without sending a duplicate echo to the screen.
          const echo = reply.interrupt
            ? "^C\n"
            : reply.eof
              ? "^D\n"
              : reply.line + "\n";
          text += echo.slice(0, Math.max(0, PYTHON_TEXT_LIMIT - text.length));
          return reply;
        },
      });
      python.runPython(terminalSetup, { globals: evaluator });
    }
    // Format inside Python before crossing the JS boundary: otherwise values
    // such as 1.0 lose their Python type during automatic JS conversion.
    const representation = await python.runPythonAsync(
      request.repl
        ? replProgram
        : `from pyodide.code import eval_code_async
value = await eval_code_async(source, globals=namespace, filename="main.py")
repr(value) if value is not None else None`,
      { globals: evaluator },
    );
    if (representation !== undefined) append(representation + "\n");
  } catch (error) {
    failed = true;
    const message = error instanceof Error ? error.message : String(error);
    // Keep the traceback even when stdout has filled its own preview budget.
    flush();
    const traceback = "\n" + message.slice(0, 16384);
    text += traceback;
    emit(traceback);
  } finally {
    append(stdout.decode());
    append(stderr.decode());
    flush();
    globals.destroy();
    evaluator.destroy();
    if (terminal) python.unregisterJsModule("_tools_terminal");
  }
  return { text, failed, elapsed: performance.now() - started };
}
