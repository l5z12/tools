// SPDX-License-Identifier: AGPL-3.0-only
import type { MessageKey } from "./messages";
import { t } from "./messages";
import { localizedTool } from "./catalog";
import type { Tool } from "../lib/tool-types";

function varsFromDataset(el: HTMLElement): Record<string, string> | undefined {
  const vars: Record<string, string> = {};
  let found = false;
  for (const [name, value] of Object.entries(el.dataset)) {
    if (!name.startsWith("i18n") || name === "i18n" || value === undefined)
      continue;
    if (
      name.endsWith("Placeholder") ||
      name.endsWith("Title") ||
      name.endsWith("Aria")
    )
      continue;
    const key = name.slice(4, 5).toLowerCase() + name.slice(5);
    vars[key] = value;
    found = true;
  }
  return found ? vars : undefined;
}

export function applyDocumentMessages(root: ParentNode = document): void {
  for (const el of root.querySelectorAll<HTMLElement>("[data-i18n]")) {
    const key = el.dataset.i18n as MessageKey | undefined;
    if (!key) continue;
    el.textContent = t(key, varsFromDataset(el));
  }
  for (const el of root.querySelectorAll<HTMLElement>(
    "[data-i18n-placeholder]",
  )) {
    const key = el.dataset.i18nPlaceholder as MessageKey | undefined;
    if (key) el.setAttribute("placeholder", t(key));
  }
  for (const el of root.querySelectorAll<HTMLElement>("[data-i18n-title]")) {
    const key = el.dataset.i18nTitle as MessageKey | undefined;
    if (key) el.setAttribute("title", t(key));
  }
  for (const el of root.querySelectorAll<HTMLElement>("[data-i18n-aria]")) {
    const key = el.dataset.i18nAria as MessageKey | undefined;
    if (key) el.setAttribute("aria-label", t(key));
  }
}

export function applyLocalizedCatalog(tools: Tool[]): void {
  const byId = new Map(tools.map((tool) => [tool.id, tool]));
  for (const row of document.querySelectorAll<HTMLElement>("[data-tool-row]")) {
    const tool = byId.get(row.dataset.toolRow ?? "");
    if (!tool) continue;
    const localized = localizedTool(tool);
    const link = row.querySelector("a");
    const description = row.querySelector("p");
    if (link) link.textContent = localized.name;
    if (description) description.textContent = localized.description;
  }
  for (const link of document.querySelectorAll<HTMLAnchorElement>(
    "#start-page [data-tool]",
  )) {
    const tool = byId.get(link.dataset.tool ?? "");
    if (!tool) continue;
    const localized = localizedTool(tool);
    const strong = link.querySelector("strong");
    const muted = link.querySelector(".muted");
    if (strong) {
      const arrow = strong.querySelector("span");
      strong.textContent = `${localized.name} `;
      if (arrow) strong.append(arrow);
    }
    if (muted) muted.textContent = localized.description;
  }
}
