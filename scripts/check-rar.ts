// SPDX-License-Identifier: AGPL-3.0-only
import { findSevenZip, findRar } from "./lib/executable";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import init, { suite_run } from "../public/wasm/l5z12_tools";
import type { SuiteOptions, SuiteResult } from "../src/workbench-types";

await init({
  module_or_path: await readFile("public/wasm/l5z12_tools_bg.wasm"),
});
const sevenzip = findSevenZip();
const rar = findRar();
const workspace = resolve("work/rar-tests");
await mkdir(join(workspace, "source/nested"), { recursive: true });
const password = "rar-fixture-password-2026";
const samples = [
  {
    name: "nested/hello.txt",
    bytes: Buffer.from("RAR interoperability.\n".repeat(1024)),
  },
  { name: "漢字.txt", bytes: Buffer.from([0, 255, 1, 254, 2]) },
  { name: "empty.txt", bytes: Buffer.alloc(0) },
];
for (const sample of samples)
  await writeFile(join(workspace, "source", sample.name), sample.bytes);
function run(bytes: Uint8Array, options: SuiteOptions): SuiteResult {
  return JSON.parse(
    suite_run("archive-explorer", "", bytes, JSON.stringify(options)),
  );
}
function create(options: SuiteOptions): Buffer {
  const result: SuiteResult = JSON.parse(
    suite_run(
      "archive-create",
      "",
      Buffer.concat(samples.map((f) => f.bytes)),
      JSON.stringify({
        format: "rar",
        entries: samples.map((f) => ({ name: f.name, size: f.bytes.length })),
        ...options,
      }),
    ),
  );
  return Buffer.from(result.files![0].base64, "base64");
}
function extracted(result: SuiteResult): Buffer[] {
  return result.files!.map((file) => Buffer.from(file.base64, "base64"));
}
function extractNative(
  archive: string,
  dest: string,
  archivePassword: string,
): void {
  const password = archivePassword ? `-p${archivePassword}` : "-p-";
  try {
    // Avoid 7z -so: the runner's 7z SIGSEGVs printing encrypted RAR4 .exe members.
    execFileSync(sevenzip, ["x", "-y", `-o${dest}`, password, archive], {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 60_000,
    });
  } catch {
    try {
      execFileSync(
        rar,
        ["x", "-y", "-o+", "-idq", "-c-", password, archive, dest + sep],
        { stdio: ["ignore", "pipe", "pipe"], timeout: 60_000 },
      );
    } catch {
      // WinRAR exits 3 when a historical archive comment is corrupt.
    }
  }
}
function checkSamples(bytes: Uint8Array, archivePassword: string): void {
  assert.equal(
    (
      run(bytes, { mode: "test", password: archivePassword }).data as {
        format: string;
      }
    ).format,
    "rar",
  );
  assert.deepEqual(
    extracted(run(bytes, { mode: "extract", password: archivePassword })).sort(
      Buffer.compare,
    ),
    samples.map((f) => f.bytes).sort(Buffer.compare),
  );
  assert.deepEqual(
    extracted(
      run(bytes, {
        mode: "extract",
        password: archivePassword,
        selected: ["漢字.txt"],
      }),
    ),
    [samples[1].bytes],
  );
  assert.equal(
    run(bytes, { mode: "extract", password: archivePassword, selected: [] })
      .files!.length,
    0,
  );
  const repacked = run(bytes, {
    mode: "repack",
    password: archivePassword,
    selected: ["nested/hello.txt"],
    format: "zip",
  });
  const zip = Buffer.from(repacked.files![0].base64, "base64");
  assert.equal(run(zip, { mode: "inspect" }).rows![0].name, "nested/hello.txt");
  assert.deepEqual(extracted(run(zip, { mode: "extract" })), [
    samples[0].bytes,
  ]);
}

