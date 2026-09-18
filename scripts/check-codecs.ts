// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import {
  createCipheriv,
  pbkdf2Sync,
  hkdfSync,
  publicEncrypt,
  privateDecrypt,
  constants,
} from "node:crypto";
import { Window } from "happy-dom";
import init, { suite_run } from "../public/wasm/l5z12_tools";
import {
  codecTools,
  cryptoTools,
  codecIds,
  modernSpecs,
} from "../src/lib/codec-tools";
import { tools } from "../src/lib/catalog";
import { prepareCrypto } from "../src/crypto-runtime";
import type { SuiteOptions, SuiteResult } from "../src/workbench-types";
await init({
  module_or_path: await readFile("public/wasm/l5z12_tools_bg.wasm"),
});
const run = (
  id: string,
  input: string,
  options: SuiteOptions = {},
  bytes: Uint8Array = new Uint8Array(),
): SuiteResult =>
  JSON.parse(suite_run(id, input, bytes, JSON.stringify(options)));
const contents = (r: SuiteResult, n = 0) =>
  Buffer.from(r.files![n].base64, "base64");
const defaults = (t: (typeof codecTools)[number]) =>
  Object.fromEntries(t.fields.map((f) => [f.key, f.value ?? ""]));
const exercised = new Set<string>();
for (const t of codecTools) {
  const o = defaults(t);
  const sample = t.id === "codec-z85" ? "12345678" : t.sample;
  const r = run(t.id, sample, o);
  assert.equal(typeof r.text, "string", t.id);
  exercised.add(t.id);
  if (t.id.startsWith("codec-")) {
    const d = run(t.id, r.text!, { ...o, mode: "Decode" });
    assert.equal(contents(d).toString(), sample, t.id);
  }
}
const binary = Buffer.from([0, 0, 1, 2, 127, 128, 255, 13, 10, 32, 65, 66]);
const largeBytes = Buffer.alloc(300_000, 171);
const largeEncoded = run(
  "codec-byte-radix",
  "",
  { fileProvided: true, radix: "2" },
  largeBytes,
);
assert.ok(largeEncoded.text!.length > 2_000_000);
assert.deepEqual(
  contents(
    run(
      "codec-byte-radix",
      "",
      { fileProvided: true, mode: "Decode", radix: "2" },
      contents(largeEncoded),
    ),
  ),
  largeBytes,
);
const previewBytes = Buffer.alloc(5000, 255);
const preview = run("codec-base64-bytes", previewBytes.toString("base64"), {
  mode: "Decode",
});
assert.deepEqual(contents(preview), previewBytes);
assert.equal((preview.data as { hex: string }).hex.length, 8192);
assert.match((preview.data as { preview: string }).preview, /4096/);
for (const t of codecTools.filter((t) => t.id.startsWith("codec-"))) {
  const o = defaults(t);
  const e = run(t.id, "ignored text", { ...o, fileProvided: true }, binary);
  const d = run(t.id, e.text!, { ...o, mode: "Decode" });
  assert.deepEqual(contents(d), binary, t.id);
}
for (const variant of ["Standard", "Hex"])
  for (const padding of ["Padded", "Unpadded"]) {
    const o = { variant, padding };
    const r = run("codec-base32", "foobar", o);
    assert.equal(
      r.text,
      variant === "Hex"
        ? "CPNMUOJ1E8" + (padding === "Padded" ? "======" : "")
        : "MZXW6YTBOI" + (padding === "Padded" ? "======" : ""),
    );
    assert.equal(
      contents(
        run("codec-base32", r.text!, { ...o, mode: "Decode" }),
      ).toString(),
      "foobar",
    );
  }
for (const variant of ["Bitcoin", "Flickr", "Ripple"]) {
  const e = run("codec-base58", "", { variant, fileProvided: true }, binary);
  assert.deepEqual(
    contents(run("codec-base58", e.text!, { variant, mode: "Decode" })),
    binary,
  );
}
for (const variant of ["Standard", "URL-safe"])
  for (const padding of ["Padded", "Unpadded"]) {
    const e = run(
      "codec-base64-bytes",
      "",
      { variant, padding, fileProvided: true },
      binary.subarray(0, 8),
    );
    const expected = binary
      .subarray(0, 8)
      .toString(variant === "Standard" ? "base64" : "base64url");
    assert.equal(
      e.text,
      padding === "Padded"
        ? expected.padEnd(Math.ceil(expected.length / 4) * 4, "=")
        : expected.replace(/=+$/, ""),
    );
    assert.deepEqual(
      contents(
        run("codec-base64-bytes", e.text!, {
          variant,
          padding,
          mode: "Decode",
        }),
      ),
      binary.subarray(0, 8),
    );
  }
