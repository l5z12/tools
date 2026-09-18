// SPDX-License-Identifier: AGPL-3.0-only
import { chmod, copyFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { env as environment } from "node:process";

async function go(
  args: string[],
  env: Record<string, string> = {},
): Promise<string> {
  const process = Bun.spawn(["go", ...args], {
    cwd: "go-tools",
    env: { ...environment, GOTOOLCHAIN: "local", ...env },
    stdout: "pipe",
    stderr: "inherit",
  });
  const output = await new Response(process.stdout).text();
  if (await process.exited) throw Error(`go ${args.join(" ")} failed.`);
  return output.trim();
}

await mkdir("public/go", { recursive: true });
const root = await go(["env", "GOROOT"]);
await go(
  [
    "build",
    "-trimpath",
    "-ldflags=-s -w",
    "-o",
    "../public/go/tools.wasm",
    ".",
  ],
  { GOOS: "js", GOARCH: "wasm", CGO_ENABLED: "0" },
);
await copyFile(join(root, "lib/wasm/wasm_exec.js"), "public/go/wasm_exec.js");
await copyFile(join(root, "LICENSE"), "public/go/LICENSE.Go.txt");
for (const module of ["mod", "tools"]) {
  const directory = await go([
    "list",
    "-m",
    "-f",
    "{{.Dir}}",
    `golang.org/x/${module}`,
  ]);
  const destination = `public/go/LICENSE.x-${module}.txt`;
  // Windows copies the module cache's read-only attribute along with the file.
  try {
    await chmod(destination, 0o666);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await copyFile(join(directory, "LICENSE"), destination);
  await chmod(destination, 0o666);
}
const result = await Bun.build({
  entrypoints: ["src/go/worker.ts"],
  outdir: "public/go",
  naming: "runner.js",
  target: "browser",
  format: "esm",
  banner: "// SPDX-License-Identifier: AGPL-3.0-only",
});
if (!result.success)
  throw new AggregateError(result.logs, "Go worker build failed.");
console.log(`Prepared local ${await go(["version"])} WebAssembly tools.`);
