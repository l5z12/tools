// SPDX-License-Identifier: AGPL-3.0-only
import { installSuiteWorker } from "./suite-worker-fixture";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Window } from "happy-dom";
import init, { run, suite_run } from "../public/wasm/l5z12_tools";
import {
  defaultFormat,
  formatOutput,
  outputSource,
  type OutputFormat,
} from "../src/output-format";
import {
  configureOutputFormat,
  clearOutputFormat,
  hasFormattedOutput,
} from "../src/output-format-ui";
import type { SuiteOptions, SuiteResult } from "../src/workbench-types";
import { decodeHex } from "../src/byte-input";

installSuiteWorker(suite_run);
await init({
  module_or_path: await readFile("public/wasm/l5z12_tools_bg.wasm"),
});
const bytes = new Uint8Array([0, 10, 171, 255]);
function format(overrides: Partial<OutputFormat>): Promise<string> {
  return formatOutput(bytes, { ...defaultFormat, ...overrides });
}

assert.equal(await format({ mode: "Hex" }), "000aabff");
assert.equal(
  await format({ mode: "Hex", uppercase: true, separator: "-" }),
  "00-0A-AB-FF",
);
assert.equal(
  await format({ mode: "Hex", separator: ":", groupBytes: 2 }),
  "000a:abff",
);
assert.equal(
  await format({ mode: "Hex", separator: " ", prefix: "0x", lineBytes: 8 }),
  "0x00 0x0a 0xab 0xff",
);
assert.equal(
  await format({ mode: "Hex", separator: "", prefix: "\\x" }),
  "\\x00\\x0a\\xab\\xff",
);
assert.equal(
  await format({ mode: "Base64" }),
  Buffer.from(bytes).toString("base64"),
);
assert.equal(
  await format({ mode: "Base64url", padding: false }),
  Buffer.from(bytes).toString("base64url"),
);
assert.equal(
  await format({ mode: "Binary" }),
  "00000000 00001010 10101011 11111111",
);
assert.equal(await format({ mode: "Octal" }), "000 012 253 377");
assert.equal(await format({ mode: "Decimal" }), "000 010 171 255");
assert.equal(
  await format({ mode: "C byte array", uppercase: true }),
  "{ 0x00, 0x0A, 0xAB, 0xFF }",
);
assert.equal(await format({ mode: "JSON byte array" }), "[0,10,171,255]");
await assert.rejects(() => format({ mode: "UTF-8" }), /valid UTF-8/);
assert.equal(
  await formatOutput(new Uint8Array([239, 187, 191, 65]), {
    ...defaultFormat,
    mode: "UTF-8",
  }),
  "\uFEFFA",
);
assert.equal(
  await formatOutput(new Uint8Array(), { ...defaultFormat, mode: "Base64" }),
  "",
);
await assert.rejects(
  () => format({ mode: "Hex", groupBytes: 0 }),
  /Group size/,
);

const longer = Uint8Array.from({ length: 100 }, (_, index) => index);
const wrapped = await formatOutput(longer, {
  ...defaultFormat,
  mode: "Base64",
  wrap: 76,
});
assert.equal(wrapped.split("\n")[0].length, 76);
assert.deepEqual(Buffer.from(wrapped, "base64"), Buffer.from(longer));
const grouped = await formatOutput(longer, {
  ...defaultFormat,
  mode: "Hex",
  groupBytes: 4,
  lineBytes: 16,
  separator: "-",
});
assert.equal(grouped.split("\n")[0], "00010203-04050607-08090a0b-0c0d0e0f");

function suite(
  id: string,
  input: string,
  options: Record<string, unknown>,
): SuiteResult {
  return JSON.parse(
    suite_run(id, input, new Uint8Array(), JSON.stringify(options)),
  );
}
for (const uppercase of [false, true]) {
  for (const separator of ["", " ", "-", ":", ", ", "\n"]) {
    for (const prefix of ["", "0x", "\\x"]) {
      const formatted = await format({
        mode: "Hex",
        uppercase,
        separator,
        prefix,
      });
      const decoded = suite("codec-byte-radix", formatted, {
        mode: "Decode",
        radix: "16",
      });
      assert.deepEqual(decodeHex(formatted), bytes);
      assert.deepEqual(
        Buffer.from(decoded.files![0].base64, "base64"),
        Buffer.from(bytes),
      );
    }
  }
}
assert.equal(run("hex-decode", "0x48-0X65:6C 6c,6F", ""), "Hello");
assert.throws(() => run("hex-decode", "4 8", ""));
for (const invalid of ["0x", "ab0x", "\\x 01", "--", "0x0x01"]) {
  assert.throws(() => run("hex-decode", invalid, ""));
  assert.throws(() => decodeHex(invalid));
}

