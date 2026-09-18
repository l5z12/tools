// SPDX-License-Identifier: AGPL-3.0-only
import type { SqlResultSet } from "./engine";

export function renderSqlResults(
  container: HTMLElement,
  sets: SqlResultSet[],
): void {
  for (const [index, set] of sets.entries()) {
    const section = document.createElement("section");
    const heading = document.createElement("h3");
    heading.textContent =
      set.title ??
      `Statement ${index + 1} · ${set.values.length} ${set.values.length === 1 ? "row" : "rows"}`;
    section.append(heading);
    if (set.columns.length) {
      const scroll = document.createElement("div");
      scroll.className = "suite-table code-analysis-table";
      scroll.tabIndex = 0;
      scroll.setAttribute("aria-label", `Statement ${index + 1} results`);
      const table = document.createElement("table");
      const head = table.createTHead().insertRow();
      for (const column of set.columns) {
        const th = document.createElement("th");
        th.scope = "col";
        th.textContent = column;
        head.append(th);
      }
      const body = table.createTBody();
      for (const values of set.values.slice(0, 500)) {
        const row = body.insertRow();
        for (const value of values)
          row.insertCell().textContent =
            value === null
              ? "NULL"
              : typeof value === "object"
                ? JSON.stringify(value)
                : String(value);
      }
      scroll.append(table);
      section.append(scroll);
      if (set.values.length > 500) {
        const note = document.createElement("p");
        note.textContent =
          "Showing the first 500 rows; raw view and copy contain all returned rows.";
        section.append(note);
      }
    } else {
      const message = document.createElement("p");
      message.textContent = "Completed; no result columns.";
      section.append(message);
    }
    container.append(section);
  }
}
