// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { Window } from "happy-dom";
import init, { suite_run } from "../public/wasm/l5z12_tools";
import { utilityTools } from "../src/lib/utility-tools";
import { tools } from "../src/lib/catalog";
import { prepareBinaryComparison, renderUtilityChart } from "../src/utility-ui";
import { configureSuite, renderSuite, clearSuite } from "../src/workbench-ui";
import type { SuiteOptions, SuiteResult } from "../src/workbench-types";

await init({
  module_or_path: await readFile("public/wasm/l5z12_tools_bg.wasm"),
});
function run(
  id: string,
  input = "",
  options: SuiteOptions = {},
  bytes = new Uint8Array(),
): SuiteResult {
  return JSON.parse(
    suite_run(`util-${id}`, input, bytes, JSON.stringify(options)),
  );
}
const data = (result: SuiteResult) => result.data as Record<string, unknown>;
const fileText = (result: SuiteResult, index = 0) =>
  Buffer.from(result.files![index].base64, "base64").toString();
assert.equal(utilityTools.length, 12);
for (const tool of utilityTools)
  assert.equal(tools.filter((entry) => entry.id === tool.id).length, 1);

const allBytes = Uint8Array.from({ length: 256 }, (_, index) => index);
const fingerprint = run(
  "file-fingerprint",
  "",
  { fileProvided: true },
  allBytes,
);
assert.equal(data(fingerprint).entropyBitsPerByte, 8);
assert.equal(
  data(fingerprint).sha256,
  createHash("sha256").update(allBytes).digest("hex"),
);
assert.equal(fingerprint.rows!.length, 256);
assert.equal(
  fingerprint.chart!.bars.reduce((sum, bar) => sum + bar.value, 0),
  256,
);
assert.equal(JSON.parse(fileText(fingerprint)).rows.length, 256);
assert.equal(data(run("file-fingerprint")).entropyBitsPerByte, 0);
assert.equal(
  data(
    run(
      "file-fingerprint",
      "",
      { fileProvided: true },
      Buffer.from("\x89PNG\r\n\x1a\n", "binary"),
    ),
  ).signatureHint,
  "PNG",
);

const strings = run(
  "binary-strings",
  "",
  { fileProvided: true },
  Buffer.from("\0hello\0world\0"),
);
assert.deepEqual(
  strings.rows!.map((row) => [row.offset, row.text]),
  [
    [1, "hello"],
    [7, "world"],
  ],
);
const utf16 = run(
  "binary-strings",
  "",
  { fileProvided: true, encoding: "UTF-16LE" },
  Buffer.from([255, 65, 0, 66, 0, 67, 0, 68, 0]),
);
assert.deepEqual(
  utf16.rows!.map((row) => [row.offset, row.text]),
  [[1, "ABCD"]],
);
assert.equal(
  run(
    "binary-strings",
    "",
    { fileProvided: true, encoding: "UTF-16BE" },
    Buffer.from([255, 0, 65, 0, 66, 0, 67, 0, 68]),
  ).rows![0].text,
  "ABCD",
);
const longString = run("binary-strings", "A".repeat(5000));
assert.equal(longString.rows![0].characters, 5000);
assert.equal(longString.rows![0].previewTruncated, true);
assert.throws(() => run("binary-strings", "test", { minimum: "0" }));

