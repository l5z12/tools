// SPDX-License-Identifier: AGPL-3.0-only
import { installSuiteWorker } from "./suite-worker-fixture";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { Window } from "happy-dom";
import init, { suite_run } from "../public/wasm/l5z12_tools";
import { hashAlgorithms } from "../src/lib/hash-tools";
import { tools } from "../src/lib/catalog";
import { matchesTool } from "../src/lib/search";
import {
  outputSource,
  formatOutput,
  defaultFormat,
} from "../src/output-format";
import {
  configureOutputFormat,
  hasFormattedOutput,
} from "../src/output-format-ui";
import type { SuiteOptions, SuiteResult } from "../src/workbench-types";

installSuiteWorker(suite_run);
await init({
  module_or_path: await readFile("public/wasm/l5z12_tools_bg.wasm"),
});
function run(
  algorithm: string,
  input = "abc",
  options: SuiteOptions = {},
  bytes = new Uint8Array(),
): SuiteResult {
  return JSON.parse(
    suite_run(
      "hash-workbench",
      input,
      bytes,
      JSON.stringify({ algorithm, ...options }),
    ),
  );
}

// OpenSSL is an independent reference, including legacy algorithms Bun does not expose on Windows.
const opensslNames: Record<string, string> = {
  "SHA-224": "sha224",
  "SHA-256": "sha256",
  "SHA-384": "sha384",
  "SHA-512": "sha512",
  "SHA-512/224": "sha512-224",
  "SHA-512/256": "sha512-256",
  "SHA3-224": "sha3-224",
  "SHA3-256": "sha3-256",
  "SHA3-384": "sha3-384",
  "SHA3-512": "sha3-512",
  SHAKE128: "shake128",
  SHAKE256: "shake256",
  "BLAKE2b-512": "blake2b512",
  "BLAKE2s-256": "blake2s256",
  MD4: "md4",
  MD5: "md5",
  "SHA-1": "sha1",
  "RIPEMD-160": "ripemd160",
  SM3: "sm3",
  Whirlpool: "whirlpool",
};
const messages = [
  Buffer.alloc(0),
  Buffer.from("abc"),
  Buffer.from("Hello 🌍\n"),
  Buffer.from(Array.from({ length: 1025 }, (_, index) => index % 256)),
];
const referenceScript = `
  import { createHash } from 'node:crypto';
  import { readFileSync } from 'node:fs';
  const { algorithms, messages } = JSON.parse(readFileSync(0, 'utf8'));
  const results = messages.map(message => Object.fromEntries(Object.entries(algorithms).map(([label, name]) =>
    [label, createHash(name, name.startsWith('shake') ? { outputLength: 73 } : undefined).update(Buffer.from(message, 'base64')).digest('hex')])));
  process.stdout.write(JSON.stringify(results));
`;
const references: Record<string, string>[] = JSON.parse(
  execFileSync(
    "node",
    ["--openssl-legacy-provider", "--input-type=module", "-e", referenceScript],
    {
      input: JSON.stringify({
        algorithms: opensslNames,
        messages: messages.map((message) => message.toString("base64")),
      }),
      encoding: "utf8",
      windowsHide: true,
    },
  ),
);
for (const [index, message] of messages.entries()) {
  for (const [algorithm, expected] of Object.entries(references[index])) {
    assert.equal(
      run(algorithm, "ignored", { fileProvided: true, length: "73" }, message)
        .text,
      expected,
      `${algorithm}, message ${index}`,
    );
  }
}

// Published known answers (RFC 1319, RustCrypto crate examples, and upstream hash vectors).
// Variable BLAKE2 answers also cross-checked with Python hashlib's digest_size parameter.
const vectors: [string, string, string][] = [
  ["MD2", "abc", "da853b0d3f88d99b30283a69e6ded6bb"],
  [
    "Keccak-256",
    "abc",
    "4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45",
  ],
  [
    "BLAKE2b-256",
    "abc",
    "bddd813c634239723171ef3fee98579b94964e3bb1cb3e427262c8c068d52319",
  ],
  [
    "BLAKE2b-384",
    "abc",
    "6f56a82c8e7ef526dfe182eb5212f7db9df1317e57815dbda46083fc30f54ee6c66ba83be64b302d7cba6ce15bb556f4",
  ],
  ["BLAKE2s-128", "abc", "aa4938119b1dc7b87cbad0ffd200d0ae"],
  [
    "BLAKE3",
    "",
    "af1349b9f5f9a1a6a0404dea36dcc9499bcb25c9adc112b7cc9a93cae41f3262",
  ],
  ["Tiger", "hello world", "4c8fbddae0b6f25832af45e7c62811bb64ec3e43691e9cc3"],
  [
    "GOST94 CryptoPro",
    "The quick brown fox jumps over the lazy dog",
    "9004294a361a508c586fe53d1f1b02746765e71b765472786e4770d565830a76",
  ],
  [
    "Streebog-256",
    "The quick brown fox jumps over the lazy dog",
    "3e7dea7f2384b6c5a3d0e24aaa29c05e89ddd762145030ec22c71a6db8b2c1f4",
  ],
  [
    "Streebog-512",
    "The quick brown fox jumps over the lazy dog.",
    "fe0c42f267d921f940faa72bd9fcf84f9f1bd7e9d055e9816e4c2ace1ec83be82d2957cd59b86e123d8f5adee80b3ca08a017599a9fc1a14d940cf87c77df070",
  ],
  [
    "RIPEMD-320",
    "Hello world!",
    "f1c1c231d301abcf2d7daae0269ff3e7bc68e623ad723aa068d316b056d26b7d1bb6f0cc0f28336d",
  ],
  ["CRC-32/ISO-HDLC", "123456789", "cbf43926"],
  ["CRC-32C", "123456789", "e3069283"],
  ["Adler-32", "Wikipedia", "11e60398"],
  ["FNV-1a-32", "hello", "4f9f2cab"],
  ["FNV-1a-64", "hello", "a430d84680aabd0b"],
  ["xxHash32", "", "02cc5d05"],
  ["xxHash64", "", "ef46db3751d8e999"],
  ["XXH3-64", "", "2d06800538d394c2"],
  ["XXH3-128", "", "99aa06d3014798d86001c324468d497f"],
  ["Murmur3 x86-32", "Hello, world!", "c0363e43"],
  // Murmur's numeric u128 is displayed most-significant byte first.
  ["Murmur3 x64-128", "Hello, world!", "2c326650a8f3c564f1512dd1d2d665df"],
];
for (const [algorithm, input, expected] of vectors)
  assert.equal(run(algorithm, input).text, expected, algorithm);

