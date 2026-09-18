// SPDX-License-Identifier: AGPL-3.0-only
import { copyFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";

const revision = "648c4a89997a351eef75cdaec3ef5b89d4937dec";
const base = `https://raw.githubusercontent.com/binji/wasm-clang/${revision}`;
const assets = [
  {
    name: "LICENSE.cloudlibc.txt",
    url: "https://raw.githubusercontent.com/WebAssembly/wasi-libc/main/libc-bottom-half/cloudlibc/LICENSE",
    sha256: "c8b789cf5a746611e6300a0cc7750dbf92b61912a709d04e639245f7290656d0",
  },
  {
    name: "clang.wasm",
    url: `${base}/clang`,
    sha256: "2a466f0e990329d3230b869d04fc20803eae96a7feb3a3f6c93e25a77b8aed1d",
  },
  {
    name: "lld.wasm",
    url: `${base}/lld`,
    sha256: "36419ed202011765222098d7701218378b67f634d50f0a4625059ae2c9860f48",
  },
  {
    name: "sysroot.tar",
    url: `${base}/sysroot.tar`,
    sha256: "2435a7b549af30c2be7ec249c405bc2e911ab0c6003012f0909ec3c131bff867",
  },
  {
    name: "LICENSE.llvm.txt",
    url: `${base}/LICENSE.llvm`,
    sha256: "ebcd9bbf783a73d05c53ba4d586b8d5813dcdf3bbec50265860ccc885e606f47",
  },
  {
    name: "LICENSE.libcxx.txt",
    url: "https://raw.githubusercontent.com/llvm/llvm-project/llvmorg-8.0.1/libcxx/LICENSE.TXT",
    sha256: "c3b21ee90de785b9e45590253fd08fb22b269abccaadb175c4d96d7f420340cd",
  },
  {
    name: "LICENSE.libcxxabi.txt",
    url: "https://raw.githubusercontent.com/llvm/llvm-project/llvmorg-8.0.1/libcxxabi/LICENSE.TXT",
    sha256: "4ce86cf966c41a381f04ae1c82e22ea13043cd693fd726e26872620d49e94580",
  },
  {
    name: "LICENSE.musl.txt",
    url: "https://git.musl-libc.org/cgit/musl/plain/COPYRIGHT?h=v1.1.22",
    sha256: "a3ae1b9fc5d4938f5734734383b9813d27a5652df23010c6f9d4c5419b239a41",
  },
];
await mkdir("public/cpp", { recursive: true });
for (const asset of assets) {
  const path = `public/cpp/${asset.name}`;
  const file = Bun.file(path);
  let bytes: ArrayBuffer;
  if (await file.exists()) bytes = await file.arrayBuffer();
  else {
    const response = await fetch(asset.url);
    if (!response.ok)
      throw Error(`Could not fetch ${asset.name}: ${response.status}`);
    bytes = await response.arrayBuffer();
  }
  // Text notices may have CRLF after a Windows checkout; binary hashes stay exact.
  const checkedBytes = asset.name.startsWith("LICENSE.")
    ? new TextEncoder().encode(
        new TextDecoder("utf-8", { fatal: true })
          .decode(bytes)
          .replace(/\r\n/g, "\n"),
      )
    : new Uint8Array(bytes);
  if (createHash("sha256").update(checkedBytes).digest("hex") !== asset.sha256)
    throw Error(`Checksum mismatch: ${asset.name}`);
  if (!(await file.exists())) await Bun.write(path, bytes);
}
await copyFile(
  "node_modules/@wasm-fmt/clang-format/clang-format.wasm",
  "public/cpp/clang-format.wasm",
);
await copyFile(
  "node_modules/@wasm-fmt/clang-format/LICENSE",
  "public/cpp/LICENSE.format-wrapper.txt",
);
await copyFile(
  "node_modules/@bjorn3/browser_wasi_shim/LICENSE-APACHE",
  "public/cpp/LICENSE.wasi-shim.txt",
);
const result = await Bun.build({
  entrypoints: ["src/cpp/worker.ts"],
  outdir: "public/cpp",
  naming: "runner.js",
  target: "browser",
  format: "esm",
  banner:
    "// SPDX-License-Identifier: AGPL-3.0-only\n// Bundles clang-format wrapper (MIT) and browser_wasi_shim (Apache-2.0); see adjacent license files.",
});
if (!result.success)
  throw new AggregateError(result.logs, "C/C++ worker build failed.");
await Bun.write(
  "public/cpp/SOURCES.txt",
  `Compiler and linker: LLVM 8.0.1, binji/wasm-clang revision ${revision}\nhttps://github.com/binji/wasm-clang/tree/${revision}\nhttps://github.com/binji/llvm-project/tree/master/binji\nFormatter: @wasm-fmt/clang-format 23.1.0 (LLVM clang-format, MIT wrapper)\nhttps://github.com/wasm-fmt/clang-format\nRuntime: @bjorn3/browser_wasi_shim 0.4.2 with local legacy-WASI adapter\nApplication source: https://github.com/l5z12/tools\n`,
);
console.log(
  "Prepared local C/C++ compiler, linker, standard library, and formatter.",
);