const comparison = await prepareBinaryComparison([
  new File([new Uint8Array([1, 2, 3])], "before.bin"),
  new File([new Uint8Array([1, 9, 3, 4])], "after.bin"),
]);
const differences = run(
  "binary-diff",
  "",
  comparison.options,
  comparison.bytes,
);
assert.equal(data(differences).changedPositions, 2);
assert.deepEqual(
  differences.rows!.map((row) => [row.start, row.endExclusive]),
  [
    [1, 2],
    [3, 4],
  ],
);
assert.equal(differences.rows![1].beforeHex, "");
assert.equal(
  data(
    run(
      "binary-diff",
      "",
      { fileProvided: true, split: 2 },
      new Uint8Array([1, 2, 1, 2]),
    ),
  ).identical,
  true,
);
await assert.rejects(prepareBinaryComparison([]));
await assert.rejects(prepareBinaryComparison([new File([], "only.bin")]));
await assert.rejects(
  prepareBinaryComparison([
    new File([new Uint8Array(8 * 1024 * 1024 + 1)], "large"),
    new File([], "empty"),
  ]),
);
const floats = run("byte-order", "00 00 80 3f").rows!;
assert.equal(
  floats.find((row) => row.bits === 32 && row.byteOrder === "Little-endian")!
    .float,
  "1",
);
const integers = run("byte-order", "ff ff ff ff ff ff ff ff").rows!;
assert.equal(
  integers.find((row) => row.bits === 64)!.unsigned,
  "18446744073709551615",
);
assert.equal(integers.find((row) => row.bits === 64)!.signed, "-1");
assert.throws(() => run("byte-order", "00", { offset: "1" }));

for (const [operation, expected] of Object.entries({
  Intersection: "Beta",
  Union: "Alpha\nBeta\nGamma",
  "Only first": "Alpha",
  "Only second": "Gamma",
  "Symmetric difference": "Alpha\nGamma",
})) {
  assert.equal(
    run("line-sets", " Alpha \nBeta\nalpha\n", {
      other: "beta\nGamma",
      operation,
      ignoreCase: true,
    }).text,
    expected,
  );
}
const sizes = run("json-size", '{ "a/b~": "🌍", "empty": [] }');
assert.equal(
  sizes.rows!.find((row) => row.pointer === "/a~1b~0")!.valueBytes,
  6,
);
assert.equal(
  data(sizes).minifiedBytes,
  Buffer.byteLength('{"a/b~":"🌍","empty":[]}'),
);
assert.throws(() => run("json-size", JSON.stringify(Array(5001).fill(1))));
const redacted = run(
  "json-redact",
  '{"Password":{"nested":"private"},"passwordHint":"keep","users":[{"TOKEN":"secret"}]}',
);
assert.deepEqual(JSON.parse(redacted.text!), {
  Password: "[REDACTED]",
  passwordHint: "keep",
  users: [{ TOKEN: "[REDACTED]" }],
});
assert.equal(data(redacted).replacedFields, 2);
assert.equal(fileText(redacted), redacted.text);

const csv = run("csv-profile", 'same,same\n1,"two\nlines"\n,3\n1,NaN');
assert.equal(data(csv).rows, 3);
assert.equal(csv.rows![0].missing, 1);
assert.equal(csv.rows![0].distinctIncludingEmpty, 2);
assert.equal(csv.rows![1].numericValues, 1);
assert.equal(csv.rows![1].numericMinimum, 3);
assert.equal(
  run("csv-profile", "a;b\n1;2", { delimiter: "Semicolon" }).rows!.length,
  2,
);
assert.throws(() => run("csv-profile", "a,b\n1"));
const logs = run(
  "log-patterns",
  "2026-09-14T08:00:00Z ERROR user 42 failed\n\n2026-09-14T08:00:01Z ERROR user 87 failed",
);
assert.equal(logs.rows!.length, 1);
assert.equal(logs.rows![0].occurrences, 2);
assert.equal(logs.rows![0].lastLine, 3);
assert.equal(logs.rows![0].pattern, "<time> ERROR user <number> failed");
assert.throws(() =>
  run("log-patterns", "", { fileProvided: true }, new Uint8Array([255])),
);

