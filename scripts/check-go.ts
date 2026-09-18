// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Window } from "happy-dom";
import { loadGoEngine } from "../src/go/engine";
import { configureGo, runGo, cancelGo } from "../src/go/runtime";
import { goTools } from "../src/lib/go-tools";
import type { SuiteOptions } from "../src/workbench-types";

const engine = await loadGoEngine(
  pathToFileURL(resolve("public/go/wasm_exec.js")).href,
  await Bun.file("public/go/tools.wasm").arrayBuffer(),
);
const run = (id: string, input: string, options: SuiteOptions = {}) =>
  engine.run(id, new TextEncoder().encode(input), options);
const data = (id: string, input: string, options: SuiteOptions = {}) =>
  run(id, input, options).data as Record<string, any>;

for (const tool of goTools) {
  if (tool.inputMode === "file") continue;
  const options = Object.fromEntries(
    tool.fields.map((field) => [field.key, field.value ?? ""]),
  );
  assert.ok(run(tool.id, tool.sample, options).kind, tool.id);
}

assert.equal(
  run("go-format", "package main;func main(){println(42)}").text,
  "package main\n\nfunc main() { println(42) }\n",
);
assert.throws(() => run("go-format", "package main\nfunc broken( {"));
const formatted = run(
  "go-format",
  'package main\nimport("strings";"fmt")\n',
).text!;
assert.ok(formatted.indexOf('"fmt"') < formatted.indexOf('"strings"'));
const source = data(
  "go-source",
  "package p\ntype Box[T any] struct { Value T }\nfunc (b Box[T]) Get() T { return b.Value }",
);
assert.equal(source.declarations[1].kind, "method");
assert.match(source.declarations[1].signature, /Box\[T\]/);
assert.equal(data("go-ast", "package p\nvar x = 1 + 2").kind, "File");
assert.throws(() => run("go-source", "var x ="));

const manifest =
  "module example.com/app\ngo 1.24.0\nrequire example.com/lib v1.2.3 // indirect\nreplace example.com/lib => ../lib\n";
const mod = data("go-mod", manifest);
assert.equal(mod.require[0].indirect, true);
assert.equal(mod.replace[0].new.Path, "../lib");
assert.match(
  run("go-mod", manifest, { action: "Format" }).text!,
  /module example.com\/app/,
);
assert.deepEqual(data("go-work", "go 1.24.0\nuse (\n ./a\n ./b\n)\n").use, [
  "./a",
  "./b",
]);
assert.throws(() =>
  run("go-mod", "module example.com/app\nrequire example.com/lib wrong\n"),
);
assert.throws(() => run("go-work", "use ("));
const sum = "example.com/a v1.0.0 h1:" + Buffer.alloc(32).toString("base64");
assert.equal(run("go-sum", `${sum}\n${sum}`).rows![1].duplicate, true);
assert.throws(
  () =>
    run(
      "go-sum",
      `${sum}\nexample.com/a v1.0.0 h1:${Buffer.alloc(32, 1).toString("base64")}`,
    ),
  /conflicting/,
);
assert.throws(() => run("go-sum", "example.com/a v1.0.0 h1:abcd"));
const pseudo = run(
  "go-module-version",
  "v0.0.0-20240102150405-abcdef123456\n1.0.0",
).rows!;
assert.equal(pseudo[0].timestamp, "2024-01-02T15:04:05Z");
assert.equal(pseudo[0].revision, "abcdef123456");
assert.equal(pseudo[1].valid, false);

const tags = data("go-build-tags", "linux && amd64 && !cgo", {
  tags: "linux amd64",
});
assert.equal(tags.matches, true);
assert.equal(tags.tags.length, 3);
assert.equal(
  data("go-build-tags", "linux && amd64", { tags: "windows amd64" }).matches,
  false,
);
assert.equal(
  data("go-build-tags", "// +build linux darwin", { tags: "darwin" }).matches,
  true,
);
assert.throws(() => run("go-build-tags", "linux &&"));
assert.throws(
  () => run("go-build-tags", "linux", { tags: "x".repeat(65537) }),
  /64 KiB/,
);

const events = [
  { Action: "run", Package: "p", Test: "TestA" },
  { Action: "fail", Package: "p", Test: "TestA", Elapsed: 0.1 },
  { Action: "run", Package: "p", Test: "TestA" },
  { Action: "pass", Package: "p", Test: "TestA", Elapsed: 0.2 },
  { Action: "fail", Package: "p", Elapsed: 0.3 },
]
  .map((event) => JSON.stringify(event))
  .join("\n");
