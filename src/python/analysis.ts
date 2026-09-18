// SPDX-License-Identifier: AGPL-3.0-only
import type { PyodideAPI } from "pyodide";
import type { SuiteResult } from "../workbench-types";
import type { PythonRequest } from "./protocol";
import { pythonPackages } from "./packages";

export async function analyzePython(
  python: PyodideAPI,
  request: PythonRequest,
  readAsset: (name: string) => Promise<Uint8Array<ArrayBuffer>>,
): Promise<SuiteResult> {
  if (
    request.operation === "python-format" ||
    request.operation === "python-style"
  ) {
    for (const pkg of pythonPackages) {
      if (
        request.operation === "python-style" &&
        pkg.filename.startsWith("autopep8")
      )
        continue;
      python.unpackArchive(await readAsset(`packages/${pkg.filename}`), "zip", {
        extractDir: "/home/pyodide/tool-packages",
      });
    }
    python.runPython(
      "import sys\nsys.path.insert(0, '/home/pyodide/tool-packages')",
    );
  }
  const script = new TextDecoder().decode(await readAsset("analysis.py"));
  const scope = python.runPython("dict()");
  try {
    python.runPython(script, { globals: scope });
    scope.set(
      "request_json",
      JSON.stringify({
        operation: request.operation,
        source: request.code,
        options: request.options ?? {},
      }),
    );
    const encoded: string = python.runPython("run_request(request_json)", {
      globals: scope,
    });
    return JSON.parse(encoded);
  } finally {
    scope.destroy();
  }
}
