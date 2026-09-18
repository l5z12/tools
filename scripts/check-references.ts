// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { Window } from "happy-dom";
import init, {
  reference_load,
  reference_search,
  reference_decode,
} from "../public/wasm/l5z12_tools";
import type { ReferenceDataset } from "../src/reference-types";
import type { SuiteResult } from "../src/workbench-types";
import { referenceTools } from "../src/lib/reference-tools";
import { tools } from "../src/lib/catalog";
await init({
  module_or_path: await readFile("public/wasm/l5z12_tools_bg.wasm"),
});
const counts: Record<string, number> = {
  microsoft: 7431,
  ldap: 99,
  http: 75,
  dns: 154,
  mime: 2348,
  ports: 14535,
};
const datasets = new Map<string, ReferenceDataset>();
const manifest = JSON.parse(
  await readFile("public/data/references/manifest.json", "utf8"),
) as { id: string; count: number; sha256: string }[];
for (const [key, count] of Object.entries(counts)) {
  const raw = await readFile(`public/data/references/${key}.json`, "utf8");
  const data = JSON.parse(raw) as ReferenceDataset;
  assert.equal(data.rows.length, count);
  assert.equal(
    manifest.find((m) => m.id === key)?.sha256,
    createHash("sha256").update(raw).digest("hex"),
  );
  reference_load(key, raw);
  datasets.set(key, data);
  for (const row of data.rows) {
    assert.ok(data.sources[row.source]);
    assert.ok(row.name);
    if (row.value !== undefined)
      assert.ok(
        Number.isInteger(row.value) &&
          row.value >= 0 &&
          row.value <= 0xffffffff,
      );
  }
}
const search = (key: string, q = "", family = "All", page = 0): SuiteResult =>
  JSON.parse(reference_search(key, q, family, page));
const decode = (
  id: string,
  q: string,
  options: Record<string, string> = {},
): SuiteResult => JSON.parse(reference_decode(id, q, JSON.stringify(options)));
for (const [key, count] of Object.entries(counts)) {
  const all = [];
  for (let p = 0; p < Math.ceil(count / 50); p++) {
    const r = search(key, "", "All", p).reference!;
    assert.equal(r.matches, count);
    assert.equal(r.page, p);
    all.push(...r.entries);
  }
  assert.deepEqual(
    all,
    datasets.get(key)!.rows,
    `${key}: pagination must reach every source row exactly once`,
  );
  assert.equal(
    search(key, "", "All", 0xffffffff).reference!.page,
    Math.ceil(count / 50) - 1,
  );
}
for (const q of [
  "0x80070005",
  "80070005",
  "2147942405",
  "-2147024891",
  "E_ACCESSDENIED",
])
  assert.ok(
    search("microsoft", q).reference!.entries.some(
      (r) => r.name === "E_ACCESSDENIED",
    ),
    q,
  );
assert.ok(
  search("microsoft", "access denied", "Win32").reference!.entries.every(
    (r) =>
      r.family === "Win32" &&
      /access/i.test(r.description + " " + r.name) &&
      /denied/i.test(r.description + " " + r.name),
  ),
);
assert.ok(
  search("microsoft", "0", "Win32").reference!.entries.some(
    (r) => r.name === "NERR_Success",
  ),
);
assert.ok(
  search("microsoft", "0", "NTSTATUS").reference!.entries.some(
    (r) => r.name === "STATUS_WAIT_0",
  ),
);
assert.ok(search("microsoft", "bad", "Win32").reference!.matches > 0);
assert.equal(
  search("microsoft", "there-is-no-such-status").reference!.matches,
  0,
);
const h = decode("hresult-decode", "E_ACCESSDENIED");
const hd = h.data as Record<string, unknown>;
assert.equal(hd.severity, "Failure");
assert.equal(hd.facility, 7);
assert.deepEqual(hd.facilityNames, ["FACILITY_WIN32"]);
assert.ok(h.reference!.entries.some((r) => r.name === "ERROR_ACCESS_DENIED"));
assert.equal(
  h.bits!.reduce((s, b) => s + b.high - b.low + 1, 0),
  32,
);
const wrapped = decode("hresult-decode", "0xD0000005");
assert.ok(
  wrapped.reference!.entries.some((r) => r.name === "STATUS_ACCESS_VIOLATION"),
);
for (const [n, severity, success] of [
  ["0", "Success", true],
  ["0x40000000", "Informational", true],
  ["0x80000005", "Warning", false],
  ["0xC0000005", "Error", false],
] as const) {
  const r = decode("ntstatus-decode", n).data as Record<string, unknown>;
  assert.equal(r.severity, severity);
  assert.equal(r.NT_SUCCESS, success);
}
const forward = (n: string) =>
  decode("win32-hresult", n).data as {
    HRESULT: { hex: string };
    inputPreserved: boolean;
  };