const cleaned = run(
  "clean-urls",
  "https://example.com/?q=a&q=b&UTM_source=mail&fbclid=123#here",
  { fragment: true },
);
assert.equal(cleaned.rows![0].cleaned, "https://example.com/?q=a&q=b");
assert.equal(cleaned.rows![0].fragmentRemoved, true);
assert.equal(fileText(cleaned), cleaned.rows![0].cleaned);
assert.equal(
  run("clean-urls", "https://example.com/?q=a%20b#keep").rows![0].cleaned,
  "https://example.com/?q=a%20b#keep",
);
assert.throws(() => run("clean-urls", "javascript:alert(1)"));
assert.equal(
  run("ip-range", "0.0.0.0", { end: "255.255.255.255" }).rows![0].cidr,
  "0.0.0.0/0",
);
assert.deepEqual(
  run("ip-range", "10.0.0.1", { end: "10.0.0.6" }).rows!.map((row) => row.cidr),
  ["10.0.0.1/32", "10.0.0.2/31", "10.0.0.4/31", "10.0.0.6/32"],
);
assert.throws(() => run("ip-range", "10.0.0.2", { end: "10.0.0.1" }));

const srt = "1\n00:00:01,000 --> 00:00:03,500\nHello 🌍\n";
const shifted = run("subtitle-shift", srt, { shift: "500" });
assert.ok(shifted.text!.includes("00:00:01,500 --> 00:00:04,000"));
assert.equal(run("subtitle-shift", shifted.text!, { shift: "-500" }).text, srt);
assert.equal(fileText(shifted), shifted.text);
assert.equal(
  run(
    "subtitle-shift",
    "",
    { shift: "500", fileProvided: true },
    Buffer.from("\ufeff" + srt),
  ).text,
  shifted.text,
);
assert.throws(() => run("subtitle-shift", srt, { shift: "-1001" }));
const vtt =
  "WEBVTT\n\n\ncue-id\n00:01.000 --> 00:03.000 align:start position:20%\nHello\n";
assert.ok(
  run("subtitle-shift", vtt, { shift: "100" }).text!.includes(
    "00:00:01.100 --> 00:00:03.100 align:start position:20%",
  ),
);
assert.throws(() =>
  run("subtitle-shift", vtt.replace("Hello", "<00:02.000>Hello")),
);
assert.throws(() => run("subtitle-shift", "WEBVTT\n\nNOTE hi\n\n" + srt));

const window = new Window();
Object.assign(globalThis, {
  document: window.document,
  HTMLInputElement: window.HTMLInputElement,
});
window.document.body.innerHTML =
  '<div id="suite-controls"></div><div id="file-field"></div><div id="animation-options"></div><textarea id="input"></textarea><div class="field-header"></div><div id="result"></div>';
const container = window.document.getElementById(
  "result",
) as unknown as HTMLElement;
for (const tool of utilityTools) {
  configureSuite(tool.id, () => {});
  assert.equal(
    window.document.querySelectorAll("[data-key]").length,
    tool.fields.length,
    tool.id,
  );
  if (tool.inputMode) assert.ok(window.document.getElementById("suite-file"));
  if (tool.id === "util-binary-diff")
    assert.equal(
      (
        window.document.getElementById(
          "suite-file",
        ) as unknown as HTMLInputElement
      ).multiple,
      true,
    );
  const options = Object.fromEntries(
    tool.fields.map((field) => [
      field.key,
      field.type === "checkbox" ? field.value === "true" : field.value,
    ]),
  );
  const result = run(tool.id.slice(5), tool.sample, options);
  renderSuite(container, result);
  assert.ok(container.textContent!.length > 0, tool.id);
  assert.ok(container.querySelector("a[download]"), tool.id);
  clearSuite();
}
container.replaceChildren();
renderUtilityChart(container, fingerprint.chart!);
assert.equal(container.querySelectorAll("meter").length, 16);
assert.ok(
  container
    .querySelector("meter")!
    .getAttribute("aria-label")!
    .includes("16 bytes"),
);
console.log(
  "12 utilities passed: binary/data fixtures, exact downloads, CSV edge cases, subtitle round trips, CIDR boundaries, file selection, controls, tables, and charts.",
);
