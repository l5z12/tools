// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import init, { suite_run } from "../public/wasm/l5z12_tools";
import { devInspectTools } from "../src/lib/dev-inspect-tools";
import type { SuiteOptions, SuiteResult } from "../src/workbench-types";

await init({
  module_or_path: await readFile("public/wasm/l5z12_tools_bg.wasm"),
});
const run = (
  id: string,
  input: string,
  options: SuiteOptions = {},
  bytes = new Uint8Array(),
): SuiteResult =>
  JSON.parse(suite_run(`dev-${id}`, input, bytes, JSON.stringify(options)));
for (const tool of devInspectTools) {
  const options = Object.fromEntries(
    tool.fields.map((field) => [field.key, field.value ?? ""]),
  );
  assert.ok(run(tool.id.slice(4), tool.sample, options).kind, tool.id);
}
const json =
  '{"name":"Ada","active":true,"scores":[3,5,8],"large":18446744073709551615}';
for (const [encode, decode] of [
  ["json-msgpack", "msgpack-inspect"],
  ["json-cbor", "cbor-inspect"],
]) {
  const encoded = run(encode, json);
  const tree = run(decode, encoded.text!).data as {
    entries: { key: { value: string }; value: { value: string } }[];
  };
  assert.equal(
    tree.entries.find((item) => item.key.value === "large")!.value.value,
    "18446744073709551615",
  );
  const bytes = new Uint8Array(Buffer.from(encoded.files![0].base64, "base64"));
  assert.deepEqual(
    run(decode, "ignored", { fileProvided: true }, bytes).data,
    tree,
  );
  assert.throws(() => run(decode, encoded.text! + "00"));
}
assert.equal(run("json-msgpack", '[1,true,"a"]').text, "9301c3a161");
assert.equal(run("json-cbor", '[1,true,"a"]').text, "8301f56161");
assert.deepEqual(run("msgpack-inspect", "d401ff").data, {
  type: "extension",
  tag: 1,
  hex: "ff",
});
assert.deepEqual(run("cbor-inspect", "f7").data, { type: "undefined" });
assert.deepEqual(run("cbor-inspect", "f6").data, { type: "null" });
assert.deepEqual(run("cbor-inspect", "e1").data, { type: "simple", value: 1 });
assert.deepEqual(run("cbor-inspect", "5f4201024103ff").data, {
  type: "bytes",
  hex: "010203",
});
assert.deepEqual(run("cbor-inspect", "9f01f7ff").data, {
  type: "array",
  items: [{ type: "integer", value: "1" }, { type: "undefined" }],
});
assert.equal((run("cbor-inspect", "c241ff").data as { tag: string }).tag, "2");
for (const invalid of ["ff", "bf01ff", "63ff", "9f", "81".repeat(70) + "00"])
  assert.throws(() => run("cbor-inspect", invalid));
assert.throws(() => run("msgpack-inspect", "c1"));
const proto = run("protobuf", "0896011203416461").rows!;
assert.deepEqual(proto[0].value, { unsignedVarint: "150" });
assert.deepEqual(proto[1].value, {
  length: 3,
  hex: "416461",
  utf8Candidate: "Ada",
});
assert.equal(proto[1].offset, 3);
assert.deepEqual(run("protobuf", "08ffffffffffffffffff01").rows![0].value, {
  unsignedVarint: "18446744073709551615",
});
for (const invalid of [
  "00",
  "0e",
  "128001",
  "0b14",
  "0b",
  "0880808080808080808002",
])
  assert.throws(() => run("protobuf", invalid));
assert.equal(run("protobuf", "0b10010c").rows!.length, 3);
const keys = run(
  "json-keys",
  '{"a/b":[{"x":1,"\\u0078":2}],"~":0,"~":1}',
).rows!;
assert.deepEqual(
  keys.map((row) => row.pointer),
  ["/a~1b/0/x", "/~0"],
);
assert.equal(run("json-keys", '{"a":{"x":1},"b":{"x":2}}').rows!.length, 0);
assert.throws(() => run("json-keys", '{"a":1} garbage'));
assert.deepEqual(
  JSON.parse(
    run("merge-patch", '{"a":1,"b":{"x":1,"y":2},"c":[1,2]}', {
      patch: '{"a":null,"b":{"x":3},"c":[4]}',
    }).text!,
  ),
  { b: { x: 3, y: 2 }, c: [4] },
);
assert.equal(run("merge-patch", '{"a":1}', { patch: "null" }).text, "null");
const sse = run(
  "sse",
  ": comment\r\nid: 7\r\nevent: update\r\ndata: one\r\ndata: two\r\n\r\ndata:\r\n\r\nid:\r\ndata: reset\r\n\r\ndata: pending\n",
);
assert.equal(sse.rows!.length, 3);
assert.deepEqual(sse.rows![0], {
  data: "one\ntwo",
  event: "update",
  id: "7",
  retryMs: null,
});
assert.equal(sse.rows![1].id, "7");
assert.equal(sse.rows![1].data, "");
assert.equal(sse.rows![2].id, "");
assert.equal(
  (sse.data as { undispatchedDataAtEnd: boolean }).undispatchedDataAtEnd,
  true,
);
assert.equal(run("sse", "data: no dispatch\n").rows!.length, 0);
const patch = devInspectTools.find(
  (tool) => tool.id === "dev-git-patch",
)!.sample;
const stats = run("git-patch", patch).rows![0];
assert.equal(stats.addedLines, 2);
assert.equal(stats.removedLines, 1);
assert.throws(() => run("git-patch", patch.replace("+extra\n", "")));
const added =
  "diff --git a/a b/a\nnew file mode 100644\n--- /dev/null\n+++ b/a\n@@ -0,0 +1 @@\n+++content\n";
assert.equal(run("git-patch", added).rows![0].addedLines, 1);
assert.equal(
  (run("permissions", "4755").data as { symbolic: string }).symbolic,
  "rwsr-xr-x",
);
assert.equal(
  (run("permissions", "1644").data as { symbolic: string }).symbolic,
  "rw-r--r-T",
);
assert.throws(() => run("permissions", "888"));
const regularMap = {
  version: 3,
  sources: ["a.ts"],
  sourcesContent: ["let a = 1;"],
  names: [],
  mappings: "AAAA",
};
assert.equal(
  (run("source-map", JSON.stringify(regularMap)).data as { source: string })
    .source,
  "a.ts",
);
assert.equal(
  (
    run("source-map", JSON.stringify(regularMap), { line: "2" }).data as {
      mapped: boolean;
    }
  ).mapped,
  false,
);
const indexed = {
  version: 3,
  sections: [{ offset: { line: 3, column: 5 }, map: regularMap }],
};
assert.equal(
  (
    run("source-map", JSON.stringify(indexed), { line: "4", column: "5" })
      .data as { originalLine: number }
  ).originalLine,
  1,
);
const har = JSON.parse(
  devInspectTools.find((tool) => tool.id === "dev-har")!.sample,
);
har.log.entries.push({
  time: 200,
  request: { method: "POST", url: "https://example.com/error" },
  response: { status: 500, bodySize: -1, content: {} },
});
const analysis = run("har", JSON.stringify(har));
assert.equal(analysis.rows![0].status, 500);
assert.equal(analysis.rows![0].bodyBytes, null);
assert.equal((analysis.data as { failedRequests: number }).failedRequests, 1);
console.log(
  "Developer inspectors passed: 12 samples, binary vectors and precision, CBOR types, malformed inputs, Protobuf groups, duplicate keys, merge patch, SSE boundaries, Git hunks, and source-map offsets.",
);