for (const solid of [false, true]) {
  for (const level of ["store", "fast", "balanced", "maximum"]) {
    for (const encryption of ["none", "files", "headers"]) {
      const archivePassword = encryption === "none" ? "" : password;
      const bytes = create({
        solid,
        level,
        outputPassword: archivePassword,
        encryptNames: encryption === "headers",
      });
      const path = join(workspace, `wasm-${solid}-${level}-${encryption}.rar`);
      await writeFile(path, bytes);
      for (const executable of [sevenzip, rar])
        execFileSync(
          executable,
          ["t", path, "-y", archivePassword ? `-p${archivePassword}` : "-p-"],
          { stdio: "pipe", timeout: 60_000 },
        );
      checkSamples(bytes, archivePassword);
      if (archivePassword)
        assert.throws(() => run(bytes, { mode: "test", password: "wrong" }));
      if (encryption === "headers")
        assert.throws(() => run(bytes, { mode: "inspect" }));
      else assert.equal(run(bytes, { mode: "inspect" }).rows!.length, 3);
    }
  }
}
console.log(
  "RAR creation passed: levels, solid streams, file/header encryption, native WinRAR and 7-Zip verification.",
);

for (const settings of [
  { name: "compressed", args: ["-m5"] },
  { name: "solid", args: ["-m5", "-s"] },
  { name: "encrypted", args: ["-m3", `-p${password}`] },
  { name: "headers", args: ["-m3", `-hp${password}`, "-s"] },
  { name: "blake2", args: ["-m3", "-htb"] },
  { name: "encrypted-blake2", args: ["-m3", "-htb", `-p${password}`] },
]) {
  const path = join(workspace, `winrar-${settings.name}.rar`);
  execFileSync(
    rar,
    [
      "a",
      "-y",
      "-o+",
      "-ma5",
      "-md4m",
      ...settings.args,
      path,
      ...samples.map((f) => f.name),
    ],
    { cwd: join(workspace, "source"), stdio: "pipe", timeout: 60_000 },
  );
  checkSamples(
    await readFile(path),
    settings.args.some((a) => a.startsWith("-p") || a.startsWith("-hp"))
      ? password
      : "",
  );
}

// The pinned crate includes independent historical fixtures. Locate Cargo's
// actual package directory instead of assuming a platform-specific cache path.
const metadata = JSON.parse(
  execFileSync(
    "cargo",
    ["metadata", "--manifest-path", "core/Cargo.toml", "--format-version", "1"],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 8 * 1024 * 1024,
    },
  ),
) as { packages: { name: string; manifest_path: string }[] };
const fixtureRoot = join(
  dirname(metadata.packages.find((p) => p.name === "rars")!.manifest_path),
  "tests/fixtures/rar15_40",
);
for (const [name, archivePassword] of [
  ["rar202/comment_nopsw.rar", ""],
  ["rar420/ext_time_rar420.rar", ""],
  ["ppmd/ppmd_lorem_rar300.rar", ""],
  ["ppmd/ppmd_solid_rar300.rar", ""],
  ["encrypted/header_rar420_password.rar", "password"],
  ["encrypted/rar4_junrar_file_content_encrypted_unicode.rar", "test"],
  ["encrypted/rar4_sharpcompress_files_only.rar", "test"],
]) {
  const path = join(fixtureRoot, name);
  const bytes = await readFile(path);
  const inspected = run(bytes, { mode: "inspect", password: archivePassword });
  const result = run(bytes, { mode: "extract", password: archivePassword });
  const rows = inspected.rows!.filter((row) => row.extractable === true);
  assert.equal(result.files!.length, rows.length);
  const dest = join(
    workspace,
    "native",
    name.replaceAll("/", "-").replace(/\.rar$/i, ""),
  );
  await mkdir(dest, { recursive: true });
  extractNative(path, dest, archivePassword);
  const resultBytes = extracted(result);
  for (let index = 0; index < rows.length; index++) {
    const member = String(rows[index].name);
    assert.deepEqual(
      resultBytes[index],
      await readFile(join(dest, member)),
      `${name}: ${member}`,
    );
  }
}

