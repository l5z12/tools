// SPDX-License-Identifier: AGPL-3.0-only
import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeSpdx } from "./lib/spdx-headers";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const extensions = new Set([
  ".ts",
  ".js",
  ".mjs",
  ".cjs",
  ".rs",
  ".go",
  ".css",
  ".astro",
]);
const excludedDirectories = new Set([
  "generated",
  "node_modules",
  "vendor",
  "target",
  "dist",
  ".git",
]);

async function collectSources(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    // Dirent classification intentionally skips symbolic links and junctions.
    const path = join(directory, entry.name);
    if (entry.isDirectory() && !excludedDirectories.has(entry.name))
      files.push(...(await collectSources(path)));
    else if (entry.isFile() && extensions.has(extname(entry.name)))
      files.push(path);
  }
  return files;
}

async function main(): Promise<void> {
  const arguments_ = process.argv.slice(2);
  if (
    arguments_.length > 1 ||
    (arguments_[0] && !["--check", "--write"].includes(arguments_[0]))
  ) {
    throw Error("Usage: bun scripts/spdx.ts [--check | --write]");
  }
  const write = arguments_[0] === "--write";
  const files = [join(projectRoot, "astro.config.mjs")];
  for (const directory of ["src", "scripts", "core/src", "go-tools"])
    files.push(...(await collectSources(join(projectRoot, directory))));
  const changes: { path: string; content: string }[] = [];
  // Validate the entire set before writing, so a license conflict changes nothing.
  for (const path of files.sort()) {
    const original = await readFile(path, "utf8");
    let content: string;
    try {
      content = await normalizeSpdx(original, extname(path));
    } catch (error) {
      throw Error(`${relative(projectRoot, path)}: ${String(error)}`);
    }
    if (content !== original) changes.push({ path, content });
  }
  for (const change of changes) {
    if (write) await writeFile(change.path, change.content, "utf8");
    console.log(
      `${write ? "Fixed" : "Needs header fix"}: ${relative(projectRoot, change.path)}`,
    );
  }
  console.log(
    `${files.length} source files checked; ${changes.length} ${write ? "updated" : "need changes"}.`,
  );
  if (!write && changes.length) process.exitCode = 1;
}

await main().catch((error) => {
  console.error(String(error));
  process.exitCode = 1;
});
