// SPDX-License-Identifier: AGPL-3.0-only
// Source data keeps its upstream attribution; this script is AGPL-3.0-only.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { Window } from "happy-dom";
import init, { run } from "../public/wasm/l5z12_tools";
import type { ReferenceDataset, ReferenceSource } from "../src/reference-types";
const offline = process.argv.includes("--offline");
const base =
  "https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-erref/";
const cache = "work/reference-sources";
const output = "public/data/references";
await mkdir(cache, { recursive: true });
await mkdir(output, { recursive: true });
await init({
  module_or_path: await readFile("public/wasm/l5z12_tools_bg.wasm"),
});
const w = new Window({
  settings: {
    disableJavaScriptEvaluation: true,
    disableJavaScriptFileLoading: true,
    disableCSSFileLoading: true,
    disableIframePageLoading: true,
  },
});
const clean = (s: string) => s.replace(/\s+/g, " ").trim();
async function source(filename: string, title: string, url: string) {
  let text: string;
  if (offline) text = await readFile(`${cache}/${filename}`, "utf8");
  else {
    const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
    if (!response.ok) throw Error(`${url}: ${response.status}`);
    text = await response.text();
    await writeFile(`${cache}/${filename}`, text);
  }
  return {
    text,
    meta: {
      title,
      url,
      sha256: createHash("sha256").update(text).digest("hex"),
      rows: 0,
    } as ReferenceSource,
  };
}
function html(text: string) {
  return new w.DOMParser().parseFromString(text, "text/html");
}
function xml(text: string) {
  const doc = new w.DOMParser().parseFromString(
    text.replace(/<\?[\s\S]*?\?>/g, ""),
    "application/xml",
  );
  if (doc.querySelector("parsererror")) throw Error("Invalid registry XML");
  return doc;
}
function cells(text: string) {
  return [...html(text).querySelectorAll("main table tr")]
    .map((r) => [...r.querySelectorAll("td")].map((c) => clean(c.textContent)))
    .filter((r) => r.length);
}
const datasets: ReferenceDataset[] = [];
function dataset(id: string, title: string, notice: string): ReferenceDataset {
  return {
    schema: 1,
    id,
    title,
    generated: new Date().toISOString().slice(0, 10),
    notice,
    sources: [],
    rows: [],
  };
}
const publication = await source(
  "ms-erref.html",
  "MS-ERREF publication and rights notice",
  base + "1bc92ddf-b79e-413c-bbaa-99a5281a6c90",
);
const published = cells(publication.text)[0];
if (
  !published ||
  !/^\d+\/\d+\/\d{4}$/.test(published[0]) ||
  !/^\d+\.\d+$/.test(published[1])
)
  throw Error("MS-ERREF publication metadata changed");
const revision = `MS-ERREF ${published[1]} / ${published[0]}`;
const microsoftNotice =
  "Microsoft Open Specifications / MS-ERREF. Microsoft retains copyright in its documentation. Extracted reference data is attributed to Microsoft and is not relicensed as project code. See the source document’s Intellectual Property Rights Notice. Scope: all rows in the published MS-ERREF HTML tables. Publication: " +
  revision +
  ".";