assert.equal(
  contents(
    run("codec-percent-bytes", "a+b%20c", { mode: "Decode" }),
  ).toString(),
  "a+b c",
);
assert.equal(
  contents(
    run("codec-data-uri", "data:text/plain,Hello%20%F0%9F%8C%8D", {
      mode: "Decode",
    }),
  ).toString(),
  "Hello 🌍",
);
assert.equal(
  run("cipher-bacon", "J V", { variant: "24 letters (I/J, U/V)" }).text,
  "ABAAA BAABB",
);
assert.equal(
  run("cipher-bacon", "ABAAA BAABB", {
    mode: "Decrypt",
    variant: "24 letters (I/J, U/V)",
  }).text,
  "IU",
);
for (const [id, opts, input] of [
  ["cipher-affine", { a: "2" }, "hello"],
  ["cipher-vigenere", { key: "" }, "hello"],
  ["cipher-substitution", { alphabet: "AAAA" }, "hello"],
  ["cipher-playfair", { mode: "Decrypt" }, "ABC"],
  ["cipher-bacon", { mode: "Decrypt" }, "BBBBB"],
  ["cipher-polybius", { mode: "Decrypt" }, "66"],
  ["cipher-morse", {}, "🙂"],
  ["cipher-rail-fence", { rails: "1" }, "hello"],
] as [string, SuiteOptions, string][]) {
  assert.throws(() => run(id, input, opts), id);
}
const payload = Buffer.from("binary \0 hello 🌍\n");
for (const [name, _, keyLength, nonceLength] of modernSpecs) {
  const id = "crypto-" + name;
  exercised.add(id);
  const key = Buffer.alloc(keyLength, 7),
    iv = Buffer.alloc(nonceLength, 3);
  const authenticated = nonceLength === 12 || nonceLength === 24;
  const o = {
    key: key.toString("hex"),
    iv: iv.toString("hex"),
    aad: authenticated ? "context" : "",
    fileProvided: true,
  };
  const e = run(id, "", o, payload);
  const envelope = JSON.parse(e.text!);
  assert.ok(!("key" in envelope));
  assert.equal(envelope.iv, iv.toString("hex"));
  assert.deepEqual(
    contents(run(id, e.text!, { key: o.key, mode: "Decrypt" })),
    payload,
  );
  assert.deepEqual(
    contents(
      run(
        id,
        "",
        {
          key: o.key,
          mode: "Decrypt",
          fileProvided: true,
          inputFormat: "Envelope",
        },
        contents(e),
      ),
    ),
    payload,
  );
  assert.deepEqual(
    contents(run(id, "", { ...o, mode: "Decrypt" }, contents(e, 1))),
    payload,
  );
  assert.deepEqual(
    contents(
      run(id, envelope.ciphertext, {
        ...o,
        fileProvided: false,
        mode: "Decrypt",
        inputFormat: "Hex",
      }),
    ),
    payload,
  );
  if (authenticated) {
    for (const field of ["ciphertext", "aad", "iv"]) {
      const bad = { ...envelope, [field]: "01" + envelope[field].slice(2) };
      assert.throws(() =>
        run(id, JSON.stringify(bad), { key: o.key, mode: "Decrypt" }),
      );
    }
    assert.throws(() =>
      run(id, e.text!, {
        key: Buffer.alloc(keyLength, 6).toString("hex"),
        mode: "Decrypt",
      }),
    );
  }
  assert.throws(() =>
    run(id, JSON.stringify({ ...envelope, algorithm: "crypto-unknown" }), {
      key: o.key,
      mode: "Decrypt",
    }),
  );
  assert.throws(() =>
    run(id, "hello", { ...o, iv: "00", fileProvided: false }),
  );
  if (!authenticated)
    assert.throws(() =>
      run(id, "hello", { ...o, aad: "unsupported", fileProvided: false }),
    );
  const fresh = prepareCrypto(id, { mode: "Encrypt", iv: "" });
  const another = prepareCrypto(id, { mode: "Encrypt", iv: "" });
  assert.equal(String(fresh.iv).length, nonceLength * 2);
  assert.notEqual(fresh.iv, another.iv);
  assert.equal(prepareCrypto(id, { mode: "Decrypt", iv: "" }).iv, "");
}
for (const mode of ["gcm", "cbc", "ctr"])
  for (const size of [16, 24, 32]) {
    const key = Buffer.alloc(size, 9),
      iv = Buffer.alloc(mode === "gcm" ? 12 : 16, 4);
    const id = "crypto-aes-" + mode;
    const c = createCipheriv(`aes-${size * 8}-${mode}`, key, iv);
    if (mode === "gcm")
      (
        c as ReturnType<typeof createCipheriv> & { setAAD: (b: Buffer) => void }
      ).setAAD(Buffer.from("context"));
    const encrypted = Buffer.concat([
      c.update(payload),
      c.final(),
      ...(mode === "gcm"
        ? [(c as unknown as { getAuthTag: () => Buffer }).getAuthTag()]
        : []),
    ]);
    const r = run(
      id,
      "",
      {
        key: key.toString("hex"),
        iv: iv.toString("hex"),
        aad: mode === "gcm" ? "context" : "",
        fileProvided: true,
      },
      payload,
    );
    assert.deepEqual(contents(r, 1), encrypted, id + " " + size);
  }
