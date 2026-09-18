// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import initCore, { suite_run } from "../public/wasm/l5z12_tools";
import initFormat, { format } from "@wasm-fmt/clang-format/web";
import { compileCpp, type CppRequest } from "../src/cpp/engine";
import { CapturedOutput, legacyImports, readCppSysroot } from "../src/cpp/wasi";
import { cppTools, cppRuntimeIds } from "../src/lib/cpp-tools";
import { File, OpenFile, WASI } from "@bjorn3/browser_wasi_shim";
import type { SuiteOptions, SuiteResult } from "../src/workbench-types";

await initCore({
  module_or_path: await readFile("public/wasm/l5z12_tools_bg.wasm"),
});
const run = (
  id: string,
  input: string,
  options: SuiteOptions = {},
  bytes = new Uint8Array(),
): SuiteResult =>
  JSON.parse(suite_run(id, input, bytes, JSON.stringify(options)));
for (const tool of cppTools) {
  if (cppRuntimeIds.has(tool.id)) continue;
  const options = Object.fromEntries(
    tool.fields.map((field) => [
      field.key,
      field.type === "checkbox" ? field.value === "true" : (field.value ?? ""),
    ]),
  );
  assert.ok(run(tool.id, tool.sample, options).kind, tool.id);
}
const symbols = run(
  "cpp-demangle",
  "_ZN3foo3barEi\n?func@@YAHH@Z\nordinary",
).rows!;
assert.equal(symbols[0].demangled, "foo::bar(int)");
assert.match(String(symbols[1].demangled), /func\(int\)/);
assert.equal(symbols[2].status, "not decoded");
assert.throws(() => run("cpp-demangle", "x".repeat(8193)));
const reports = run(
  "cpp-diagnostics",
  "C:\\src\\main.cpp:42:7: error: missing name\n  example();\nC:\\src\\other.cpp(10,2): warning C4101: unused variable",
).rows!;
assert.equal(reports.length, 2);
assert.equal(reports[0].file, "C:\\src\\main.cpp");
assert.equal(reports[1].code, "C4101");
assert.match(String(reports[0].context), /example\(\)/);
assert.throws(() => run("cpp-diagnostics", "not compiler output"));
const database = JSON.stringify([
  {
    directory: "/work",
    file: "a.cpp",
    arguments: [
      "clang++",
      "-I",
      "a b",
      "-DVALUE=1",
      "-std=c++17",
      "-c",
      "a.cpp",
    ],
  },
  { directory: "/work", file: "a.cpp", command: 'cl.exe /I"a b" a.cpp' },
  {
    directory: "C:\\work",
    file: "b.cpp",
    arguments: ["cl.exe", "/Iinclude", "/D", "WIN32", "/std:c++17", "b.cpp"],
  },
]);
const db = run("cpp-compilation-db", database);
const entries = (db.data as any).entries;
assert.equal(entries[0].flags.includePaths[0].path, "a b");
assert.equal(entries[0].flags.defines[0], "VALUE=1");
assert.equal(db.rows![1].anotherConfiguration, true);
assert.equal(entries[1].flags, undefined);
assert.equal(entries[2].flags.defines[0], "WIN32");
assert.throws(() =>
  run(
    "cpp-compilation-db",
    '[{"directory":"/a","file":"a.c","arguments":[42]}]',
  ),
);
assert.throws(() => run("cpp-compilation-db", "{}"));
const cache = "//Description\nKEY:STRING=a=b;c\nINTERNAL_VAR:INTERNAL=42\n";
assert.equal(run("cpp-cmake-cache", cache).rows!.length, 1);
assert.equal(run("cpp-cmake-cache", cache).rows![0].value, "a=b;c");
assert.equal(run("cpp-cmake-cache", cache, { internal: true }).rows!.length, 2);
assert.throws(() => run("cpp-cmake-cache", "broken=value"));
for (const name of [
  "int",
  "std",
  "NULL",
  "size_t",
  "_reserved",
  "x;evil",
  "x__y",
])
  assert.throws(() => run("cpp-byte-array", "a", { name }));
assert.match(
  run("cpp-byte-array", "", { name: "payload" }).text!,
  /payload_size = 0;/,
);
const cArray = run(
  "cpp-byte-array",
  "",
  { name: "payload", fileProvided: true, terminator: true, uppercase: true },
  new Uint8Array([0, 255, 128]),
).text!;
assert.match(cArray, /0x00, 0xFF, 0x80, 0x00/);

await initFormat(await Bun.file("public/cpp/clang-format.wasm").arrayBuffer());
const formatted = format("int main(){return 0;}", "main.cpp", "LLVM");
assert.match(formatted, /int main\(\) \{ return 0; \}/);
assert.equal(format(formatted, "main.cpp", "LLVM"), formatted);
{
  const write = process.stderr.write.bind(process.stderr);
  process.stderr.write = () => true;
  try {
    assert.throws(() => format("int x;", "main.cpp", "{NoSuchOption: true}"));
  } finally {
    process.stderr.write = write;
  }
}
assert.match(
  format(
    "int main(){\nreturn 0;\n}",
    "main.cpp",
    "{BasedOnStyle: LLVM, IndentWidth: 4, AllowShortFunctionsOnASingleLine: None}",
  ),
  /\n    return 0;/,
);

