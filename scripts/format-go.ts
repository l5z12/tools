// SPDX-License-Identifier: AGPL-3.0-only
export {};
const check = process.argv.includes("--check");
const formatter = Bun.spawn(["gofmt", check ? "-l" : "-w", "go-tools"], {
  stdout: "pipe",
  stderr: "inherit",
});
const output = await new Response(formatter.stdout).text();
if (await formatter.exited) throw Error("Go formatting failed.");
if (check && output.trim())
  throw Error(`Run bun run format to format:\n${output}`);