for (const [id, algorithm, n, k] of [
  ["crypto-chacha20-poly1305", "chacha20-poly1305", 12, 32],
  ["crypto-3des-cbc", "des-ede3-cbc", 8, 24],
] as const) {
  const key = Buffer.alloc(k, 9),
    iv = Buffer.alloc(n, 4);
  // Bun on Windows lacks these OpenSSL ciphers; use Node for this independent reference.
  const raw = Buffer.from(
    execFileSync(
      "node",
      [
        "--input-type=module",
        "-e",
        `
    import {createCipheriv} from 'node:crypto';
    import {readFileSync} from 'node:fs';
    const {algorithm,key,iv,payload}=JSON.parse(readFileSync(0,'utf8'));
    const c=createCipheriv(algorithm,Buffer.from(key,'hex'),Buffer.from(iv,'hex'));
    process.stdout.write(Buffer.concat([c.update(Buffer.from(payload,'hex')),c.final(),...(algorithm==='chacha20-poly1305'?[c.getAuthTag()]:[])]).toString('hex'));
  `,
      ],
      {
        input: JSON.stringify({
          algorithm,
          key: key.toString("hex"),
          iv: iv.toString("hex"),
          payload: payload.toString("hex"),
        }),
        encoding: "utf8",
      },
    ),
    "hex",
  );
  assert.deepEqual(
    contents(
      run(
        id,
        "",
        {
          fileProvided: true,
          key: key.toString("hex"),
          iv: iv.toString("hex"),
        },
        payload,
      ),
      1,
    ),
    raw,
  );
}
const salt = Buffer.from("salt for tests");
// Raw ciphertext beginning with a JSON delimiter is still binary input.
const rawDelimiter = run(
  "crypto-aes-ctr",
  "",
  {
    key: "00".repeat(16),
    iv: "00".repeat(16),
    mode: "Decrypt",
    fileProvided: true,
  },
  Buffer.from("{"),
);
assert.equal(contents(rawDelimiter).length, 1);
const ikm = Buffer.from("input key material");
const pb = run("crypto-pbkdf2", "password", {
  salt: salt.toString("hex"),
  iterations: "1000",
  length: "48",
});
assert.deepEqual(
  contents(pb),
  pbkdf2Sync("password", salt, 1000, 48, "sha256"),
);
exercised.add("crypto-pbkdf2");
const hk = run("crypto-hkdf", ikm.toString("hex"), {
  salt: salt.toString("hex"),
  info: "context",
  length: "48",
});
assert.deepEqual(
  contents(hk),
  Buffer.from(hkdfSync("sha256", ikm, salt, "context", 48)),
);
exercised.add("crypto-hkdf");
assert.throws(() =>
  run("crypto-pbkdf2", "password", { salt: "00", iterations: "2000001" }),
);
assert.throws(() => run("crypto-hkdf", "01", { length: "0" }));
const pair = (await rsaKeypair()).data as {
  publicKey: string;
  privateKey: string;
};
const encrypted = await rsaSuite("Hello 🌍", { key: pair.publicKey });
const raw = contents(encrypted, 1);
assert.equal(
  privateDecrypt(
    {
      key: pair.privateKey,
      padding: constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: "sha256",
    },
    raw,
  ).toString(),
  "Hello 🌍",
);
const nodeEncrypted = publicEncrypt(
  {
    key: pair.publicKey,
    padding: constants.RSA_PKCS1_OAEP_PADDING,
    oaepHash: "sha256",
  },
  payload,
);
assert.deepEqual(
  contents(
    await rsaSuite(nodeEncrypted.toString("hex"), {
      key: pair.privateKey,
      mode: "Decrypt",
      inputFormat: "Hex",
    }),
  ),
  payload,
);
assert.equal(
  contents(
    await rsaSuite(encrypted.text!, { key: pair.privateKey, mode: "Decrypt" }),
  ).toString(),
  "Hello 🌍",
);
await assert.rejects(
  () => rsaSuite("x".repeat(191), { key: pair.publicKey }),
  /190/,
);
await assert.rejects(() =>
  rsaSuite(encrypted.text!, { key: pair.publicKey, mode: "Decrypt" }),
);
await assert.rejects(() =>
  rsaSuite(JSON.stringify({ ...JSON.parse(encrypted.text!), hash: "SHA-1" }), {
    key: pair.privateKey,
    mode: "Decrypt",
  }),
);
exercised.add("crypto-rsa-oaep");
const window = new Window();
const document = window.document;
Object.assign(globalThis, {
  window,
  document,
  HTMLInputElement: window.HTMLInputElement,
  HTMLTextAreaElement: window.HTMLTextAreaElement,
  HTMLSelectElement: window.HTMLSelectElement,
});
document.body.innerHTML =
  '<div class="field-header"></div><textarea id="input"></textarea><div id="file-field"></div><div id="animation-options"></div><div id="suite-controls"></div><div id="result-view"></div>';
