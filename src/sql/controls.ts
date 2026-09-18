// SPDX-License-Identifier: AGPL-3.0-only
import type { DatabaseBrowser } from "./inspector";

function select(container: HTMLElement, key: string): HTMLSelectElement {
  return container.querySelector<HTMLSelectElement>(`#suite-${key}`)!;
}

function choices(
  control: HTMLSelectElement,
  values: { value: string; label: string }[],
  selected: string,
): void {
  control.replaceChildren(
    ...values.map((item) => {
      const option = document.createElement("option");
      option.value = item.value;
      option.textContent = item.label;
      return option;
    }),
  );
  control.value = selected;
}

export function configureDatabaseControls(
  container: HTMLElement,
  run: () => void,
): void {
  const table = select(container, "table");
  const sort = select(container, "sort");
  const page = container.querySelector<HTMLInputElement>("#suite-page")!;
  page.min = "1";
  page.step = "1";
  const navigation = document.createElement("div");
  for (const [label, delta] of [
    ["Previous page", -1],
    ["Next page", 1],
  ] as const) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.dataset.sqlitePage = String(delta);
    button.disabled = true;
    button.onclick = () => {
      page.value = String(Number(page.value) + delta);
      page.dispatchEvent(new Event("input", { bubbles: true }));
      run();
    };
    navigation.append(button);
  }
  container.append(navigation);
  function resetSort() {
    choices(sort, [{ value: "", label: "Default order" }], "");
  }
  function resetTable() {
    choices(table, [{ value: "", label: "Read the selected file first" }], "");
    page.value = "1";
    resetSort();
  }
  resetTable();
  for (const control of container.querySelectorAll("[data-key]")) {
    control.addEventListener("input", () => {
      container
        .querySelectorAll<HTMLButtonElement>("[data-sqlite-page]")
        .forEach((button) => {
          button.disabled = true;
        });
    });
  }
  container
    .querySelector<HTMLInputElement>("#suite-file")!
    .addEventListener("change", () => {
      resetTable();
      container
        .querySelectorAll<HTMLButtonElement>("[data-sqlite-page]")
        .forEach((button) => {
          button.disabled = true;
        });
    });
  table.addEventListener("change", () => {
    page.value = "1";
    resetSort();
  });
  for (const key of ["filter", "sort", "direction", "pageSize"]) {
    container.querySelector(`#suite-${key}`)!.addEventListener("input", () => {
      page.value = "1";
    });
  }
}

export function updateDatabaseControls(
  container: HTMLElement,
  result: DatabaseBrowser,
): void {
  choices(
    select(container, "table"),
    result.tables.length
      ? result.tables.map((table) => ({
          value: table.name,
          label: `${table.name} (${table.type})`,
        }))
      : [{ value: "", label: "No user tables or views" }],
    result.selected,
  );
  const sort = select(container, "sort");
  const selectedSort = result.columns.includes(sort.value) ? sort.value : "";
  choices(
    sort,
    [
      { value: "", label: "Default order" },
      ...result.columns.map((name) => ({ value: name, label: name })),
    ],
    selectedSort,
  );
  const page = container.querySelector<HTMLInputElement>("#suite-page")!;
  page.value = String(result.page);
  for (const button of container.querySelectorAll<HTMLButtonElement>(
    "[data-sqlite-page]",
  )) {
    button.disabled =
      !!result.error ||
      (button.dataset.sqlitePage === "-1"
        ? result.page <= 1
        : result.page >= result.pages);
  }
}
