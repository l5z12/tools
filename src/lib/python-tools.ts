// SPDX-License-Identifier: AGPL-3.0-only
import type { Workbench } from "./tool-types";
import { pythonAnalysisTools } from "./python-analysis-tools";

export const pythonTools: Workbench[] = [
  ...pythonAnalysisTools,
  {
    id: "python-runner",
    name: "Python runner",
    description:
      "Run Python locally with a console, standard input and WebAssembly.",
    group: "Developer",
    tags: ["developer", "python", "playground"],
    keywords: ["pyodide", "cpython", "wasm", "code", "interpreter", "scripts"],
    sample: `import json
from collections import Counter

words = "small tools useful tools local tools".split()
print(json.dumps(Counter(words), indent=2))

# The final expression is displayed too.
sum(range(101))`,
    option: "",
    optionLabel: "",
    inputMode: "optional-file",
    accept: ".py,text/x-python,text/plain",
    help: "Run a script or start a Python REPL with persistent variables. The interactive terminal supports line input, ANSI output, ↑/↓ history, Ctrl+D for EOF and Ctrl+C (interrupts a prompt; stops and resets busy code). Waiting for input does not use the time limit. Interactive input requires WebAssembly JSPI. Includes the bundled standard library, without automatic package installs. Python and the terminal load on first use.",
    fields: [
      {
        key: "mode",
        label: "Mode",
        choices: ["Script", "Interactive REPL"],
        value: "Script",
      },
      {
        key: "inputMode",
        label: "Input mode",
        choices: ["Interactive terminal", "Prefilled input"],
        value: "Interactive terminal",
      },
      {
        key: "stdin",
        label: "Standard input (one line per input() call)",
        type: "textarea",
        value: "",
      },
      {
        key: "seconds",
        label: "Execution time limit (seconds)",
        choices: ["10", "30", "60", "120"],
        value: "30",
      },
    ],
  },
];
export const pythonIds = new Set(pythonTools.map((tool) => tool.id));
