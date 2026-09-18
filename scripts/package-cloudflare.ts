// SPDX-License-Identifier: AGPL-3.0-only
import { createHash } from "node:crypto";
import { cp, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { AssetManifest } from "../src/runtime-assets";

const root = fileURLToPath(new URL("../", import.meta.url));
const source = join(root, "dist");
const output = join(root, "work/cloudflare");
const assets = join(output, "assets");
const limit = 25 * 1024 * 1024;
const chunkSize = 20 * 1024 * 1024;
const manifest: AssetManifest = {};
const written = new Set<string>();
let count = 0;

async function packageDirectory(directory: string): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await packageDirectory(path);
      continue;
    }
    if (!entry.isFile()) throw Error(`Unsupported asset: ${path}`);
    const name = relative(source, path).split(sep).join("/");
    if (name.startsWith("__asset_chunks/"))
      throw Error("Reserved asset directory.");
    const file = Bun.file(path);
    if (file.size <= limit) {
      const destination = join(assets, name);
      await mkdir(dirname(destination), { recursive: true });
      await cp(path, destination);
      written.add(resolve(destination));
      count++;
      continue;
    }
    const hash = createHash("sha256");
    for await (const bytes of file.stream()) hash.update(bytes);
    const digest = hash.digest("hex");
    const chunks: string[] = [];
    for (let offset = 0; offset < file.size; offset += chunkSize) {
      const chunk = `/__asset_chunks/${digest}/${chunks.length}.bin`;
      await Bun.write(
        join(assets, chunk.slice(1)),
        await file.slice(offset, offset + chunkSize).arrayBuffer(),
      );
      chunks.push(chunk);
      written.add(resolve(assets, chunk.slice(1)));
      count++;
    }
    manifest[`/${name}`] = {
      size: file.size,
      contentType: name.endsWith(".wasm")
        ? "application/wasm"
        : "application/octet-stream",
      etag: `"${digest}"`,
      chunks,
    };
  }
}

await stat(join(source, "index.html")).catch(() => {
  throw Error("Build the site first with bun run build.");
});
// Only replace this script's generated output, never the source build.
if (resolve(output) !== resolve(root, "work", "cloudflare"))
  throw Error("Invalid output directory.");
await mkdir(assets, { recursive: true });
await packageDirectory(source);
const manifestPath = join(assets, "runtime-assets.json");
await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
written.add(resolve(manifestPath));
// Keep watched directories in place on Windows; remove only stale output files.
for (const name of await readdir(assets, {
  recursive: true,
  withFileTypes: true,
})) {
  if (!name.isFile()) continue;
  const path = resolve(name.parentPath, name.name);
  if (!written.has(path)) await rm(path, { force: true });
}
if (count > 20_000)
  throw Error(`Too many assets for the Workers Free plan: ${count}.`);
console.log(
  `Packaged ${count} static files; ${Object.keys(manifest).length} large assets split into parts below 25 MiB.`,
);
