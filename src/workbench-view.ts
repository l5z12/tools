// SPDX-License-Identifier: AGPL-3.0-only
import { renderFingerprintSections } from "./browser-fingerprint/view";
import { everydayIds } from "./lib/everyday-tools";
import { devInspectIds } from "./lib/dev-inspect-tools";
import { goIds } from "./lib/go-tools";
import { renderSqlResults } from "./sql/view";
import { pythonIds } from "./lib/python-tools";
import { rustIds } from "./lib/rust-tools";
import { cppIds } from "./lib/cpp-tools";
import { sqlIds } from "./lib/sql-tools";
import { renderCodecActions } from "./crypto-controls";
import { renderUtilityChart } from "./utility-ui";
import { renderReference, renderBits, renderDecoded } from "./references";
import type { SuiteResult } from "./workbench-types";
import { element } from "./ui/dom";
let urls: string[] = [];
export function clearWorkbenchView(): void {
  urls.forEach((url) => URL.revokeObjectURL(url));
  urls = [];
}
function url(base64: string, mime: string) {
  const u = URL.createObjectURL(
    new Blob([Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))], {
      type: mime,
    }),
  );
  urls.push(u);
  return u;
}
function structured(
  parent: HTMLElement,
  value: unknown,
  budget = { remaining: 2000 },
  expandedDepth = Infinity,
) {
  if (value !== null && typeof value === "object") {
    const dl = element("dl");
    for (const [k, v] of Object.entries(value)) {
      if (--budget.remaining < 0) {
        dl.append(
          element(
            "p",
            "Preview limited to 2,000 fields. Use raw output for the complete result.",
          ),
        );
        break;
      }
      dl.append(element("dt", k));
      const dd = element("dd");
      if (v !== null && typeof v === "object") {
        const details = element("details");
        details.open = expandedDepth > 0;
        details.append(
          element(
            "summary",
            Array.isArray(v) ? `${v.length} items` : "Details",
          ),
        );
        structured(details, v, budget, expandedDepth - 1);
        dd.append(details);
      } else {
        const text = String(v);
        dd.textContent =
          text.length > 8192
            ? text.slice(0, 8192) +
              "\n… Preview truncated; use raw output or download for the complete result."
            : text;
      }
      dl.append(dd);
    }
    parent.append(dl);
  } else parent.append(element("p", String(value)));
}
export function renderWorkbenchView(
  container: HTMLElement,
  r: SuiteResult,
  currentId: string,
  invalidate: () => void,
): void {
  container.replaceChildren();
  container.hidden = false;
  if (r.headline) {
    container.append(element("h3", r.headline.label));
    const digest = element("pre", r.headline.value);
    digest.style.whiteSpace = "pre-wrap";
    digest.style.overflowWrap = "anywhere";
    const copy = element("button", "Copy fingerprint");
    copy.type = "button";
    copy.onclick = async () => {
      try {
        await navigator.clipboard.writeText(r.headline!.value);
        copy.textContent = "Copied";
      } catch {
        copy.textContent = "Copy unavailable — select the fingerprint above";
      }
    };
    container.append(digest, copy);
  }
  renderCodecActions(container, currentId, r, invalidate);
  if (r.chart) renderUtilityChart(container, r.chart);
  if (r.bits) renderBits(container, r.bits);
  if (r.comparison) {
    const wrapper = element("div");
    wrapper.className = "comparison";
    const before = element("img");
    before.src = url(r.comparison.before, "image/png");
    before.alt = "First image";
    const after = element("img");
    after.src = url(r.comparison.after, "image/png");
    after.alt = "Second image";
    after.className = "comparison-overlay";
    wrapper.append(before, after);
    const slider = element("input");
    slider.type = "range";
    slider.min = "0";
    slider.max = "100";
    slider.value = "50";
    slider.setAttribute("aria-label", "Reveal second image");
    const move = () =>
      (after.style.clipPath = `inset(0 ${100 - Number(slider.value)}% 0 0)`);
    slider.oninput = move;
    move();
    container.append(
      wrapper,
      slider,
      element(
        "p",
        "First image / second image — move the slider to compare. Difference heatmap below.",
      ),
    );
  }
  if (r.colors) {
    const list = element("div");
    list.className = "palette-grid";
    for (const c of r.colors) {
      const item = element("div");
      const swatch = element("div");
      swatch.className = "palette-swatch";
      swatch.style.backgroundColor = c.hex;
      item.append(
        swatch,
        element("code", c.hex),
        element("p", `${c.percent.toFixed(2)}%`),
      );
      list.append(item);
    }
    container.append(list);
    if (!r.colors.length) container.append(element("p", "No visible pixels."));
  }
  if (r.sqliteBrowser?.error)
    container.append(element("p", r.sqliteBrowser.error));
  if (r.sqlResults) renderSqlResults(container, r.sqlResults);
  if (r.rows) {
    const scroll = element("div");
    scroll.className = "suite-table";
    if (
      pythonIds.has(currentId) ||
      rustIds.has(currentId) ||
      goIds.has(currentId) ||
      cppIds.has(currentId) ||
      sqlIds.has(currentId) ||
      everydayIds.has(currentId) ||
      devInspectIds.has(currentId)
    ) {
      scroll.classList.add("code-analysis-table");
      scroll.tabIndex = 0;
      scroll.setAttribute(
        "aria-label",
        "Results; scroll to inspect all columns",
      );
    }
    if (currentId === "browser-fingerprint") {
      scroll.classList.add("fingerprint-table");
      scroll.tabIndex = 0;
      scroll.setAttribute("role", "region");
      scroll.setAttribute(
        "aria-label",
        "Browser fingerprint signals; scroll horizontally on small screens",
      );
    }
    const table = element("table");
    const keys = Array.from(new Set(r.rows.flatMap((row) => Object.keys(row))));
    const head = element("tr");
    keys.forEach((k) => head.append(element("th", k)));
    const thead = element("thead");
    thead.append(head);
    table.append(thead);
    const body = element("tbody");
    r.rows.slice(0, 500).forEach((row) => {
      const tr = element("tr");
      keys.forEach((k) =>
        tr.append(
          element(
            "td",
            typeof row[k] === "object"
              ? JSON.stringify(row[k])
              : String(row[k] ?? ""),
          ),
        ),
      );
      body.append(tr);
    });
    table.append(body);
    scroll.append(table);
    container.append(
      scroll,
      element(
        "p",
        `${r.totalRows ?? r.rows.length} rows${(r.totalRows ?? r.rows.length) > 500 ? " · showing first 500" : ""}`,
      ),
    );
  }
  if (r.data !== undefined) {
    if (r.reference) renderDecoded(container, r.data);
    else if (
      currentId === "python-ast" ||
      rustIds.has(currentId) ||
      goIds.has(currentId) ||
      cppIds.has(currentId) ||
      sqlIds.has(currentId) ||
      devInspectIds.has(currentId)
    ) {
      const tree = element("div");
      tree.className = "code-analysis-view";
      structured(tree, r.data, undefined, sqlIds.has(currentId) ? 2 : Infinity);
      container.append(tree);
    } else structured(container, r.data);
  }
  if (r.reference) renderReference(container, r.reference);
  if (r.fingerprintSections)
    renderFingerprintSections(container, r.fingerprintSections);
  if (r.kind === "code") {
    const pre = element("pre");
    const text = r.text ?? "";
    pre.append(element("code", text.slice(0, 65536)));
    container.append(pre);
    if (text.length > 65536)
      container.append(
        element(
          "p",
          "Preview limited to 65,536 characters. Copy, raw output and downloads retain the complete result.",
        ),
      );
  }
  const resultFiles = [...(r.files ?? []), ...(r.mediaFiles ?? [])];
  if (resultFiles.length) {
    const downloads = element("div");
    downloads.className = "suite-downloads";
    resultFiles.forEach((f, i) => {
      const binary = "bytes" in f;
      const u = binary
        ? URL.createObjectURL(new Blob([f.bytes], { type: f.mime }))
        : url(f.base64, f.mime);
      if (binary) urls.push(u);
      const size = binary
        ? f.bytes.length
        : Math.floor((f.base64.length * 3) / 4) -
          (f.base64.endsWith("==") ? 2 : f.base64.endsWith("=") ? 1 : 0);
      const block = element("div");
      const a = element("a", `${f.name} · ${size.toLocaleString()} bytes`);
      a.href = u;
      a.download = f.name;
      if (f.mime.startsWith("image/") && (i < 24 || resultFiles.length < 25)) {
        const img = element("img");
        img.src = u;
        img.alt = f.name;
        img.loading = "lazy";
        block.append(img);
      }
      if (f.mime.startsWith("audio/") || f.mime.startsWith("video/")) {
        const player = element(f.mime.startsWith("audio/") ? "audio" : "video");
        player.controls = true;
        player.preload = "metadata";
        player.src = u;
        player.setAttribute("aria-label", `Preview ${f.name}`);
        block.append(
          player,
          element(
            "p",
            "Playback depends on your browser's codecs. The download is available even if preview is unsupported.",
          ),
        );
      }
      block.append(a);
      downloads.append(block);
    });
    container.append(downloads);
  }
  if (
    !r.data &&
    !r.reference &&
    !r.rows &&
    !r.fingerprintSections &&
    !r.colors &&
    r.kind !== "code" &&
    !resultFiles.length
  )
    container.append(element("p", r.text ?? "Done."));
}
export function downloadSuite(r: SuiteResult): boolean {
  const first = document.querySelector<HTMLAnchorElement>(".suite-downloads a");
  if ((r.files?.length || r.mediaFiles?.length) && first) {
    first.click();
    return true;
  }
  return false;
}
