// SPDX-License-Identifier: AGPL-3.0-only
import type { ImageArtifact } from "./image-tools";
import { unitOptions } from "./lib/converters";
const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text?: unknown,
  cls?: string,
): HTMLElementTagNameMap[K] => {
  const n = document.createElement(tag);
  if (text !== undefined) n.textContent = String(text);
  if (cls) n.className = cls;
  return n;
};
const stringify = (v: unknown) =>
  typeof v === "string" ? v : JSON.stringify(v);
function table(rows: Record<string, unknown>[], limit = 500) {
  const box = el("div", undefined, "table-scroll");
  const t = el("table");
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const head = el("tr");
  keys.forEach((k) => head.append(el("th", k)));
  const thead = el("thead");
  thead.append(head);
  t.append(thead);
  const body = el("tbody");
  rows.slice(0, limit).forEach((row) => {
    const tr = el("tr");
    keys.forEach((k) =>
      tr.append(el("td", row[k] === undefined ? "" : stringify(row[k]))),
    );
    body.append(tr);
  });
  t.append(body);
  box.append(t);
  if (rows.length > limit)
    box.append(
      el(
        "p",
        `Showing ${limit} of ${rows.length} rows. Copy or export to get all rows.`,
        "muted",
      ),
    );
  if (!rows.length) box.append(el("p", "No rows.", "muted"));
  return box;
}
function metrics(entries: [string, unknown][]) {
  const dl = el("dl", undefined, "metrics");
  entries.forEach(([k, v]) => {
    const pair = el("div");
    pair.append(
      el("dt", k),
      el(
        "dd",
        v === null
          ? "—"
          : typeof v === "boolean"
            ? v
              ? "Yes"
              : "No"
            : stringify(v),
      ),
    );
    dl.append(pair);
  });
  return dl;
}
function tree(v: unknown) {
  let count = 0;
  function visit(value: unknown, key: string, depth: number): HTMLElement {
    count++;
    if (count > 600) return el("span", "… view raw output for remaining data");
    if (value === null || typeof value !== "object") {
      const line = el("div", undefined, "json-leaf");
      line.append(
        el("span", key ? `${key}: ` : "", "json-key"),
        el("span", JSON.stringify(value), `json-${typeof value}`),
      );
      return line;
    }
    const d = el("details", undefined, "json-node");
    d.open = depth < 2;
    d.append(
      el(
        "summary",
        `${key ? key + ": " : ""}${Array.isArray(value) ? "Array" : "Object"} · ${Object.keys(value).length}`,
      ),
    );
    for (const [k, val] of Object.entries(value)) {
      if (count > 600) break;
      d.append(visit(val, k, depth + 1));
    }
    return d;
  }
  return visit(v, "", 0);
}
function preview(html: string) {
  const frame = el("iframe");
  frame.title = "Document preview";
  frame.setAttribute("sandbox", "");
  frame.referrerPolicy = "no-referrer";
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc
    .querySelectorAll("script,iframe,frame,object,embed,meta,base,link,form")
    .forEach((n) => n.remove());
  frame.srcdoc = `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src 'none'; form-action 'none'"><style>body{font:16px/1.6 system-ui;padding:16px;color:#1a1a1a;background:white;overflow-wrap:anywhere}pre{overflow:auto;background:#f5f5f5;padding:12px}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:6px}img{max-width:100%}</style>${doc.body.innerHTML}`;
  return frame;
}
export function renderResult(
  root: HTMLElement,
  id: string,
  value: string,
  input: string,
  artifact: ImageArtifact | null,
) {
  root.replaceChildren();
  let rich = true;
  if (artifact) {
    const image = el("img");
    image.src = artifact.url;
    image.alt = "Processed image preview";
    image.className = "image-preview";
    root.append(image, metrics(Object.entries(artifact.meta)));
    if (artifact.secondaryUrl) {
      root.append(el("h3", "Static PNG fallback"));
      const fallback = el("img");
      fallback.src = artifact.secondaryUrl;
      fallback.alt = "Static fallback preview";
      fallback.className = "image-preview";
      root.append(fallback);
    }
  } else if (["json-typescript", "curl-fetch"].includes(id)) {
    root.append(el("pre", value, "token-result"));
  } else if (["json-diff", "env-diff", "semver-test"].includes(id)) {
    const rows = JSON.parse(value);
    if (!rows.length) root.append(el("p", "No differences found."));
    else root.append(table(rows));
  } else if (id === "json-schema") {
    const data = JSON.parse(value);
    root.append(
      el("div", data.valid ? "Valid JSON" : "Validation failed", "big-result"),
    );
    if (!data.valid) root.append(table(data.errors));
    if (data.errors.length === data.limit)
      root.append(el("p", "Showing the first 100 errors.", "muted"));
  } else if (id === "cron-explorer") {
    const data = JSON.parse(value);
    root.append(
      el("code", data.expression),
      table(data.schedule),
      el("p", data.note, "muted"),
    );
  } else if (id === "hex-viewer") {
    const data = JSON.parse(value);
    root.append(
      metrics([
        ["File bytes", data.bytes],
        ["Shown bytes", data.shownBytes],
      ]),
      table(data.rows, 4096),
    );
  } else if (id === "csp-inspector") {
    const data = JSON.parse(value);
    root.append(table(data.directives));
    const notes = el("ul");
    data.notes.forEach((note: string) => notes.append(el("li", note)));
    root.append(notes, el("p", data.scope, "muted"));
  } else if (id === "regex-playground") {
    const matches: {
      text: string;
      start: number;
      end: number;
      groups: { name: string | null; index: number; value: string | null }[];
    }[] = JSON.parse(value);
    root.append(el("p", matches.length + " matches (up to 1,000)", "muted"));
    const highlight = el("pre", undefined, "regex-highlight");
    let cursor = 0;
    for (const match of matches) {
      highlight.append(
        document.createTextNode(input.slice(cursor, match.start)),
      );
      const mark = el("mark", match.text || "▏");
      mark.title = match.start + "–" + match.end;
      highlight.append(mark);
      cursor = match.end;
    }
    highlight.append(document.createTextNode(input.slice(cursor)));
    root.append(highlight);
    const rows = matches.flatMap((match, i) => [
      { match: i + 1, group: "Full match", value: match.text },
      ...match.groups.map((group) => ({
        match: i + 1,
        group: group.name ?? String(group.index),
        value: group.value,
      })),
    ]);
    root.append(table(rows));
  } else if (id === "qr-code") {
    const img = el("img");
    img.alt = "Generated QR code";
    img.className = "qr-preview";
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(value);
    root.append(img, el("p", input, "muted"));
  } else if (id === "markdown-preview" || id === "html-preview") {
    root.append(preview(value));
  } else if (id === "color-convert") {
    const swatch = el("div", undefined, "color-swatch");
    const color = value.match(/HEX: (#[a-f0-9]{6})/i)?.[1];
    swatch.style.backgroundColor = color ?? "transparent";
    swatch.setAttribute("aria-label", `Color ${color}`);
    root.append(
      swatch,
      metrics(
        value.split("\n").map((line) => {
          const i = line.indexOf(":");
          return [line.slice(0, i), line.slice(i + 1).trim()];
        }),
      ),
    );
  } else if (unitOptions[id]) {
    root.append(metrics(Object.entries(JSON.parse(value))));
  } else if (["rgb-to-hex", "hsl-to-hex"].includes(id)) {
    const swatch = el("div", undefined, "color-swatch");
    swatch.style.backgroundColor = value;
    swatch.setAttribute("aria-label", "Color " + value);
    root.append(swatch, el("div", value, "big-result"));
  } else if (["yaml-to-json", "toml-to-json", "jsonl-to-json"].includes(id)) {
    root.append(tree(JSON.parse(value)));
  } else if (
    [
      "json-to-yaml",
      "toml-to-yaml",
      "json-to-toml",
      "yaml-to-toml",
      "json-to-jsonl",
      "csv-to-markdown",
    ].includes(id)
  ) {
    root.append(el("pre", value, "token-result"));
  } else if (id === "contrast") {
    const data = JSON.parse(value);
    const sample = el(
      "div",
      "The quick brown fox jumps over the lazy dog.",
      "contrast-sample",
    );
    sample.style.color = data.foreground;
    sample.style.backgroundColor = data.background;
    root.append(
      sample,
      el("div", `${data.ratio.toFixed(2)} : 1`, "big-result"),
    );
    root.append(
      metrics(
        Object.entries(data)
          .filter(([k]) => k.startsWith("AA"))
          .map(([k, v]) => [k, v ? "Pass" : "Fail"]),
      ),
    );
  } else if (id === "palette") {
    const colors: string[] = JSON.parse(value);
    const palette = el("div", undefined, "palette");
    colors.forEach((color) => {
      const tile = el("div");
      const swatch = el("div", undefined, "palette-color");
      swatch.style.backgroundColor = color;
      tile.append(swatch, el("code", color));
      palette.append(tile);
    });
    root.append(palette);
  } else if (id === "line-diff") {
    const rows: { kind: string; text: string }[] = JSON.parse(value);
    root.append(
      el(
        "p",
        `${rows.filter((r) => r.kind === "added").length} added / ${rows.filter((r) => r.kind === "removed").length} removed`,
        "muted",
      ),
    );
    rows
      .slice(0, 3000)
      .forEach((row) =>
        root.append(
          el(
            "div",
            `${row.kind === "added" ? "+" : row.kind === "removed" ? "−" : " "} ${row.text}`,
            `diff-line ${row.kind}`,
          ),
        ),
      );
    if (rows.length > 3000)
      root.append(
        el(
          "p",
          "Preview limited to 3,000 lines. Raw output contains all lines.",
        ),
      );
  } else if (["json-table", "csv-to-json", "word-frequency"].includes(id)) {
    root.append(table(JSON.parse(value)));
  } else if (id === "json-to-csv") {
    root.append(table(JSON.parse(input)));
  } else if (
    [
      "json-format",
      "json-minify",
      "json-flatten",
      "json-merge",
      "json-pointer",
      "jwt-decode",
      "query-to-json",
    ].includes(id)
  ) {
    root.append(tree(JSON.parse(value)));
    if (id === "jwt-decode")
      root.prepend(el("p", "Signature not verified.", "muted"));
  } else if (
    ["url-inspect", "ipv4-subnet", "date-inspect", "uuid-inspect"].includes(id)
  ) {
    root.append(metrics(Object.entries(JSON.parse(value))));
  } else if (id === "aspect-ratio") {
    const d = JSON.parse(value);
    const shape = el("div", d.ratio, "ratio-preview");
    shape.style.aspectRatio = String(d.decimal);
    shape.style.maxWidth = "100%";
    shape.style.maxHeight = "240px";
    root.append(shape, metrics(Object.entries(d)));
  } else if (
    [
      "text-stats",
      "statistics",
      "base-convert",
      "gcd-lcm",
      "temperature",
      "length",
      "mass",
      "bytes",
      "duration",
    ].includes(id)
  ) {
    root.append(
      metrics(
        value.split("\n").map((line) => {
          const i = line.indexOf(":");
          return [line.slice(0, i), line.slice(i + 1).trim()];
        }),
      ),
    );
  } else if (
    [
      "percentage",
      "percentage-change",
      "unix-to-date",
      "date-to-unix",
      "date-difference",
      "date-add",
      "date-offset",
      "unix-ms-to-date",
      "date-to-unix-ms",
      "roman-numeral",
      "prime-factors",
    ].includes(id)
  ) {
    root.append(el("div", value, "big-result"));
  } else if (
    ["sha256", "sha512", "file-sha256", "password", "uuid"].includes(id)
  ) {
    root.append(el("pre", value, "token-result"));
  } else rich = false;
  root.hidden = !rich;
  return rich;
}