const stored = create({ level: "store", solid: false });
const corrupt = Buffer.from(stored);
const offset = corrupt.indexOf(samples[0].bytes);
assert.ok(offset > 0);
corrupt[offset] ^= 1;
assert.throws(
  () => run(corrupt, { mode: "test" }),
  /CRC|checksum|integrity|hash/i,
);
assert.throws(
  () => run(corrupt, { mode: "extract", selected: ["漢字.txt"] }),
  /CRC|checksum|integrity|hash/i,
);
assert.throws(() => run(stored.subarray(0, 25), { mode: "inspect" }));
const split = await readFile(join(fixtureRoot, "../rar50/multivol.part1.rar"));
assert.throws(() => run(split, { mode: "inspect" }), /volume/i);
const badHeader = await readFile(join(fixtureRoot, "zero_head_size.rar"));
assert.throws(() => run(badHeader, { mode: "inspect" }));

function vint(value: number): Buffer {
  const bytes: number[] = [];
  do {
    const byte = value % 128;
    value = Math.floor(value / 128);
    bytes.push(byte | (value ? 128 : 0));
  } while (value);
  return Buffer.from(bytes);
}
function crc32(bytes: Uint8Array): Buffer {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  const result = Buffer.alloc(4);
  result.writeUInt32LE((crc ^ 0xffffffff) >>> 0);
  return result;
}
function rarBlock(payload: Buffer): Buffer {
  const header = Buffer.concat([vint(payload.length), payload]);
  return Buffer.concat([crc32(header), header]);
}
// Valid header checksums let these fixtures reach the application guards.
function craftedRar(names: string[], size = 1, compression = 0): Buffer {
  const content = Buffer.from("x");
  return Buffer.concat([
    Buffer.from("526172211a070100", "hex"),
    rarBlock(Buffer.from([1, 0, 0])),
    ...names.flatMap((name) => {
      const encodedName = Buffer.from(name);
      return [
        rarBlock(
          Buffer.concat([
            Buffer.from([2, 2, 1, 4]), // File, data present, one packed byte, CRC32 present.
            vint(size),
            vint(0),
            crc32(content),
            vint(compression),
            vint(0),
            vint(encodedName.length),
            encodedName,
          ]),
        ),
        content,
      ];
    }),
    rarBlock(Buffer.from([5, 0, 0])),
  ]);
}
assert.deepEqual(
  extracted(run(craftedRar(["safe.txt"]), { mode: "extract" })),
  [Buffer.from("x")],
);
for (const name of [
  "../escape",
  "..\\escape",
  "C:\\escape",
  "\\absolute",
  "a:stream",
  "NUL.txt",
]) {
  const bytes = craftedRar([name]);
  assert.equal(
    run(bytes, { mode: "inspect" }).rows![0].extractable,
    false,
    name,
  );
  assert.equal(run(bytes, { mode: "extract" }).files!.length, 0, name);
}
assert.equal(
  run(craftedRar(["file.txt", "FILE.txt"]), { mode: "extract" }).files!.length,
  1,
);
assert.throws(
  () => run(craftedRar(["huge"], 64 * 1024 * 1024 + 1), { mode: "inspect" }),
  /64 MiB/,
);
assert.throws(
  () =>
    run(craftedRar(["huge-dictionary"], 1, (1 << 7) | (10 << 10)), {
      mode: "inspect",
    }),
  /dictionar/i,
);
assert.throws(
  () =>
    run(craftedRar(Array.from({ length: 501 }, (_, i) => `file${i}`)), {
      mode: "inspect",
    }),
  /500/,
);
console.log(
  "RAR reading passed: native RAR5, RAR2/4, PPMd, solid streams, Unicode, passwords, BLAKE2sp, selected extraction, repacking and corrupt-data rejection.",
);