const encoded = suite("codec-base32", "Hello", {});
assert.equal(
  Buffer.from(
    outputSource("codec-base32", encoded.text!, encoded).bytes,
  ).toString(),
  "Hello",
);
assert.equal(
  Buffer.from(outputSource("base64-encode", "SGVsbG8=", null).bytes).toString(),
  "Hello",
);
assert.equal(
  Buffer.from(outputSource("sha256", "ab".repeat(32), null).bytes).length,
  32,
);
const encrypted = suite("crypto-aes-gcm", "Hello", {
  key: "00".repeat(32),
  iv: "00".repeat(12),
});
const ciphertext = outputSource(
  "crypto-aes-gcm",
  encrypted.text!,
  encrypted,
).bytes;
const unpadded = await formatOutput(ciphertext, {
  ...defaultFormat,
  mode: "Base64url",
  padding: false,
});
assert.equal(
  suite("crypto-aes-gcm", unpadded, {
    key: "00".repeat(32),
    iv: "00".repeat(12),
    mode: "Decrypt",
    inputFormat: "Base64",
  }).text,
  "Hello",
);
const pair = (await rsaKeypair()).data as {
  publicKey: string;
  privateKey: string;
};
const rsaEncrypted = await rsaSuite("Hello", { key: pair.publicKey });
const rsaBytes = outputSource(
  "crypto-rsa-oaep",
  rsaEncrypted.text!,
  rsaEncrypted,
).bytes;
for (const mode of ["Hex", "Base64url"] as const) {
  const formatted = await formatOutput(rsaBytes, {
    ...defaultFormat,
    mode,
    uppercase: true,
    separator: "-",
    prefix: "0x",
    padding: false,
  });
  const decoded = await rsaSuite(formatted, {
    key: pair.privateKey,
    mode: "Decrypt",
    inputFormat: mode === "Hex" ? "Hex" : "Base64",
  });
  assert.equal(decoded.text, "Hello");
}
assert.equal(
  Buffer.from(
    outputSource("crypto-aes-gcm", encrypted.text!, encrypted).bytes,
  ).toString("hex"),
  JSON.parse(encrypted.text!).ciphertext,
);

const rc4 = suite("cipher-rc4", "Plaintext", { key: "4b6579" });
assert.equal(rc4.text, "bbf316e8d940af0ad3");
const rc4Decoded = suite("cipher-rc4", "BB-F3-16-E8-D9-40-AF-0A-D3", {
  key: "4b6579",
  mode: "Decrypt",
  inputFormat: "Hex",
});
assert.equal(rc4Decoded.text, "Plaintext");
const dropped = suite("cipher-rc4", "Hello", { key: "4b6579", drop: "3072" });
assert.equal(
  suite("cipher-rc4", dropped.text!, {
    key: "4b6579",
    drop: "3072",
    mode: "Decrypt",
    inputFormat: "Hex",
  }).text,
  "Hello",
);
assert.throws(() => suite("cipher-hill", "Hello", { matrix: "2 0 0 2" }));
assert.throws(() => suite("cipher-running-key", "Hello", { key: "A" }));
assert.throws(() =>
  suite("cipher-trifid", "Hello", { alphabet: "A".repeat(27) }),
);
assert.throws(() =>
  suite("cipher-adfgvx", "QZ", { mode: "Decrypt", transposition: "KEY" }),
);

const window = new Window();
Object.assign(globalThis, { document: window.document });
window.document.body.innerHTML = '<div id="output-format-controls"></div>';
let displayed = "00abff";
const render = (text: string) => {
  displayed = text;
};
configureOutputFormat("hex-encode", displayed, null, render);
async function change(key: string, value: string): Promise<void> {
  const control = window.document.getElementById(
    `output-format-${key}`,
  ) as unknown as HTMLSelectElement;
  control.value = value;
  control.dispatchEvent(
    new window.Event("change", { bubbles: true }) as unknown as Event,
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
}
await change("mode", "Hex");
await change("case", "Uppercase");
await change("separator", "Hyphens");
assert.equal(displayed, "00-AB-FF");
assert.equal(hasFormattedOutput(), true);
await change("mode", "UTF-8");
assert.equal(displayed, "00abff");
assert.equal(hasFormattedOutput(), false);
assert.ok(
  window.document
    .querySelector("[role=status]")
    ?.textContent?.includes("Showing Original"),
);
await change("mode", "Base64");
assert.equal(displayed, "AKv/");
await change("mode", "Original");
assert.equal(displayed, "00abff");
clearOutputFormat();
assert.equal(
  window.document.getElementById("output-format-controls")!.children.length,
  0,
);
assert.equal(hasFormattedOutput(), false);
console.log(
  "Output representations, 72 hex style round trips, exact ciphertext selection, RC4-drop, invalid cipher keys, and formatting controls passed.",
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