const tests = run("go-test-results", events);
assert.equal(JSON.parse(tests.text!).rows.length, 3);
assert.equal(tests.rows!.length, 3);
assert.deepEqual(
  tests.rows!.map((row) => row.status),
  ["fail", "pass", "fail"],
);
assert.equal((tests.data as any).summary.failedTests, 1);
assert.equal((tests.data as any).summary.failedPackages, 1);
assert.equal(
  data("go-test-results", '{"Package":"p","Action":"run","Test":"TestPending"}')
    .incomplete,
  1,
);
assert.throws(() => run("go-test-results", events + "\nbroken"));
assert.equal(
  data(
    "go-test-results",
    '{"ImportPath":"example.com/broken","Action":"build-fail"}',
  ).summary.failedPackages,
  1,
);

const coverage = data(
  "go-coverage",
  "mode: count\np.go:1.1,2.2 2 0\np.go:1.1,2.2 2 1\np.go:3.1,4.2 1 0\n",
);
assert.equal(coverage.statements, 3);
assert.equal(coverage.covered, 2);
assert.equal(coverage.blocks.length, 2);
assert.equal(coverage.coveragePercent, 200 / 3);
assert.equal(data("go-coverage", "mode: set\n").coveragePercent, null);
assert.throws(() => run("go-coverage", "mode: nope\np.go:1.1,2.2 1 1"));
assert.throws(() => run("go-coverage", "mode: count\np.go:2.1,1.2 1 1"));
assert.throws(() =>
  run("go-coverage", "mode: count\np.go:1.1,2.2 1 999999999999999999"),
);
const benchmark = run(
  "go-benchmarks",
  "pkg: p\nBenchmarkA-8 100 10 ns/op 2 B/op\nBenchmarkA-8 100 30 ns/op 4 B/op\npkg: q\nBenchmarkA-8 100 100 ns/op",
);
assert.equal(
  benchmark.rows!.find((row) => row.unit === "ns/op" && row.samples === 2)
    ?.median,
  20,
);
assert.equal(benchmark.rows!.length, 3);
assert.throws(() => run("go-benchmarks", "BenchmarkA 100 NaN ns/op"));
assert.throws(() => run("go-benchmarks", "BenchmarkA 100 1 ns/op 2 ns/op"));
assert.throws(() => run("go-build-info", "not an executable"));
assert.throws(
  () => engine.run("go-format", new Uint8Array([0xff]), {}),
  /UTF-8/,
);
assert.throws(() => run("go-format", " ".repeat(2 * 1024 * 1024 + 1)), /2 MiB/);

// Inspect an actual Go-built executable; reading metadata never executes it.
await mkdir("work/go-tests", { recursive: true });
await Bun.write(
  "work/go-tests/main.go",
  'package main\nfunc main() { println("hello") }\n',
);
const fixture = Bun.spawn(["go", "build", "-o", "fixture.exe", "main.go"], {
  cwd: "work/go-tests",
  env: {
    ...process.env,
    GOTOOLCHAIN: "local",
    GOOS: "windows",
    GOARCH: "amd64",
    CGO_ENABLED: "0",
  },
  stdout: "inherit",
  stderr: "inherit",
});
assert.equal(await fixture.exited, 0);
const buildInfo = engine.run(
  "go-build-info",
  new Uint8Array(await readFile("work/go-tests/fixture.exe")),
  {},
).data as any;
assert.match(buildInfo.GoVersion, /^go1\./);
assert.ok(
  buildInfo.Settings.some(
    (setting: any) => setting.Key === "GOOS" && setting.Value === "windows",
  ),
);

// Exercise lifecycle cleanup without loading another runtime in a worker.
const window = new Window();
const container = window.document.createElement("div");
const savedGlobals = {
  document: globalThis.document,
  location: globalThis.location,
  Worker: globalThis.Worker,
};
let workerStopped = false;
let respond = false;
class TestWorker {
  onmessage?: (event: { data: unknown }) => void;
  postMessage() {
    if (respond)
      queueMicrotask(() =>
        this.onmessage?.({
          data: {
            type: "result",
            result: { kind: "code", text: "ok" },
            version: "test",
          },
        }),
      );
  }
  terminate() {
    workerStopped = true;
  }
}
Object.assign(globalThis, {
  document: window.document,
  location: { href: "http://localhost/" },
  Worker: TestWorker,
});
try {
  configureGo(container as unknown as HTMLElement);
  const pending = runGo(
    "go-format",
    "package p",
    undefined,
    {},
    container as unknown as HTMLElement,
  );
  cancelGo();
  await assert.rejects(pending, /Go stopped/);
  assert.equal(workerStopped, true);
  assert.equal(container.querySelector("button")!.disabled, true);
  respond = true;
  workerStopped = false;
  assert.equal(
    (
      await runGo(
        "go-format",
        "package p",
        undefined,
        {},
        container as unknown as HTMLElement,
      )
    ).text,
    "ok",
  );
  assert.equal(workerStopped, true);
  cancelGo();
} finally {
  Object.assign(globalThis, savedGlobals);
  await window.happyDOM.close();
}
console.log(
  `Passed ${goTools.length} Go tools, real WASM execution, malformed inputs, report edge cases, and executable metadata (${engine.version}).`,
);