const clang = await WebAssembly.compile(
  await Bun.file("public/cpp/clang.wasm").arrayBuffer(),
);
const lld = await WebAssembly.compile(
  await Bun.file("public/cpp/lld.wasm").arrayBuffer(),
);
const sysroot = new Uint8Array(
  await Bun.file("public/cpp/sysroot.tar").arrayBuffer(),
);
const assets = { clang, sysroot, linker: async () => lld };
const compile = (source: string, options: Partial<CppRequest> = {}) =>
  compileCpp(
    assets,
    {
      source,
      standard: "c17",
      optimization: "0",
      mode: "run",
      stdin: "",
      ...options,
    },
    () => {},
  );
const c = await compile(
  '#include <stdio.h>\nint main(void){int a,b;if(scanf("%d %d",&a,&b)!=2)return 1;printf("sum=%d\\n",a+b);return 0;}',
  { stdin: "20 22\n" },
);
assert.match(c.text!, /sum=42/);
assert.match(c.text!, /Exit code: 0/);
assert.ok(WebAssembly.validate(c.mediaFiles![0].bytes));
const generated = await WebAssembly.compile(c.mediaFiles![0].bytes);
assert.ok(
  WebAssembly.Module.imports(generated).every(
    (entry) => entry.module === "wasi_unstable",
  ),
);
const wat = run(
  "wasm-disassemble",
  "",
  { fileProvided: true },
  c.mediaFiles![0].bytes,
).text!;
assert.match(wat, /\(memory[^\n]* 4096\)/);
assert.match(
  (
    await compile(
      "#include <iostream>\n#include <vector>\nint main(){std::vector<int> values{1,2,3};int sum=0;for(auto v:values)sum+=v;std::cout << sum;}",
      { standard: "c++17", optimization: "2" },
    )
  ).text!,
  /6\nExit code: 0/,
);
assert.match(
  (await compile("int broken( {", { mode: "check" })).text!,
  /error:/,
);
assert.match(
  (await compile("int square(int x){return x*x;}", { mode: "check" })).text!,
  /checks passed/,
);
assert.match(
  (await compile("#define N 42\nint n=N;", { mode: "preprocess" })).text!,
  /int n=42;/,
);
assert.match(
  (
    await compile("int square(int x){return x*x;}", {
      mode: "assembly",
      optimization: "2",
    })
  ).text!,
  /i32.mul/,
);
assert.ok(
  (await compile("int main(void){return 7;}", { mode: "compile" })).mediaFiles
    ?.length,
);
assert.match(
  (await compile("int main(void){return 7;}")).text!,
  /Exit code: 7/,
);
assert.match(
  (await compile("extern int missing(void);int main(void){return missing();}"))
    .text!,
  /undefined symbol/,
);
assert.match(
  (
    await compile(
      '#include <stdio.h>\nint main(void){return fopen("/etc/passwd","r") ? 1 : 0;}',
    )
  ).text!,
  /Exit code: 0/,
);
assert.match(
  (
    await compile(
      cArray +
        "\nint main(void){return payload_size==4 && payload[1]==255 ? 0 : 1;}",
    )
  ).text!,
  /Exit code: 0/,
);
const cppArray = run("cpp-byte-array", "", { language: "C++" }).text!;
assert.match(
  (
    await compile(cppArray + "\nint main(){return payload_size;}", {
      standard: "c++17",
    })
  ).text!,
  /Exit code: 0/,
);
await assert.rejects(compile("int x;", { standard: "c++23" }));
await assert.rejects(compile(" ".repeat(1024 * 1024 + 1)));
assert.throws(() => readCppSysroot(sysroot.slice(0, 1200)));

const output = new CapturedOutput(8);
output.fd_write(new TextEncoder().encode("0123456789"));
assert.match(output.finish(), /truncated/);
// Legacy stat writes exactly 56 bytes; following stack memory stays untouched.
const wasi = new WASI([], [], [new OpenFile(new File([1, 2, 3]))], {
  debug: false,
});
wasi.inst = { exports: { memory: new WebAssembly.Memory({ initial: 1 }) } };
new Uint8Array(wasi.inst.exports.memory.buffer).fill(0xaa, 56, 64);
const legacy = legacyImports(wasi, true).wasi_unstable as Record<
  string,
  (...args: any[]) => any
>;
assert.equal(legacy.fd_filestat_get(0, 0), 0);
assert.equal(
  new DataView(wasi.inst.exports.memory.buffer).getBigUint64(24, true),
  3n,
);
assert.deepEqual(
  [...new Uint8Array(wasi.inst.exports.memory.buffer, 56, 8)],
  Array(8).fill(0xaa),
);
assert.equal(legacy.fd_filestat_set_size(0, 2n ** 40n), 76);
assert.equal(legacy.fd_seek(0, 2n, 2, 64), 0);
assert.equal(
  new DataView(wasi.inst.exports.memory.buffer).getBigUint64(64, true),
  2n,
);
console.log(
  `Passed ${cppTools.length} C/C++ tools: actual Clang compile/run, stdin, linker errors, syntax checks, preprocessing, assembly, formatting, ABI adaptation, binary arrays, and Rust inspectors.`,
);