assert.equal(forward("5").HRESULT.hex, "0x80070005");
assert.equal(forward("0").HRESULT.hex, "0x00000000");
assert.equal(forward("-1").HRESULT.hex, "0xFFFFFFFF");
assert.equal(forward("65537").HRESULT.hex, "0x80070001");
assert.equal(forward("-1").inputPreserved, true);
assert.equal(
  (
    decode("win32-hresult", "0x80070005", { direction: "HRESULT to Win32" })
      .data as { Win32: { unsignedDecimal: number } }
  ).Win32.unsignedDecimal,
  5,
);
assert.throws(() =>
  decode("win32-hresult", "0x80004005", { direction: "HRESULT to Win32" }),
);
assert.throws(() =>
  decode("ntstatus-decode", "4294967296", { base: "Decimal" }),
);
assert.throws(() => decode("hresult-decode", "-2147483649"));
assert.throws(() => decode("hresult-decode", "0xFFFFFFFFF"));
assert.ok(
  search("ldap", "49").reference!.entries.some(
    (r) => r.name === "LDAP_INVALID_CREDENTIALS",
  ),
);
assert.equal(search("http", "404").reference!.entries[0].name, "Not Found");
assert.equal(search("http", "199").reference!.entries[0].name, "Unassigned");
assert.ok(
  search("http", "", "4xx").reference!.entries.every((r) => r.family === "4xx"),
);
assert.equal(
  search("dns", "28", "Record type").reference!.entries[0].name,
  "AAAA",
);
assert.ok(
  search("dns", "3", "Response code").reference!.entries.some(
    (r) => r.name === "NXDomain",
  ),
);
assert.ok(
  search("mime", "application/json").reference!.entries.some(
    (r) => r.code === "application/json",
  ),
);
assert.ok(
  search("ports", "443", "tcp").reference!.entries.some(
    (r) => r.name === "https",
  ),
);
assert.ok(
  search("ports", "https", "udp").reference!.entries.some(
    (r) => r.code === "443",
  ),
);
const window = new Window();
Object.assign(globalThis, { document: window.document });
const { configureReference, renderReference, renderBits } =
  await import("../src/references");
let runs = 0;
configureReference("microsoft-errors", () => runs++);
const root = window.document.createElement("div");
window.document.body.append(root);
renderReference(root as unknown as HTMLElement, search("microsoft").reference!);
assert.equal(root.querySelectorAll("article").length, 50);
assert.equal(root.querySelectorAll("nav button").length, 4);
const next = [...root.querySelectorAll("button")].find(
  (b) => b.textContent === "Next",
)!;
next.click();
assert.equal(runs, 1);
assert.equal(
  root.querySelector("a[download]")?.getAttribute("href"),
  "/data/references/microsoft.json",
);
root.replaceChildren();
renderBits(root as unknown as HTMLElement, h.bits!);
assert.equal(root.querySelectorAll(".bit-fields > div").length, 7);
configureReference("none", () => {});
await window.happyDOM.close();
assert.equal(referenceTools.length, 9);
assert.equal(new Set(tools.map((t) => t.id)).size, tools.length);
console.log(
  `Reference checks passed: all ${Object.values(counts)
    .reduce((a, b) => a + b, 0)
    .toLocaleString()} rows reachable; aliases, numeric formats, bit fields, conversion limits, registry ranges, pagination, DOM rendering and snapshot hashes. ${tools.length} tools total.`,
);
