// SPDX-License-Identifier: AGPL-3.0-only
import { findSevenZip } from "./lib/executable";
import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import init, { suite_run } from "../public/wasm/l5z12_tools";
import type { SuiteOptions, SuiteResult } from "../src/workbench-types";
await init({
  module_or_path: await readFile("public/wasm/l5z12_tools_bg.wasm"),
});
function run(
  id: string,
  bytes: Uint8Array,
  options: SuiteOptions,
): SuiteResult {
  return JSON.parse(suite_run(id, "", bytes, JSON.stringify(options)));
}
const decode = (result: SuiteResult, index = 0) =>
  Buffer.from(result.files![index].base64, "base64");
const samples = [
  {
    name: "folder/hello.txt",
    bytes: Buffer.from("Hello from Rust archives.\n".repeat(40)),
  },
  { name: "漢字.txt", bytes: Buffer.from([0, 1, 2, 255, 254]) },
  { name: "empty.txt", bytes: Buffer.alloc(0) },
];
const bytes = Buffer.concat(samples.map((f) => f.bytes));
const entries = samples.map((f) => ({ name: f.name, size: f.bytes.length }));
const sevenzip = findSevenZip();
await mkdir("work/archive-tests", { recursive: true });
for (const format of ["zip", "tar", "tar.gz", "7z"]) {
  for (const encrypted of [
    false,
    ...(["zip", "7z"].includes(format) ? [true] : []),
  ]) {
    const password = encrypted ? "test-only-password-2026" : "";
    for (const solid of format === "7z" ? [true, false] : [false]) {
      console.log(`Checking ${format}, encrypted=${encrypted}, solid=${solid}`);
      const result = run("archive-create", bytes, {
        entries,
        format,
        outputPassword: password,
        solid,
        archiveName: "fixture",
      });
      const archive = decode(result);
      const filename = `work/archive-tests/${format}-${encrypted}-${solid}.${format}`;
      await writeFile(filename, archive);
      execFileSync(
        sevenzip,
        ["t", filename, "-y", ...(password ? [`-p${password}`] : [])],
        { stdio: "pipe" },
      );
      const tested = run("archive-explorer", archive, {
        mode: "test",
        password,
      });
      assert.equal(
        tested.data && (tested.data as { entries: number }).entries,
        3,
      );
      const extracted = run("archive-explorer", archive, {
        mode: "extract",
        password,
      });
      assert.equal(extracted.files!.length, 3);
      for (let index = 0; index < 3; index++)
        assert.deepEqual(decode(extracted, index), samples[index].bytes);
      const selected = run("archive-explorer", archive, {
        mode: "extract",
        password,
        selected: ["漢字.txt"],
      });
      assert.deepEqual(decode(selected), samples[1].bytes);
      const repacked = run("archive-explorer", archive, {
        mode: "repack",
        password,
        format: "zip",
        selected: ["folder/hello.txt"],
        archiveName: "converted",
      });
      assert.equal(
        run("archive-explorer", decode(repacked), { mode: "inspect" }).rows![0]
          .name,
        "folder/hello.txt",
      );
      if (encrypted)
        assert.throws(() =>
          run("archive-explorer", archive, {
            mode: "extract",
            password: "wrong",
          }),
        );
      // Test stored output separately, including encrypted archives.
      console.log("Checking stored mode");
      const stored = decode(
        run("archive-create", bytes, {
          entries,
          format,
          outputPassword: password,
          level: "store",
          solid,
        }),
      );
      assert.deepEqual(
        decode(run("archive-explorer", stored, { mode: "extract", password })),
        samples[0].bytes,
      );
    }
  }
}
for (const name of [
  "../escape",
  "/absolute",
  "C:/secret",
  "folder\\escape",
  "a/../b",
  "NUL.txt",
  "folder/CON",
  "a\u0000b",
  "a:stream",
  "dir//x",
  "a.",
]) {
  assert.throws(
    () =>
      run("archive-create", Buffer.from("x"), { entries: [{ name, size: 1 }] }),
    /Unsafe/,
  );
}
assert.throws(
  () =>
    run("archive-create", Buffer.from("xx"), {
      entries: [
        { name: "A.txt", size: 1 },
        { name: "a.txt", size: 1 },
      ],
    }),
  /duplicate/,
);
assert.throws(
  () =>
    run("archive-create", bytes, {
      entries,
      format: "tar",
      outputPassword: "secret",
    }),
  /requires ZIP or 7z/,
);
assert.throws(
  () =>
    run("archive-create", bytes, {
      entries: [{ name: "bad", size: bytes.length + 1 }],
    }),
  /size/,
);
const valid = decode(
  run("archive-create", Buffer.from("untouched"), {
    entries: [{ name: "safe.txt", size: 9 }],
    level: "store",
  }),
);
const corrupt = Buffer.from(valid);
const bodyOffset = 30 + corrupt.readUInt16LE(26) + corrupt.readUInt16LE(28);
corrupt[bodyOffset] ^= 1;
assert.throws(
  () => run("archive-explorer", corrupt, { mode: "test" }),
  /checksum|crc/i,
);
const oversized = Buffer.from(valid);
const central = oversized.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
oversized.writeUInt32LE(64 * 1024 * 1024 + 1, central + 24);
assert.throws(
  () => run("archive-explorer", oversized, { mode: "inspect" }),
  /64 MiB/,
);
console.log(
  "Archive tests passed: ZIP/7z/TAR/TAR.GZ, AES passwords, solid/non-solid, stored mode, selected extraction, repacking, native 7-Zip interoperability, CRC corruption, path and expansion limits.",
);
