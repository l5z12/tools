// SPDX-License-Identifier: AGPL-3.0-only
import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import { resolve } from "node:path";

function replaceOnce(
  source: string,
  original: string,
  replacement: string,
): string {
  if (
    !source.includes(original) ||
    source.indexOf(original) !== source.lastIndexOf(original)
  )
    throw Error(`Upstream adapter marker changed: ${original.slice(0, 80)}`);
  return source.replace(original, replacement);
}

// Keep the pinned MIT source intact. Apply the local-only adapter during bundling.
const adapter: Bun.BunPlugin = {
  name: "local-creepjs",
  setup(build) {
    build.onLoad(
      {
        filter:
          /vendor[\\/]creepjs[\\/]src[\\/](creep\.ts|utils[\\/]crypto\.ts|worker[\\/]index\.ts|lies[\\/]index\.ts)$/,
      },
      async ({ path }) => {
        let source = (await readFile(path, "utf8")).replace(/\r\n/g, "\n");
        if (path.endsWith("creep.ts")) {
          source = replaceOnce(
            source,
            "!async function() {",
            "export async function collectCreep() {",
          );
          const end = source.indexOf("\tconst blankFingerprint =");
          if (end < 0) throw Error("CreepJS report boundary changed.");
          source =
            source.slice(0, end) +
            "return { fingerprint: fp, creep, fpHash, creepHash, fuzzyFingerprint: await getFuzzyHash(fp) };\n}";
        } else if (path.includes("crypto.ts")) {
          const start = source.indexOf("const hashMini =");
          const end = source.indexOf("// instance id");
          const hashStart = source.indexOf("const hashify =");
          const hashEnd = source.indexOf("async function cipher");
          if ([start, end, hashStart, hashEnd].some((index) => index < 0))
            throw Error("CreepJS hash boundaries changed.");
          source =
            source.slice(0, start) +
            source.slice(end, hashStart) +
            source.slice(hashEnd);
          source = `import { creepHashMini as hashMini, creepHashify as hashify } from '../../../../src/browser-fingerprint/wasm'\n${source}`;
        } else if (/[\\/]lies[\\/]/.test(path)) {
          // Bun rejects this deliberate runtime const-assignment error at build time.
          source = replaceOnce(
            source,
            "proxy2.__proto__ = proxy2; proxy2++",
            "Function('value', 'const proxy2 = value; proxy2.__proto__ = proxy2; proxy2++')(proxy2)",
          );
        } else {
          const start = source.indexOf("\t\tconst scriptSource = './creep.js'");
          const end = source.indexOf(
            "\t\tif (!(workerScope || {}).userAgent) {\n\t\t\treturn",
            start,
          );
          if (start < 0 || end < 0)
            throw Error("CreepJS worker selection boundary changed.");
          source =
            source.slice(0, start) +
            `
        const scriptSource = '/fingerprint/creep-worker.js'
        WORKER_NAME = 'DedicatedWorkerGlobalScope'
        WORKER_TYPE = 'dedicated'
        let workerScope = await getDedicatedWorker({ scriptSource })
` +
            source.slice(end);
          source = replaceOnce(
            source,
            "new Worker(scriptSource)",
            "new Worker(scriptSource, { type: 'module' })",
          );
          // Ensure timed-out dedicated probes cannot outlive their inspection frame.
          source = replaceOnce(
            source,
            "\t\tconst getDedicatedWorker = ({ scriptSource }) => new Promise((resolve) => {",
            "\t\tconst getDedicatedWorker = ({ scriptSource }) => new Promise((resolve) => {\nlet dedicatedWorker;",
          );
          source = replaceOnce(
            source,
            "const dedicatedWorker = ask",
            "dedicatedWorker = ask",
          );
          source = source.replace(
            "\t\t\tconst giveUpOnWorker = setTimeout(() => {",
            "\t\t\tconst giveUpOnWorker = setTimeout(() => {\n dedicatedWorker?.terminate();",
          );
        }
        return {
          contents: source,
          loader: "ts",
          resolveDir: resolve(path, ".."),
        };
      },
    );
  },
};

await mkdir("public/fingerprint", { recursive: true });
for (const [entry, output] of [
  ["vendor/creepjs/entry.ts", "creep.js"],
  ["vendor/creepjs/worker-entry.ts", "creep-worker.js"],
  ["vendor/fingerprintjs/entry.ts", "fingerprintjs.js"],
  ["src/browser-fingerprint/frame-entry.ts", "frame.js"],
]) {
  const result = await Bun.build({
    entrypoints: [entry],
    target: "browser",
    format: "esm",
    minify: false,
    plugins: [adapter],
  });
  if (!result.success)
    throw new AggregateError(result.logs, `Could not build ${entry}`);
  await writeFile(
    `public/fingerprint/${output}`,
    await result.outputs[0].text(),
  );
}
await copyFile(
  "vendor/creepjs/LICENSE",
  "public/fingerprint/CREEPJS-LICENSE.txt",
);
await copyFile(
  "vendor/fingerprintjs/LICENSE",
  "public/fingerprint/FINGERPRINTJS-LICENSE.txt",
);
console.log(
  "Built pinned local fingerprint collectors and Rust hash adapters.",
);
