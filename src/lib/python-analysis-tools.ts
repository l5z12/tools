// SPDX-License-Identifier: AGPL-3.0-only
import type { Field, Workbench } from "./tool-types";

const source = `"""Example Python module."""
import math
from collections import Counter

def summarize(values: list[float]) -> dict:
    """Return a count and the square root of the sum."""
    if not values:
        return {"count": 0, "root": 0}
    return {"count": len(values), "root": math.sqrt(sum(values))}
`;
const width: Field = {
  key: "width",
  label: "Maximum line length (40–200)",
  type: "number",
  value: "88",
};
function tool(
  id: string,
  name: string,
  description: string,
  fields: Field[] = [],
  extra: Partial<Workbench> = {},
): Workbench {
  return {
    id,
    name,
    description,
    fields,
    sample: source,
    group: "Developer",
    tags: ["python", "developer", "analysis"],
    keywords: ["cpython", "source", "code", "pyodide"],
    option: "",
    optionLabel: "",
    inputMode: "optional-file",
    accept: ".py,text/plain",
    help: "Runs locally with Python 3.14. Python loads on first use. Source is inspected without executing it. Up to 1 MiB input and 10,000 syntax nodes; Stop cancels processing.",
    ...extra,
  };
}

export const pythonAnalysisTools: Workbench[] = [
  tool(
    "python-format",
    "Python formatter",
    "Format Python with autopep8 while retaining comments.",
    [width],
    {
      tags: ["python", "developer", "formatting"],
      sample:
        "# A small example\ndef greet( name ):\n    return {'hello':name,'count':1+2}\n",
    },
  ),
  tool(
    "python-style",
    "Python style checker",
    "Find PEP 8 issues with rule codes, line numbers and columns.",
    [width],
    { sample: "import os,sys\n\ndef greet( name ):\n return 'Hello '+name\n" },
  ),
  tool(
    "python-syntax",
    "Python syntax checker",
    "Check syntax and compile-time errors without running code.",
    [],
    { tags: ["python", "developer", "validation"] },
  ),
  tool(
    "python-ast",
    "Python AST viewer",
    "Explore a Python syntax tree as expandable structured data.",
    [
      {
        key: "locations",
        label: "Include source locations (UTF-8 byte column offsets)",
        type: "checkbox",
        value: "true",
      },
    ],
  ),
  tool(
    "python-tokens",
    "Python tokenizer",
    "Inspect tokens, exact token types and source positions.",
    [
      {
        key: "comments",
        label: "Include comments and layout tokens",
        type: "checkbox",
        value: "true",
      },
    ],
  ),
  tool(
    "python-imports",
    "Python import inspector",
    "List static imports, aliases and standard-library classification.",
    [],
    {
      help: "Inspects import statements without importing modules. Standard-library classification describes CPython, not which packages are available in this browser. Dynamic imports and dependencies of imported modules are not inferred.",
    },
  ),
  tool(
    "python-outline",
    "Python API outline",
    "Browse functions, classes, signatures, decorators and docstrings.",
  ),
  tool(
    "python-metrics",
    "Python code metrics",
    "Count lines, comments, definitions and per-function branch estimates.",
    [],
    {
      help: "Static metrics without executing source. Branch estimate starts at 1 and counts control-flow decisions, boolean alternatives, comprehensions and match cases, excluding nested functions. It is a heuristic, not a code-quality score.",
    },
  ),
  tool(
    "python-bytecode",
    "Python bytecode viewer",
    "Compile and inspect CPython instructions for modules and nested functions.",
    [
      {
        key: "optimize",
        label: "Optimization",
        choices: ["0", "1", "2"],
        value: "0",
      },
    ],
    {
      help: "Compiles source without running it. Instructions are specific to the bundled CPython 3.14 runtime. Optimization 1 removes assertions; 2 also removes docstrings. Preview includes at most 10,000 instructions.",
    },
  ),
  tool(
    "python-literal-json",
    "Python literal → JSON",
    "Convert Python literal dictionaries, lists and values to strict JSON.",
    [],
    {
      tags: ["python", "json", "converters"],
      sample:
        "{'name': 'Ada', 'active': True, 'missing': None, 'scores': (8, 9)}",
      help: "Parses literals without running expressions. Tuples become arrays. Dictionary keys must be strings; sets, bytes, complex values and non-finite numbers are rejected.",
    },
  ),
  tool(
    "json-python-literal",
    "JSON → Python literal",
    "Convert JSON to a readable Python literal with True, False and None.",
    [width],
    {
      tags: ["python", "json", "converters"],
      sample: '{"name":"Ada","active":true,"missing":null,"scores":[8,9]}',
      accept: ".json,text/plain,application/json",
      help: "Parses strict JSON locally. Object order and arbitrary-size integers are preserved. Produces a Python literal; no code is executed.",
    },
  ),
  tool(
    "python-regex",
    "Python regex tester",
    "Test Python re patterns, capture groups, substitutions and splitting.",
    [
      {
        key: "pattern",
        label: "Pattern",
        value: "(?P<name>[A-Za-z]+): (?P<score>\\d+)",
      },
      {
        key: "action",
        label: "Operation",
        choices: ["Find matches", "Replace", "Split"],
        value: "Find matches",
      },
      {
        key: "replacement",
        label: "Replacement (Python backreferences supported)",
        value: "\\g<name>=\\g<score>",
      },
      { key: "flags", label: "Flags (i m s x a)", value: "" },
    ],
    {
      tags: ["python", "regex", "text", "developer"],
      sample: "Ada: 42\nGrace: 99",
      accept: "text/*",
      help: "Uses Python's re engine. Positions are Unicode code-point offsets. At most 1,000 matches or splits and 1 MiB replacement output. A 30-second limit stops expensive patterns; Stop cancels immediately.",
    },
  ),
];
export const pythonAnalysisIds = new Set(
  pythonAnalysisTools.map((tool) => tool.id),
);