const { configureSuite, renderSuite, clearSuite } =
  await import("../src/workbench-ui");
let changes = 0;
for (const t of [...codecTools, ...cryptoTools]) {
  configureSuite(t.id, () => changes++);
  for (const f of t.fields)
    assert.ok(document.getElementById("suite-" + f.key), t.id + " " + f.key);
}
configureSuite("crypto-aes-gcm", () => changes++);
Array.from(document.querySelectorAll("button"))
  .find((b) => b.textContent === "Generate random key")!
  .click();
assert.match(
  (document.getElementById("suite-key") as unknown as HTMLInputElement).value,
  /^[a-f0-9]{64}$/,
);
assert.ok(changes);
const resultView = document.getElementById(
  "result-view",
) as unknown as HTMLElement;
const uiEncrypted = run("crypto-aes-gcm", "Hello", {
  key: "00".repeat(32),
  iv: "00".repeat(12),
});
renderSuite(resultView, uiEncrypted);
const transfer = Array.from(document.querySelectorAll("button")).find(
  (b) => b.textContent === "Use ciphertext for decryption",
)!;
transfer.click();
assert.equal(
  (document.getElementById("input") as unknown as HTMLTextAreaElement).value,
  uiEncrypted.text!,
);
assert.equal(
  (document.getElementById("suite-mode") as unknown as HTMLSelectElement).value,
  "Decrypt",
);
assert.equal(document.querySelectorAll("#result-view a[download]").length, 2);
clearSuite();
configureSuite("codec-byte-radix", () => changes++);
renderSuite(resultView, largeEncoded);
assert.equal(resultView.querySelector("pre code")!.textContent!.length, 65536);
assert.ok(resultView.textContent?.includes("Save the result"));
assert.equal(resultView.querySelectorAll("a[download]").length, 1);
clearSuite();
assert.deepEqual(exercised, codecIds);
assert.equal(new Set(tools.map((t) => t.id)).size, tools.length);
for (const id of codecIds) assert.ok(tools.some((tool) => tool.id === id));
console.log(
  `All ${exercised.size} encoder/cipher tools passed: binary round trips, variants, independent encryption and KDF references, tamper rejection, RSA interoperability, random nonce generation, and UI controls. ${tools.length} total tools.`,
);

async function rsaKeypair(): Promise<SuiteResult> {
  return JSON.parse(suite_run("crypto-keypair", "", new Uint8Array(), "{}"));
}
async function rsaSuite(
  input: string,
  options: SuiteOptions,
): Promise<SuiteResult> {
  return JSON.parse(
    suite_run(
      "crypto-rsa-oaep",
      input,
      new Uint8Array(),
      JSON.stringify(options),
    ),
  );
}
