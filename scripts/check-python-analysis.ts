// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { loadPyodide } from "pyodide";
import { analyzePython } from "../src/python/analysis";
import { pythonAnalysisTools } from "../src/lib/python-analysis-tools";
import type { SuiteOptions } from "../src/workbench-types";

const python = await loadPyodide({
  indexURL: "node_modules/pyodide/",
  enableRunUntilComplete: false,
});
const assets: string[] = [];
const run = (operation: string, code: string, options: SuiteOptions = {}) =>
  analyzePython(
    python,
    { operation, code, stdin: "", options },
    async (name) => {
      assets.push(name);
      return new Uint8Array(
        await Bun.file(`public/python/${name}`).arrayBuffer(),
      );
    },
  );
for (const tool of pythonAnalysisTools) {
  const options = Object.fromEntries(
    tool.fields.map((field) => [
      field.key,
      field.type === "checkbox"
        ? field.value === "true"
        : (field.value ?? field.choices?.[0] ?? ""),
    ]),
  );
  const result = await run(tool.id, tool.sample, options);
  assert.ok(result.kind, tool.id);
  assert.ok(result.text, tool.id);
}
const formatted = await run("python-format", "# keep this\nx=  1+2\n");
assert.match(formatted.text!, /# keep this\nx = 1\+2/);
assert.deepEqual(await run("python-format", formatted.text!), formatted);
const style = await run("python-style", "x=1\n");
assert.ok(style.rows?.some((row) => row.rule === "E225"));
assert.equal((await run("python-style", "x = 1\n")).rows?.length, 0);
const invalid = await run("python-syntax", "return 1\n");
assert.equal((invalid.data as { valid: boolean }).valid, false);
assert.match(String(invalid.rows?.[0].message), /outside function/);
const emptySyntax = await run("python-syntax", "");
assert.equal((emptySyntax.data as { valid: boolean }).valid, true);
const ast = await run("python-ast", "x = b'abc'\ny = 2j\n", {
  locations: false,
});
assert.match(ast.text!, /pythonType/);
assert.doesNotMatch(ast.text!, /lineno/);
const tokens = await run("python-tokens", "x = 1 # comment\n", {
  comments: false,
});
assert.ok(
  tokens.rows?.every((row) => row.type !== "COMMENT" && row.type !== "NEWLINE"),
);
const imports = await run(
  "python-imports",
  "import os as system\nfrom .local import thing\nimport unknown_package\n",
);
assert.deepEqual(
  imports.rows?.map((row) => row.classification),
  ["standard library", "relative", "external or local"],
);
const outline = await run(
  "python-outline",
  'class A:\n    """Class docs."""\n    def f(self, x: int = 2) -> int:\n        """Method docs."""\n        return x\n',
);
assert.equal(outline.rows?.[1].name, "A.f");
assert.equal(outline.rows?.[1].docstring, "Method docs.");
const metrics = await run(
  "python-metrics",
  "def outer(x):\n    def inner(y):\n        if y: return 1\n    if x and x > 2:\n        return x\n    return 0\n",
);
assert.equal(metrics.rows?.[0].branchEstimate, 3);
assert.equal(metrics.rows?.[1].branchEstimate, 2);
const bytecode = await run("python-bytecode", "def value():\n    return 42\n");
assert.ok(bytecode.rows?.some((row) => row.scope === "value"));
assert.equal(
  (await run("python-literal-json", "{'a': (1, None, True)}")).text,
  '{\n  "a": [\n    1,\n    null,\n    true\n  ]\n}',
);
for (const literal of [
  "{1: 'one'}",
  "{1, 2}",
  "b'abc'",
  "float('nan')",
  "__import__('os').system('anything')",
]) {
  await assert.rejects(run("python-literal-json", literal));
}
const largeInteger = "123456789012345678901234567890";
assert.match(
  (await run("json-python-literal", `{"id":${largeInteger},"active":true}`))
    .text!,
  new RegExp(largeInteger),
);
await assert.rejects(run("json-python-literal", "NaN"));
await assert.rejects(run("json-python-literal", "1e999"));
assert.equal(
  (await run("python-literal-json", "  (1, 2)  ")).text,
  "[\n  1,\n  2\n]",
);
const largeAst = await run("python-ast", `x = ${largeInteger}`);
assert.match(largeAst.text!, new RegExp(largeInteger));
assert.match(largeAst.text!, /representation/);
const regex = await run("python-regex", "🌍Ada: 42", {
  pattern: "(?P<name>Ada): (\\d+)",
});
assert.equal(regex.rows?.[0].start, 1);
assert.deepEqual(regex.rows?.[0].namedGroups, { name: "Ada" });
assert.equal(
  (
    await run("python-regex", "Ab", {
      pattern: "a",
      flags: "i",
      action: "Replace",
      replacement: "z",
    })
  ).text,
  "zb",
);
await assert.rejects(run("python-regex", "", { pattern: "[" }));
assert.equal(
  (await run("python-regex", "x".repeat(1001), { pattern: "x" })).rows?.length,
  1000,
);

// Compilation and every source inspector must leave this side effect unexecuted.
const sentinel =
  "raise RuntimeError('DO NOT EXECUTE')\nopen('/analysis-side-effect', 'w').write('bad')\n";
for (const operation of [
  "python-syntax",
  "python-format",
  "python-style",
  "python-ast",
  "python-tokens",
  "python-imports",
  "python-outline",
  "python-metrics",
  "python-bytecode",
])
  await run(operation, sentinel);
assert.equal(python.FS.analyzePath("/analysis-side-effect").exists, false);
assets.length = 0;
await run("python-syntax", "pass");
assert.deepEqual(
  assets,
  ["analysis.py"],
  "Analyzers must not fetch formatter dependencies.",
);
await assert.rejects(run("python-ast", "x=1\n".repeat(3000)), /10,000/);
console.log(
  `Python analysis: ${pythonAnalysisTools.length} tools, formatting semantics, diagnostics, conversions, regex and non-execution checks passed.`,
);
