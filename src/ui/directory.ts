// SPDX-License-Identifier: AGPL-3.0-only
import type { Tool } from "../lib/tool-types";
import { matchesTool } from "../lib/search";
import { element } from "./dom";
import { toolPath } from "../lib/site";
import { formatNumber, localizedTool, t, toolCountLabel } from "../i18n";

export const commonTags = new Set([
  "developer",
  "converters",
  "text",
  "data",
  "images",
  "files",
  "encoding",
  "security",
  "audio",
  "video",
  "time",
  "sql",
]);

export function configureDirectory(
  tools: Tool[],
  navigate: (id: string) => void,
) {
  const search = document.querySelector<HTMLInputElement>("#search")!;
  const index = document.querySelector<HTMLDetailsElement>("#index")!;
  const count = document.getElementById("match-count")!;
  const clear = document.querySelector<HTMLButtonElement>("#clear-search")!;
  const more = document.querySelector<HTMLButtonElement>("#more-tags")!;
  const all = document.querySelector<HTMLButtonElement>("#all-tags")!;
  const noResults = document.getElementById("no-results")!;
  const rows = [...document.querySelectorAll<HTMLElement>("[data-tool-row]")];
  const tagButtons = [
    ...document.querySelectorAll<HTMLButtonElement>("[data-filter-tag]"),
  ];
  const byId = new Map(tools.map((tool) => [tool.id, tool]));
  const selectedTags = new Set<string>();
  const recent: string[] = [];
  let expanded = false;

  function focusSearch(): void {
    search.focus();
    search.select();
    search.scrollIntoView({ block: "center", behavior: "instant" });
  }

  function openTool(id: string): void {
    navigate(id);
    index.open = false;
    document.getElementById("tool-title")!.focus({ preventScroll: true });
    document
      .getElementById("workspace")!
      .scrollIntoView({ block: "start", behavior: "instant" });
  }

  function filter(open = true): void {
    let matches = 0;
    for (const row of rows) {
      row.hidden = !matchesTool(
        byId.get(row.dataset.toolRow!)!,
        search.value,
        selectedTags,
      );
      if (!row.hidden) matches++;
    }
    for (const button of tagButtons) {
      const tag = button.dataset.filterTag!;
      const selected = selectedTags.has(tag);
      button.setAttribute("aria-pressed", String(selected));
      button.hidden = !expanded && !selected && !commonTags.has(tag);
    }
    all.setAttribute("aria-pressed", String(selectedTags.size === 0));
    more.setAttribute("aria-expanded", String(expanded));
    more.textContent = expanded
      ? t("fewerHashtags")
      : t("allHashtags", { n: formatNumber(tagButtons.length) });
    clear.hidden = !search.value && selectedTags.size === 0;
    count.textContent = toolCountLabel(matches);
    noResults.hidden = matches > 0;
    if (open) index.open = true;
  }

  function toggleTag(tag: string): void {
    if (selectedTags.has(tag)) selectedTags.delete(tag);
    else selectedTags.add(tag);
    filter();
  }

  search.addEventListener("input", () => filter());
  search.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      const first = rows.find((row) => !row.hidden);
      if (first) openTool(first.dataset.toolRow!);
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      index.open = true;
      rows
        .find((row) => !row.hidden)
        ?.querySelector<HTMLAnchorElement>("[data-tool]")
        ?.focus();
    }
    if (event.key === "Escape") {
      index.open = false;
      const home = !document.getElementById("start-page")!.hidden;
      document.getElementById(home ? "start-title" : "tool-title")!.focus();
    }
  });
  clear.onclick = () => {
    search.value = "";
    selectedTags.clear();
    filter();
    search.focus();
  };
  all.onclick = () => {
    selectedTags.clear();
    filter();
  };
  more.onclick = () => {
    expanded = !expanded;
    filter(false);
  };
  for (const button of tagButtons)
    button.onclick = () => toggleTag(button.dataset.filterTag!);
  for (const button of document.querySelectorAll<HTMLButtonElement>(
    "[data-tag]",
  )) {
    button.onclick = () => toggleTag(button.dataset.tag!);
  }
  document.querySelector(".directory")!.addEventListener("click", (event) => {
    const link = (event.target as Element).closest<HTMLAnchorElement>(
      "a[data-tool]",
    );
    if (
      !link ||
      event.defaultPrevented ||
      (event as MouseEvent).ctrlKey ||
      (event as MouseEvent).metaKey ||
      (event as MouseEvent).shiftKey ||
      (event as MouseEvent).altKey
    )
      return;
    event.preventDefault();
    openTool(link.dataset.tool!);
  });
  document.getElementById("find-tool")!.onclick = focusSearch;
  document.addEventListener("keydown", (event) => {
    const target = event.target as HTMLElement;
    const editing =
      target.matches("input, textarea, select") || target.isContentEditable;
    if (
      ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") ||
      (event.key === "/" &&
        !editing &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey)
    ) {
      event.preventDefault();
      focusSearch();
    }
  });
  filter(false);

  function renderRecent(currentId?: string): void {
    const root = document.getElementById("recent-tools")!;
    const visible = recent.filter((id) => id !== currentId);
    root.replaceChildren();
    root.hidden = visible.length === 0;
    if (root.hidden) return;
    root.append(element("span", t("recent")));
    for (const toolId of visible) {
      const link = element("a", localizedTool(byId.get(toolId)!).name);
      link.href = toolPath(toolId);
      link.dataset.tool = toolId;
      root.append(link);
    }
  }

  return {
    home(): void {
      renderRecent();
    },
    visit(id: string): void {
      const existing = recent.indexOf(id);
      if (existing >= 0) recent.splice(existing, 1);
      recent.unshift(id);
      recent.splice(6);
      renderRecent(id);
    },
    refresh(): void {
      filter(false);
      renderRecent(
        document.getElementById("start-page")!.hidden
          ? document.querySelector<HTMLElement>(
              "[data-tool][aria-current='true']",
            )?.dataset.tool
          : undefined,
      );
    },
  };
}
