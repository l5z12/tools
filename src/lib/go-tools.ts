// SPDX-License-Identifier: AGPL-3.0-only
import type { Field, Workbench } from "./tool-types";

const source = `package example

import "fmt"

type Counter struct { Value int }

func (c *Counter) Add(n int) { c.Value += n }

func Hello(name string) string { return fmt.Sprintf("Hello, %s!", name) }
`;
const manifestAction: Field = {
  key: "action",
  label: "Action",
  choices: ["Inspect", "Format"],
  value: "Inspect",
};
function tool(
  id: string,
  name: string,
  description: string,
  sample: string,
  extra: Partial<Workbench> = {},
): Workbench {
  return {
    id,
    name,
    description,
    sample,
    group: "Developer",
    tags: ["go", "developer", "wasm"],
    keywords: ["golang", "toolchain"],
    option: "",
    optionLabel: "",
    fields: [],
    inputMode: "optional-file",
    accept: ".go,.txt,text/plain",
    help: "Runs locally. Go WebAssembly loads on first use. Text limit: 2 MiB; 30 seconds per run.",
    ...extra,
  };
}

export const goTools: Workbench[] = [
  tool(
    "go-format",
    "Go formatter",
    "Format Go source and fragments with gofmt’s formatter.",
    source,
    { tags: ["go", "developer", "formatters", "wasm"] },
  ),
  tool(
    "go-source",
    "Go source inspector",
    "Check syntax and explore packages, imports, declarations, and method signatures.",
    source,
    {
      help: "Syntax analysis with Go’s parser; does not resolve imports, check types, or execute code. Text limit: 2 MiB.",
    },
  ),
  tool(
    "go-ast",
    "Go syntax tree",
    "Explore Go’s abstract syntax tree with source positions and token values.",
    source,
    {
      help: "Expand AST nodes to inspect expressions and declarations. Limit: 20,000 nodes, 128 levels, and 2 MiB source.",
    },
  ),
  tool(
    "go-mod",
    "go.mod inspector & formatter",
    "Inspect module requirements, replacements, exclusions, retractions, and toolchain versions.",
    `module example.com/app\n\ngo 1.24.0\n\nrequire golang.org/x/text v0.23.0 // indirect\n\nreplace example.com/local => ../local\n`,
    {
      fields: [manifestAction],
      accept: ".mod,.txt",
      tags: ["go", "developer", "dependencies", "formatters"],
    },
  ),
  tool(
    "go-work",
    "go.work inspector & formatter",
    "Inspect or format a Go workspace and its local module replacements.",
    `go 1.24.0\n\nuse (\n ./app\n ./shared\n)\n`,
    {
      fields: [manifestAction],
      accept: ".work,.txt",
      tags: ["go", "developer", "dependencies", "formatters"],
    },
  ),
  tool(
    "go-sum",
    "go.sum inspector",
    "Read checksum entries and detect malformed, duplicate, or conflicting records.",
    "example.com/demo v1.0.0 h1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=\nexample.com/demo v1.0.0/go.mod h1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=\n",
    {
      accept: ".sum,.txt",
      tags: ["go", "developer", "checksums", "dependencies"],
      help: "Validates entry structure and h1 encoding. Does not fetch modules or verify their contents against these hashes. Text limit: 2 MiB.",
    },
  ),
  tool(
    "go-test-results",
    "Go test report",
    "Explore go test -json results, failures, skipped tests, durations, and captured output.",
    `{"Action":"start","Package":"example.com/app"}\n{"Action":"run","Package":"example.com/app","Test":"TestAdd"}\n{"Action":"output","Package":"example.com/app","Test":"TestAdd","Output":"=== RUN   TestAdd\\n"}\n{"Action":"pass","Package":"example.com/app","Test":"TestAdd","Elapsed":0.002}\n{"Action":"pass","Package":"example.com/app","Elapsed":0.01}\n`,
    {
      accept: ".json,.jsonl,.txt",
      tags: ["go", "developer", "testing", "json"],
      help: "Reads existing go test -json output; does not run tests. Limit: 30,000 events, 2 MiB input, and 128 KiB captured output.",
    },
  ),
  tool(
    "go-coverage",
    "Go coverage report",
    "Calculate statement coverage by file and inspect covered or missed source blocks.",
    "mode: count\nexample.com/app/main.go:3.20,5.2 2 10\nexample.com/app/main.go:7.20,9.2 1 0\n",
    {
      accept: ".out,.cover,.txt",
      tags: ["go", "developer", "testing", "analysis"],
      help: "Reads go test -coverprofile output. Duplicate locations are merged before coverage is calculated. Limit: 20,000 blocks and 2 MiB.",
    },
  ),
  tool(
    "go-benchmarks",
    "Go benchmark report",
    "Summarize repeated benchmark measurements with minimum, median, and maximum values.",
    "goos: linux\ngoarch: amd64\npkg: example.com/app\nBenchmarkEncode-8 1000000 120 ns/op 32 B/op 1 allocs/op\nBenchmarkEncode-8 1000000 110 ns/op 32 B/op 1 allocs/op\n",
    {
      accept: ".txt,.bench",
      tags: ["go", "developer", "performance", "testing"],
      help: "Paste go test -bench . -benchmem output. Keeps benchmark names, units, and context separate; reports descriptive statistics, not significance tests.",
    },
  ),
  tool(
    "go-build-tags",
    "Go build constraint evaluator",
    "Evaluate go:build expressions and convert them to legacy +build constraints.",
    "//go:build (linux || darwin) && amd64 && !cgo",
    {
      fields: [
        {
          key: "tags",
          label: "Enabled tags (spaces or commas)",
          value: "linux amd64 unix go1.24",
        },
      ],
      help: "Supply every enabled tag explicitly, including OS, architecture, release tags, and cgo. Evaluates the expression only; filename constraints and implied platform tags are not added.",
    },
  ),
  tool(
    "go-module-version",
    "Go module version inspector",
    "Decode semantic and pseudo-versions, including commit revisions and timestamps.",
    "v1.2.3\nv2.0.0-rc.1\nv0.0.0-20240102150405-abcdef123456\nv1.2.3+incompatible",
    { tags: ["go", "developer", "dependencies", "converters"] },
  ),
  tool(
    "go-build-info",
    "Go binary build information",
    "Read embedded Go versions, dependencies, replacements, and build settings from an executable.",
    "",
    {
      inputMode: "file",
      accept: "",
      tags: ["go", "developer", "files", "analysis"],
      help: "Choose a Go executable up to 32 MiB (ELF, PE, Mach-O, Plan 9, or XCOFF). Reads embedded metadata without executing the file. Wasm binaries are not supported by Go’s build-info reader.",
    },
  ),
];

export const goIds = new Set(goTools.map((tool) => tool.id));
