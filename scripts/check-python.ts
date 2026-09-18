// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { loadPyodide } from "pyodide";
import { executePython } from "../src/python/engine";
import { pythonTools } from "../src/lib/python-tools";
import { Window } from "happy-dom";
import {
  configurePython,
  runPython,
  cancelPython,
} from "../src/python/runtime";

const python = await loadPyodide({
  indexURL: "node_modules/pyodide/",
  enableRunUntilComplete: false,
});
const run = async (code: string, stdin = "") => {
  const messages: string[] = [];
  const report = await executePython(python, { code, stdin }, (chunk) =>
    messages.push(chunk),
  );
  assert.equal(
    messages.join(""),
    report.text,
    "Live console must match the final output.",
  );
  return report;
};
const sample = await run(
  pythonTools.find((tool) => tool.id === "python-runner")!.sample,
);
assert.equal(sample.failed, false, sample.text);
assert.match(sample.text, /"tools": 3/);
assert.match(sample.text, /5050\n$/);
assert.equal(
  (await run('print("Hello 🌍", end=""); print("!")')).text,
  "Hello 🌍!\n",
);
assert.equal(
  (
    await run(
      'name = input("Name: "); print(name); print(input())',
      "Ada\nLovelace\n",
    )
  ).text,
  "Name: Ada\nLovelace\n",
);
assert.match((await run("input()", "")).text, /EOFError/);
assert.equal((await run("print(repr(input()))", "\n")).text, "''\n");
assert.equal(
  (await run('import sys; sys.stderr.write("problem\\n"); None')).text,
  "problem\n",
);
assert.match(
  (await run("import asyncio\nawait asyncio.sleep(0)\n[1, 2, 3]")).text,
  /\[1, 2, 3\]/,
);
assert.equal((await run("True")).text, "True\n");
assert.equal((await run("1.0")).text, "1.0\n");
assert.equal((await run("None")).text, "");
assert.equal((await run("(1, 'two')")).text, "(1, 'two')\n");
const failed = await run('print("before"); 1 / 0');
assert.equal(failed.failed, true);
assert.match(failed.text, /before[\s\S]+ZeroDivisionError/);
assert.match((await run("if :")).text, /SyntaxError/);
assert.equal((await run("print('x' * 100000)")).text.length < 66000, true);
const floodedError = await run(
  "print('x' * 100000)\nraise ValueError('still visible')",
);
assert.match(floodedError.text, /ValueError: still visible/);
await run("private_variable = 42");
assert.match((await run("private_variable")).text, /NameError/);
console.log(
  "Python WASM: sample, Unicode, streams, input/EOF, async, expressions, errors and output limits passed.",
);

// Selecting the tool or cancelling a pending file read must not start Python.
const window = new Window();
const originalDocument = globalThis.document;
const originalWorker = globalThis.Worker;
let createdWorkers = 0;
Object.assign(globalThis, {
  document: window.document,
  Worker: new Proxy(originalWorker, {
    construct() {
      createdWorkers++;
      throw Error("Interpreter must not load during this test.");
    },
  }),
});
try {
  const container = document.createElement("div");
  configurePython(container);
  assert.equal(createdWorkers, 0);
  await assert.rejects(runPython("", undefined, {}, container), /Enter Python/);
  await assert.rejects(
    runPython("pass", undefined, { seconds: 0 }, container),
    /time limit/,
  );
  const pendingFile = {
    size: 1,
    text: () => new Promise<string>(() => {}),
  } as File;
  const pending = runPython("", pendingFile, {}, container);
  cancelPython();
  await assert.rejects(pending, /Python stopped/);
  assert.equal(createdWorkers, 0);
  assert.equal(
    container.querySelector<HTMLButtonElement>("button")!.disabled,
    true,
  );
} finally {
  Object.assign(globalThis, {
    document: originalDocument,
    Worker: originalWorker,
  });
  await window.happyDOM.close();
}
console.log(
  "Python lazy loading, validation and cancellation-before-load passed.",
);
