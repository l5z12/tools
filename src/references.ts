// SPDX-License-Identifier: AGPL-3.0-only
import { referenceBrowsers, referenceIds } from "./lib/reference-tools";
import type { SuiteOptions, SuiteResult } from "./workbench-types";
import type { ReferencePage } from "./reference-types";
let worker: Worker | undefined;
let request = 0;
const pending = new Map<
  number,
  {
    resolve: (r: SuiteResult) => void;
    reject: (e: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }
>();
function start() {
  if (worker) return worker;
  worker = new Worker(new URL("./reference-worker.ts", import.meta.url), {
    type: "module",
  });
  worker.onmessage = ({ data }) => {
    const item = pending.get(data.request);
    if (!item) return;
    clearTimeout(item.timer);
    pending.delete(data.request);
    if (data.error) item.reject(Error(data.error));
    else item.resolve(data.result);
  };
  worker.onerror = () => stop("Reference worker failed. Try again.");
  return worker;
}
function stop(message: string) {
  worker?.terminate();
  worker = undefined;
  for (const item of pending.values()) {
    clearTimeout(item.timer);
    item.reject(Error(message));
  }
  pending.clear();
}
let current = "";
let page = 0;
let run = () => {};
let debounce: ReturnType<typeof setTimeout> | undefined;
export function configureReference(id: string, onRun: () => void) {
  current = id;
  page = 0;
  run = onRun;
  clearTimeout(debounce);
  if (referenceBrowsers.has(id)) debounce = setTimeout(onRun, 0);
}
export function referenceInputChanged() {
  page = 0;
  clearTimeout(debounce);
  if (referenceBrowsers.has(current)) debounce = setTimeout(run, 220);
}
export function isReferenceBrowser(id: string) {
  return referenceBrowsers.has(id);
}
export function queryReference(
  id: string,
  input: string,
  options: SuiteOptions,
): Promise<SuiteResult> {
  clearTimeout(debounce);
  return new Promise((resolve, reject) => {
    const ticket = ++request;
    const w = start();
    const timer = setTimeout(
      () => stop("Reference processing timed out. Try again."),
      30000,
    );
    pending.set(ticket, { resolve, reject, timer });
    w.postMessage({ request: ticket, id, input, options, page });
  });
}
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  return node;
};
function link(title: string, url: string) {
  const a = el("a", title);
  a.href = url;
  return a;
}
function copy(text: string, label: string) {
  const b = el("button", label);
  b.type = "button";
  b.className = "link-button";
  b.onclick = async () => {
    try {
      await navigator.clipboard.writeText(text);
      b.textContent = "Copied";
    } catch {
      b.textContent = "Clipboard unavailable";
    }
  };
  return b;
}
export function renderReference(root: HTMLElement, ref: ReferencePage) {
  const isBrowser = referenceBrowsers.has(current);
  const status = el(
    "p",
    `${ref.matches.toLocaleString()} matches / ${ref.total.toLocaleString()} entries · snapshot ${ref.generated}`,
  );
  status.className = "reference-count";
  root.append(status);
  if (ref.entries.length === 0)
    root.append(
      el(
        "p",
        "No matching entries in this snapshot. Try another code, name, or fewer search words.",
      ),
    );
  const results = el("div");
  results.className = "reference-entries";
  for (const row of ref.entries) {
    const article = el("article");
    const title = el("h3");
    title.append(
      el("code", row.code || "No port assigned"),
      el("span", row.name),
    );
    const badge = el("span", row.family);
    badge.className = "reference-family";
    article.append(badge, title);
    const formats = el("div");
    formats.className = "reference-formats";
    if (row.value !== undefined) {
      formats.append(
        el(
          "span",
          `Decimal: ${row.value}${row.end !== undefined ? "–" + row.end : ""}`,
        ),
      );
      if (row.signed !== undefined && row.signed !== row.value)
        formats.append(el("span", `Signed: ${row.signed}`));
    }
    formats.append(copy(row.code, "Copy code"), copy(row.name, "Copy name"));
    article.append(formats);
    if (row.description && row.description !== row.name)
      article.append(el("p", row.description));
    if (row.details) {
      const details = Object.entries(row.details).filter(([, v]) => v);
      if (details.length) {
        const dl = el("dl");
        for (const [k, v] of details) {
          dl.append(el("dt", k), el("dd", v));
        }
        article.append(dl);
      }
    }
    const source = ref.sources[row.source];
    if (source) article.append(link("Source ↗", source.url));
    results.append(article);
  }
  root.append(results);
  if (isBrowser) {
    const pages = Math.max(1, Math.ceil(ref.matches / ref.pageSize));
    page = ref.page;
    const nav = el("nav");
    nav.className = "reference-pagination";
    nav.setAttribute("aria-label", "Reference result pages");
    for (const [label, value, disabled] of [
      ["First", 0, page === 0],
      ["Previous", page - 1, page === 0],
      ["Next", page + 1, page >= pages - 1],
      ["Last", pages - 1, page >= pages - 1],
    ] as const) {
      const button = el("button", label);
      button.type = "button";
      button.disabled = disabled;
      button.onclick = () => {
        page = value;
        run();
      };
      nav.append(button);
    }
    nav.append(el("span", `Page ${page + 1} of ${pages}`));
    root.append(nav);
  }
  const details = el("details");
  details.className = "reference-sources";
  details.append(
    el("summary", "Dataset, coverage & sources"),
    el("p", ref.notice),
  );
  const download = link("Download full reference JSON", ref.download);
  download.download = ref.dataset + ".json";
  details.append(download);
  for (const s of ref.sources) {
    const paragraph = el("p");
    paragraph.append(
      link(s.title, s.url),
      document.createTextNode(
        ` · ${s.rows.toLocaleString()} source rows${s.updated ? " · " + s.updated : ""}`,
      ),
    );
    details.append(paragraph);
  }
  details.append(
    link("Data attribution and licensing", "/data/references/NOTICE.txt"),
  );
  root.append(details);
}
export function renderBits(
  root: HTMLElement,
  bits: NonNullable<SuiteResult["bits"]>,
) {
  if (!bits.length) return;
  const strip = el("div");
  strip.className = "bit-fields";
  strip.setAttribute(
    "aria-label",
    "32-bit field layout, most significant bit first",
  );
  for (const field of bits) {
    const cell = el("div");
    cell.style.flexGrow = String(field.high - field.low + 1);
    cell.append(
      el("span", field.label),
      el("strong", String(field.value)),
      el(
        "small",
        field.high === field.low
          ? `bit ${field.high}`
          : `bits ${field.high}–${field.low}`,
      ),
    );
    strip.append(cell);
  }
  root.append(strip);
}
export function renderDecoded(root: HTMLElement, value: unknown) {
  const data = value as Record<string, unknown>;
  const labels: Record<string, string> = {
    hex: "Hexadecimal",
    signedDecimal: "Signed decimal",
    unsignedDecimal: "Unsigned decimal",
    severity: "Severity",
    facility: "Facility number",
    facilityNames: "Facility names",
    NTFacility: "NTSTATUS facility",
    code: "Code",
    customerDefined: "Customer-defined",
    NTSTATUSWrapped: "Wraps NTSTATUS",
    NT_SUCCESS: "Passes NT_SUCCESS",
    reservedN: "Reserved N bit set",
    inputPreserved: "Input preserved",
    binary: "Binary",
  };
  const dl = el("dl");
  dl.className = "decoded-values";
  for (const [key, label] of Object.entries(labels)) {
    if (!(key in data)) continue;
    const v = data[key];
    let text =
      v === null
        ? "Not listed in MS-ERREF"
        : Array.isArray(v)
          ? v.join(", ")
          : typeof v === "boolean"
            ? v
              ? "Yes"
              : "No"
            : String(v);
    if (key === "binary") text = text.match(/.{1,4}/g)?.join(" ") ?? text;
    dl.append(el("dt", label), el("dd", text));
  }
  root.append(dl);
  for (const [key, label] of Object.entries({
    underlyingWin32: "Underlying Win32 code",
    underlyingNTSTATUS: "Underlying NTSTATUS",
    HRESULT: "Converted HRESULT",
    Win32: "Extracted Win32 code",
    HRESULT_FROM_NT: "HRESULT_FROM_NT",
  })) {
    if (data[key] && typeof data[key] === "object") {
      root.append(el("h3", label));
      renderDecoded(root, data[key]);
    }
  }
  if (Array.isArray(data.notes) && data.notes.length) {
    const notes = el("ul");
    for (const note of data.notes) notes.append(el("li", String(note)));
    root.append(notes);
  }
}
export { referenceIds };
