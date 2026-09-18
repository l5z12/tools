// SPDX-License-Identifier: AGPL-3.0-only
import { fileURLToPath } from "node:url";
import manifest from "../package.json";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const scriptNames = Object.keys(manifest.scripts);

async function runScript(name: string): Promise<void> {
  console.log(`\nRunning ${name}`);
  const child = Bun.spawn([process.execPath, "run", name], {
    cwd: projectRoot,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  const status = await child.exited;
  if (status !== 0) throw Error(`${name} failed (exit ${status}).`);
}

async function prepareAssets(): Promise<void> {
  // Collectors import the generated Rust module, so build it first.
  await runScript("build:wasm");
  for (const name of scriptNames
    .filter(
      (name) =>
        name.startsWith("build:") &&
        name !== "build:wasm" &&
        name !== "build:site",
    )
    .sort()) {
    await runScript(name);
  }
}

async function runTests(selected: string[]): Promise<void> {
  const names = selected.length
    ? selected.map((name) => `test:${name}`)
    : scriptNames.filter((name) => name.startsWith("test:")).sort();
  for (const name of names) {
    if (!scriptNames.includes(name))
      throw Error(
        `Unknown suite ${name}. Available suites: ${scriptNames.filter((name) => name.startsWith("test:")).join(", ")}`,
      );
  }
  const failures: string[] = [];
  for (const name of names) {
    try {
      await runScript(name);
    } catch {
      failures.push(name);
    }
  }
  if (failures.length)
    throw Error(
      `${failures.length}/${names.length} suites failed: ${failures.join(", ")}`,
    );
  console.log(`\n${names.length} test suites passed.`);
}

const [task, ...selected] = process.argv.slice(2);
try {
  switch (task) {
    case "assets":
      await prepareAssets();
      break;
    case "build":
      await prepareAssets();
      await runScript("build:site");
      break;
    case "test":
      await runTests(selected);
      break;
    case "verify":
      await runScript("format:check");
      await runScript("spdx:check");
      await prepareAssets();
      await runScript("check");
      await runScript("build:site");
      await runTests([]);
      break;
    default:
      throw Error("Choose assets, build, test [suite names], or verify.");
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