const ms = dataset(
  "microsoft",
  "Microsoft MS-ERREF error codes",
  microsoftNotice,
);
for (const [family, key, id] of [
  ["HRESULT", "hresult", "705fb797-2175-4a90-b5a3-3918024b10b8"],
  ["Win32", "win32", "18d8fbe8-a967-4f1c-ae50-99ca8e491d2d"],
  ["NTSTATUS", "ntstatus", "596a1078-e883-4972-9bbc-49e60bebca55"],
]) {
  const s = await source(key + ".html", `MS-ERREF ${family}`, base + id);
  const rows = cells(s.text);
  const sourceIndex = ms.sources.length;
  for (const row of rows) {
    if (row.length !== 2) throw Error(`${family}: unexpected table structure`);
    const match = row[0].match(/^(0x[0-9a-f]{8})\s+(.+)$/i);
    if (!match) throw Error(`${family}: unparsed value ${row[0]}`);
    const value = Number.parseInt(match[1].slice(2), 16);
    ms.rows.push({
      family,
      code: "0x" + value.toString(16).toUpperCase().padStart(8, "0"),
      value,
      signed: value | 0,
      name: match[2],
      description: row[1],
      source: sourceIndex,
    });
  }
  s.meta.rows = rows.length;
  s.meta.updated = revision;
  ms.sources.push(s.meta);
}
// Parse facility aliases separately; do not confuse them with HRESULT entries.
const facility = await source(
  "hresult-layout.html",
  "MS-ERREF HRESULT layout and facilities",
  base + "0642cb2f-2075-4469-918c-4441e69c548a",
);
ms.facilities = {};
for (const row of cells(facility.text)) {
  const match = row[0].match(/^(FACILITY_\w+)\s+(\d+)$/);
  if (match) {
    (ms.facilities[match[2]] ??= []).push(match[1]);
    facility.meta.rows++;
  }
}
if (facility.meta.rows < 40) throw Error("Facility table unexpectedly small");
ms.sources.push(facility.meta);
if (ms.rows.length < 7400)
  throw Error("MS-ERREF extraction unexpectedly small");
const unique = new Set(
  ms.rows.map((r) => r.family + ":" + r.code + ":" + r.name),
);
if (unique.size !== ms.rows.length)
  throw Error("Duplicate Microsoft records; inspect source changes");
publication.meta.rows = 0;
publication.meta.updated = revision;
ms.sources.push(publication.meta);
datasets.push(ms);
const ldap = dataset("ldap", "LDAP to Win32 mappings", microsoftNotice);
const ls = await source(
  "ldap.html",
  "MS-ERREF LDAP to Win32 mapping",
  base + "a465ae57-5f89-4539-88b3-90cf37a5ae06",
);
for (const row of cells(ls.text)) {
  if (row.length !== 6 || !/^\d+$/.test(row[0]))
    throw Error("LDAP row format changed");
  const names = ms.rows.filter(
    (r) =>
      r.family === "Win32" &&
      (r.name === row[5] ||
        (row[5] === "NO_ERROR" && r.name === "ERROR_SUCCESS")),
  );
  ldap.rows.push({
    family: "LDAP",
    code: row[1],
    value: Number(row[0]),
    name: row[4] || row[3] || row[2] || "Undocumented",
    description: row[5] || "No Win32 mapping documented",
    source: 0,
    details: {
      "RFC 1777": row[2],
      "RFC 2251": row[3],
      "Windows LDAP": row[4],
      "Win32 symbol": row[5],
      "Win32 code": names.map((r) => r.code).join(", "),
    },
  });
}
ls.meta.rows = ldap.rows.length;
ldap.sources.push(ls.meta);
datasets.push(ldap);
const ianaNotice =
  "Source: IANA protocol registries. Registry data is provided under IANA licensing terms: https://www.iana.org/help/licensing-terms. This is a dated local snapshot; consult the source for subsequent changes.";
const parseCsv = (text: string) =>
  JSON.parse(run("csv-to-json", text, "")) as Record<string, string>[];
