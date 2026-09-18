// SPDX-License-Identifier: AGPL-3.0-only
import { mkdir, copyFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const release =
  "https://github.com/AngelOnFira/wasm-rustc/releases/download/artifacts-test-7";
const assets = [
  {
    archive: "rustc-wasm.tar.zst",
    hash: "a96f6d53afff3c95d6387def27f6ddb53a02575679dc6c981d60797c32dcd022",
    name: "rustc.wasm",
  },
  {
    archive: "wasip1-sysroot.tar.zst",
    hash: "4eedff7b0cd4330bfe226734b67751a97fac5572ac55392e93f9d3e4886a277d",
    name: "sysroot-wasip1.bundle",
  },
];
await mkdir("work/rust-assets", { recursive: true });
await mkdir("public/rust", { recursive: true });
const sizes: Record<string, number> = {};
for (const asset of assets) {
  const cache = Bun.file(`work/rust-assets/${asset.archive}`);
  let compressed: Uint8Array;
  if (await cache.exists())
    compressed = new Uint8Array(await cache.arrayBuffer());
  else {
    console.log(`Preparing ${asset.name}…`);
    const response = await fetch(`${release}/${asset.archive}`);
    if (!response.ok)
      throw Error(`Compiler asset fetch failed: ${response.status}`);
    compressed = new Uint8Array(await response.arrayBuffer());
  }
  if (createHash("sha256").update(compressed).digest("hex") !== asset.hash)
    throw Error(`Checksum mismatch: ${asset.archive}`);
  if (!(await cache.exists())) await Bun.write(cache, compressed);
  // Extract only the named regular file; archive paths never become disk paths.
  const tar = Bun.zstdDecompressSync(compressed);
  const decoder = new TextDecoder();
  let found = false;
  for (let offset = 0; offset + 512 <= tar.length;) {
    const name = decoder
      .decode(tar.subarray(offset, offset + 100))
      .split("\0")[0];
    if (!name) break;
    const length = parseInt(
      decoder
        .decode(tar.subarray(offset + 124, offset + 136))
        .replace(/\0/g, "")
        .trim(),
      8,
    );
    if (
      !Number.isSafeInteger(length) ||
      length < 0 ||
      offset + 512 + length > tar.length
    )
      throw Error("Invalid compiler archive entry.");
    const type = tar[offset + 156];
    if (name.split("/").pop() === asset.name && (type === 0 || type === 48)) {
      await Bun.write(
        `public/rust/${asset.name}`,
        tar.subarray(offset + 512, offset + 512 + length),
      );
      sizes[asset.name] = length;
      found = true;
      break;
    }
    offset += 512 + Math.ceil(length / 512) * 512;
  }
  if (!found) throw Error(`Missing ${asset.name} in verified archive.`);
}
await Bun.write("public/rust/assets.json", JSON.stringify(sizes));
await copyFile(
  "node_modules/@bjorn3/browser_wasi_shim/LICENSE-APACHE",
  "public/rust/LICENSE.wasi-apache.txt",
);
await copyFile(
  "node_modules/@bjorn3/browser_wasi_shim/LICENSE-MIT",
  "public/rust/LICENSE.wasi-mit.txt",
);
const result = await Bun.build({
  entrypoints: ["src/rust/worker.ts"],
  outdir: "public/rust",
  naming: "runner.js",
  target: "browser",
  format: "esm",
  banner:
    "// SPDX-License-Identifier: AGPL-3.0-only\n// Includes browser_wasi_shim (MIT/Apache-2.0); see accompanying licenses.",
});
if (!result.success)
  throw new AggregateError(result.logs, "Rust worker build failed.");
console.log("Prepared local Rust compiler and standard library.");