assert.equal(hashAlgorithms.length, 50);
const hashTool = tools.find((tool) => tool.id === "hash-workbench")!;
for (const algorithm of hashAlgorithms)
  assert.ok(
    matchesTool(hashTool, algorithm.name, new Set(["hashes"])),
    algorithm.name,
  );
assert.equal(
  new Set(hashAlgorithms.map((algorithm) => algorithm.name)).size,
  50,
);
assert.equal(tools.filter((tool) => tool.id === "hash-workbench").length, 1);
const all = run("All algorithms");
assert.equal(all.rows!.length, 50);
assert.deepEqual(
  JSON.parse(Buffer.from(all.files![0].base64, "base64").toString()),
  all.rows,
);
for (const row of all.rows!) {
  const single = run(String(row.algorithm));
  assert.equal(single.text, row.hex);
  assert.equal(
    Buffer.from(single.formatBytes!, "base64").toString("hex"),
    row.hex,
  );
  assert.equal(
    Buffer.from(single.files![1].base64, "base64").toString("hex"),
    row.hex,
  );
  assert.equal(
    run(String(row.algorithm), "61-62-63", { inputFormat: "Hex" }).text,
    row.hex,
  );
  assert.equal(
    run(String(row.algorithm), "YWJj", { inputFormat: "Base64" }).text,
    row.hex,
  );
}
const sha = run("SHA-256");
const expected = sha.text!.toUpperCase().match(/../g)!.join("-");
assert.equal(
  (run("SHA-256", "abc", { expected }).data as Record<string, unknown>)
    .matchesExpected,
  true,
);
assert.equal(
  (run("SHA-256", "abd", { expected }).data as Record<string, unknown>)
    .matchesExpected,
  false,
);
assert.equal(
  run("All algorithms", "abc", { expected }).rows!.filter(
    (row) => row.matchesExpected,
  ).length,
  1,
);
assert.equal(
  run("BLAKE3 XOF", "", { length: "64" }).text!.slice(0, 64),
  run("BLAKE3", "").text,
);
assert.equal(run("SHAKE128", "abc", { length: "4096" }).text!.length, 8192);
assert.notEqual(
  run("xxHash64", "abc", { seed: "18446744073709551615" }).text,
  run("xxHash64").text,
);
for (const options of [
  { length: "0" },
  { length: "4097" },
  { seed: "-1" },
  { expected: "xyz" },
  { inputFormat: "Hex" },
])
  assert.throws(() => run("SHA-256", "abc", options));
assert.throws(() => run("unknown"));
assert.throws(() => run("xxHash32", "abc", { seed: "4294967296" }));
assert.throws(() => run("Murmur3 x64-128", "abc", { seed: "4294967296" }));
assert.throws(() =>
  run(
    "All algorithms",
    "",
    { fileProvided: true },
    new Uint8Array(1024 * 1024 + 1),
  ),
);
assert.throws(() =>
  run("MD2", "", { fileProvided: true }, new Uint8Array(4 * 1024 * 1024 + 1)),
);
assert.equal(
  await formatOutput(outputSource("hash-workbench", sha.text!, sha).bytes, {
    ...defaultFormat,
    mode: "Hex",
    uppercase: true,
    separator: "-",
  }),
  expected,
);

const window = new Window();
Object.assign(globalThis, { document: window.document });
window.document.body.innerHTML = '<div id="output-format-controls"></div>';
let displayed = "";
configureOutputFormat("hash-workbench", sha.text!, sha, (text) => {
  displayed = text;
});
const mode = window.document.getElementById(
  "output-format-mode",
) as unknown as HTMLSelectElement;
mode.value = "Base64";
mode.dispatchEvent(
  new window.Event("change", { bubbles: true }) as unknown as Event,
);
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(displayed, sha.formatBytes);
assert.equal(hasFormattedOutput(), true);
configureOutputFormat("hash-workbench", all.text!, all, () => {});
assert.equal(
  window.document.getElementById("output-format-controls")!.children.length,
  0,
);
assert.equal(hasFormattedOutput(), false);
console.log(
  "50 hash variants passed: 80 OpenSSL comparisons, 22 known answers, byte inputs/downloads, XOF lengths, verification, limits, and formatting controls.",
);
