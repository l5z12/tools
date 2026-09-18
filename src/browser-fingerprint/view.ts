// SPDX-License-Identifier: AGPL-3.0-only
import type { FingerprintSection } from "../workbench-types";

const PAGE_SIZE = 50;

function element<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  return node;
}

function label(key: string): string {
  const words = key.replace(/^\$/, "").replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Build large branches only when opened, so one probe cannot flood the page. */
function disclosure(title: string, populate: (body: HTMLElement) => void) {
  const details = element("details");
  details.append(element("summary", title));
  let populated = false;
  details.addEventListener("toggle", () => {
    if (!details.open || populated) return;
    populated = true;
    const body = element("div");
    populate(body);
    details.append(body);
  });
  return details;
}

function renderValue(value: unknown, depth: number): HTMLElement {
  if (value !== null && typeof value === "object") {
    const count = Object.keys(value).length;
    if (!count)
      return element("span", Array.isArray(value) ? "Empty list" : "No fields");
    if (depth > 12)
      return element(
        "span",
        "Further nesting is available in the JSON download.",
      );
    return disclosure(
      `${count} ${Array.isArray(value) ? (count === 1 ? "item" : "items") : count === 1 ? "field" : "fields"}`,
      (body) => renderFields(body, value, depth + 1),
    );
  }
  const text =
    value === null || value === undefined
      ? String(value)
      : value === ""
        ? '""'
        : String(value);
  if (text.length <= 240) return element("span", text);
  const image = /^data:image\/(png|jpeg|webp);base64,/.test(text);
  return disclosure(
    `${image ? "Image data" : "Long value"} · ${text.length.toLocaleString()} characters`,
    (body) => {
      if (image) {
        const preview = element("img");
        preview.src = text;
        preview.alt = "Fingerprint rendering probe";
        body.append(preview);
      }
      const pre = element("pre", text);
      pre.tabIndex = 0;
      pre.setAttribute("aria-label", "Complete value; scroll to read");
      body.append(pre);
    },
  );
}

function renderFields(
  container: HTMLElement,
  value: object,
  depth: number,
): void {
  const entries = Object.entries(value);
  const fields = element("dl");
  fields.className = "fingerprint-fields";
  const more = element("button");
  more.type = "button";
  let shown = 0;
  const appendPage = () => {
    const end = Math.min(shown + PAGE_SIZE, entries.length);
    for (; shown < end; shown++) {
      const [key, item] = entries[shown];
      const row = element("div");
      const term = element("dt", Array.isArray(value) ? `[${key}]` : key);
      term.title = key;
      const definition = element("dd");
      definition.append(renderValue(item, depth));
      row.append(term, definition);
      fields.append(row);
    }
    more.textContent = `Show next ${Math.min(PAGE_SIZE, entries.length - shown)} items (${shown} of ${entries.length} shown)`;
    more.hidden = shown === entries.length;
  };
  more.addEventListener("click", appendPage);
  appendPage();
  container.append(fields, more);
}

export function renderFingerprintSections(
  container: HTMLElement,
  sections: FingerprintSection[],
): void {
  const root = element("section");
  root.className = "fingerprint-components";
  root.setAttribute("aria-label", "Fingerprint components");
  root.append(element("h3", `Components (${sections.length})`));
  for (const section of sections) {
    const details = disclosure(label(section.name), (body) => {
      const toggle = element("button", "View raw JSON");
      toggle.type = "button";
      toggle.setAttribute("aria-label", `View raw JSON for ${section.name}`);
      const tree = element("div");
      tree.className = "fingerprint-tree";
      const raw = element("pre");
      raw.hidden = true;
      raw.tabIndex = 0;
      raw.setAttribute("aria-label", `Raw JSON for ${section.name}`);
      if (section.value !== null && typeof section.value === "object")
        renderFields(tree, section.value, 0);
      else tree.append(renderValue(section.value, 0));
      toggle.addEventListener("click", () => {
        const showRaw = raw.hidden;
        if (showRaw && !raw.textContent)
          raw.textContent = JSON.stringify(section.value, null, 2);
        raw.hidden = !showRaw;
        tree.hidden = showRaw;
        toggle.textContent = showRaw ? "View tree" : "View raw JSON";
        toggle.setAttribute(
          "aria-label",
          `${showRaw ? "View tree" : "View raw JSON"} for ${section.name}`,
        );
      });
      body.append(toggle, tree, raw);
    });
    details.className = "fingerprint-component";
    const status = element("span", section.status);
    status.className = "fingerprint-component-status";
    details.querySelector("summary")!.append(status);
    root.append(details);
  }
  container.append(root);
}