function range(code: string) {
  if (!/^\d+(?:-\d+)?$/.test(code)) return {};
  const parts = code.split("-").map(Number);
  return { value: parts[0], ...(parts.length === 2 ? { end: parts[1] } : {}) };
}
for (const [id, title, url] of [
  [
    "http",
    "HTTP status codes",
    "https://www.iana.org/assignments/http-status-codes/http-status-codes-1.csv",
  ],
  [
    "ports",
    "Service names and transport ports",
    "https://www.iana.org/assignments/service-names-port-numbers/service-names-port-numbers.csv",
  ],
]) {
  const d = dataset(id, title, ianaNotice);
  const s = await source(id + ".csv", `IANA ${title}`, url);
  for (const row of parseCsv(s.text)) {
    const code = id === "http" ? row.Value : row["Port Number"];
    if (code === undefined || row.Description === undefined)
      throw Error("CSV columns changed");
    d.rows.push({
      family:
        id === "http"
          ? code[0] + "xx"
          : row["Transport Protocol"] || "Unspecified",
      code,
      name:
        id === "http"
          ? row.Description
          : row["Service Name"] || row.Description,
      description: row.Description,
      source: 0,
      ...range(code),
      details:
        id === "http"
          ? { Reference: row.Reference }
          : {
              Reference: row.Reference,
              "Service code": row["Service Code"],
              Notes: row["Assignment Notes"],
              Registered: row["Registration Date"],
              Modified: row["Modification Date"],
            },
    });
  }
  s.meta.rows = d.rows.length;
  d.sources.push(s.meta);
  datasets.push(d);
}
for (const [id, title, url] of [
  [
    "dns",
    "DNS records and response codes",
    "https://www.iana.org/assignments/dns-parameters/dns-parameters.xml",
  ],
  [
    "mime",
    "Media types",
    "https://www.iana.org/assignments/media-types/media-types.xml",
  ],
]) {
  const d = dataset(id, title, ianaNotice);
  const s = await source(id + ".xml", `IANA ${title}`, url);
  const doc = xml(s.text);
  s.meta.updated = doc.querySelector("updated")?.textContent;
  const names: Record<string, string> = {
    "dns-parameters-2": "Class",
    "dns-parameters-4": "Record type",
    "dns-parameters-5": "Opcode",
    "dns-parameters-6": "Response code",
  };
  for (const registry of doc.querySelectorAll("registry")) {
    const key = registry.getAttribute("id")!;
    if (id === "dns" && !names[key]) continue;
    if (id === "mime" && key === "media-types") continue;
    for (const record of [...registry.children].filter(
      (c) => c.tagName === "record",
    )) {
      const get = (tag: string) =>
        clean(record.querySelector(tag)?.textContent ?? "");
      const references = [...record.querySelectorAll("xref")]
        .map((x) => x.getAttribute("data") || clean(x.textContent))
        .filter(Boolean)
        .join(", ");
      const code =
        id === "mime" ? get("file") || `${key}/${get("name")}` : get("value");
      if (!code) throw Error(`Missing ${id} value`);
      d.rows.push({
        family: id === "mime" ? key : names[key],
        code,
        name:
          id === "mime"
            ? get("name")
            : get("type") || get("name") || get("description"),
        description: get("description"),
        source: 0,
        ...(id === "dns" ? range(code) : {}),
        details: {
          Reference: references,
          ...(record.getAttribute("date")
            ? { Registered: record.getAttribute("date")! }
            : {}),
        },
      });
    }
  }
  s.meta.rows = d.rows.length;
  d.sources.push(s.meta);
  datasets.push(d);
}
// Write only after every source has parsed and passed basic completeness checks.
for (const d of datasets) {
  if (
    d.rows.length <
    ({
      microsoft: 7400,
      ldap: 90,
      http: 60,
      ports: 10000,
      dns: 100,
      mime: 2000,
    }[d.id] ?? 1)
  )
    throw Error(`${d.id}: unexpectedly few records`);
  await writeFile(`${output}/${d.id}.json`, JSON.stringify(d) + "\n");
  console.log(`${d.id}: ${d.rows.length} rows`);
}
await writeFile(
  `${output}/manifest.json`,
  JSON.stringify(
    datasets.map(({ rows, facilities, ...d }) => ({
      ...d,
      count: rows.length,
      sha256: createHash("sha256")
        .update(
          JSON.stringify({
            ...d,
            rows,
            ...(facilities ? { facilities } : {}),
          }) + "\n",
        )
        .digest("hex"),
    })),
    null,
    2,
  ) + "\n",
);
await w.happyDOM.close();
