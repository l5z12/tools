// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { loadPyodide } from "pyodide";
import { executePython } from "../../src/python/engine";
import type { PythonInputReply } from "../../src/python/protocol";

assert.ok(
  "Suspending" in WebAssembly,
  "Run this test with Node's --experimental-wasm-jspi flag.",
);
const line = (value: string): PythonInputReply => ({
  line: value,
  eof: false,
  interrupt: false,
});
const eof: PythonInputReply = { line: "", eof: true, interrupt: false };
const interrupt: PythonInputReply = { line: "", eof: false, interrupt: true };

async function run(code: string, replies: PythonInputReply[], repl = false) {
  const python = await loadPyodide({
    indexURL: resolve("node_modules/pyodide"),
    enableRunUntilComplete: true,
  });
  const chunks: string[] = [];
  const kinds: string[] = [];
  const report = await executePython(
    python,
    { code, stdin: "", interactive: true, repl },
    (text) => chunks.push(text),
    {
      size: () => ({ rows: 24, columns: 100 }),
      readLine: async (kind) => {
        kinds.push(kind);
        await new Promise((resolve) => setTimeout(resolve, 5));
        assert.ok(replies.length, "Unexpected input request");
        return replies.shift()!;
      },
    },
  );
  assert.equal(replies.length, 0, "Every submitted line must be consumed");
  assert.equal(report.failed, false, report.text);
  return { output: chunks.join(""), transcript: report.text, kinds };
}

const script = await run(
  `import sys, os
assert sys.stdin.isatty() and sys.stdout.isatty()
assert os.get_terminal_size(1).columns == 100
print("hello", input("Name: "))
print("blank:", repr(input()))
print("bytes:", sys.stdin.buffer.read(4))
print("rest:", repr(sys.stdin.readline()))
print("remaining:", repr(sys.stdin.read()))`,
  [line("世界"), line(""), line("abcd"), line("tail"), eof],
);
assert.match(script.output, /hello 世界/);
assert.match(script.output, /blank: ''/);
assert.match(script.output, /bytes: b'abcd'/);
assert.match(script.output, /rest: '\\n'/);
assert.match(script.output, /remaining: 'tail\\n'/);
assert.match(script.transcript, /Name: 世界/);
assert.ok(script.kinds.every((kind) => kind === "stdin"));

const repl = await run(
  "",
  [
    line("x = 21"),
    line("x * 2"),
    line("for n in range(2):"),
    line("    print(n)"),
    line(""),
    line("input('Name: ')"),
    line("Ada"),
    line("1 / 0"),
    line("x"),
    line("if True:"),
    interrupt,
    line("x + 1"),
    eof,
  ],
  true,
);
assert.match(repl.output, /42/);
assert.match(repl.output, /0\n1\n/);
assert.match(repl.output, /'Ada'/);
assert.match(repl.output, /ZeroDivisionError/);
assert.match(repl.output, /KeyboardInterrupt/);
assert.match(repl.output, /22/);
assert.ok(repl.kinds.includes("stdin") && repl.kinds.includes("repl"));
console.log(
  "Interactive Python: asynchronous input, UTF-8, TTY streams, EOF, REPL state, multiline commands, errors and prompt interruption passed.",
);
