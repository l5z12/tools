// SPDX-License-Identifier: AGPL-3.0-only
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import type { PythonInputReply } from "./protocol";

export function createTerminal(
  container: HTMLElement,
  send: (reply: PythonInputReply) => void,
  interrupt: () => void,
  resize: (columns: number, rows: number) => void,
) {
  const screen = document.createElement("div");
  screen.className = "python-terminal-screen";
  const row = document.createElement("div");
  row.className = "python-terminal-input";
  const input = document.createElement("input");
  input.type = "text";
  input.setAttribute("aria-label", "Python input line");
  input.placeholder = "Waiting for Python…";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.maxLength = 16384;
  const submit = document.createElement("button");
  submit.type = "button";
  submit.textContent = "Send";
  const eof = document.createElement("button");
  eof.type = "button";
  eof.textContent = "EOF";
  eof.title = "End input (Ctrl+D)";
  const clear = document.createElement("button");
  clear.type = "button";
  clear.textContent = "Clear terminal";
  const interruptButton = document.createElement("button");
  interruptButton.type = "button";
  interruptButton.textContent = "Interrupt";
  interruptButton.title = "Interrupt input or stop busy code (Ctrl+C)";
  row.append(input, submit, eof);
  container.replaceChildren(screen, row, interruptButton, clear);
  const terminal = new Terminal({
    convertEol: true,
    disableStdin: true,
    screenReaderMode: true,
    rows: 18,
    scrollback: 2000,
    fontSize: 14,
    fontFamily: '"Cascadia Code", "Courier New", monospace',
    theme: { background: "#111111", foreground: "#dddddd" },
  });
  const fit = new FitAddon();
  terminal.loadAddon(fit);
  terminal.open(screen);
  // Output cannot change the clipboard or create clickable escape-sequence links.
  terminal.parser.registerOscHandler(8, () => true);
  terminal.parser.registerOscHandler(52, () => true);
  const observer = new ResizeObserver(() => {
    fit.fit();
  });
  observer.observe(screen);
  fit.fit();
  terminal.onResize(({ cols, rows }) => resize(cols, rows));
  let waiting = false;
  let history: string[] = [];
  let historyIndex = 0;
  let draft = "";
  const enable = (value: boolean) => {
    waiting = value;
    // Keep keyboard focus during execution so Ctrl+C can stop busy code.
    input.readOnly = !value;
    submit.disabled = eof.disabled = !value;
    input.placeholder = value
      ? "Type a line and press Enter"
      : "Waiting for Python…";
    if (value) input.focus();
  };
  const respond = (isEOF = false) => {
    if (!waiting) return;
    const line = input.value;
    if (!isEOF && line) {
      history.push(line);
      history = history.slice(-100);
    }
    historyIndex = history.length;
    input.value = "";
    draft = "";
    terminal.writeln(isEOF ? "^D" : line.replace(/[\x00-\x1f\x7f-\x9f]/g, ""));
    enable(false);
    send({ line: isEOF ? "" : line, eof: isEOF, interrupt: false });
  };
  submit.onclick = () => respond();
  eof.onclick = () => respond(true);
  clear.onclick = () => terminal.clear();
  const interruptSession = () => {
    terminal.writeln("^C");
    if (waiting) {
      input.value = "";
      enable(false);
      send({ line: "", eof: false, interrupt: true });
    } else interrupt();
  };
  interruptButton.onclick = interruptSession;
  input.onkeydown = (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      respond();
    }
    if (event.ctrlKey && event.key.toLowerCase() === "d") {
      event.preventDefault();
      respond(true);
    }
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      if (historyIndex === history.length) draft = input.value;
      historyIndex = Math.max(
        0,
        Math.min(
          history.length,
          historyIndex + (event.key === "ArrowUp" ? -1 : 1),
        ),
      );
      input.value = history[historyIndex] ?? draft;
    }
  };
  container.onkeydown = (event) => {
    event.stopPropagation();
    if (
      event.ctrlKey &&
      event.key.toLowerCase() === "c" &&
      input.selectionStart === input.selectionEnd &&
      !terminal.hasSelection()
    ) {
      event.preventDefault();
      interruptSession();
    }
  };
  // Typing here must not invalidate and cancel the toolbox request.
  container.oninput = container.onchange = (event) => event.stopPropagation();
  enable(false);
  return {
    write: (text: string) => terminal.write(text),
    requestInput: () => enable(true),
    finish: () => {
      enable(false);
      input.disabled = true;
      interruptButton.disabled = true;
    },
    size: () => ({ columns: terminal.cols, rows: terminal.rows }),
    dispose: () => {
      observer.disconnect();
      terminal.dispose();
      container.onkeydown = container.oninput = container.onchange = null;
      container.replaceChildren();
    },
  };
}
