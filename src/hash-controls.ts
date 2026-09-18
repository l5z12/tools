// SPDX-License-Identifier: AGPL-3.0-only
import { hashAlgorithms, popularHashes } from "./lib/hash-tools";
import { choiceLabel, formatNumber, t, type MessageKey } from "./i18n";

export function selectedHashes(container: HTMLElement): string[] {
  return Array.from(
    container.querySelectorAll<HTMLInputElement>("[data-hash]:checked"),
    (input) => input.value,
  );
}

const groupsByFieldset = new WeakMap<
  HTMLElement,
  {
    summary: HTMLElement;
    inputs: HTMLInputElement[];
    category: string;
  }[]
>();

function updateHashes(fieldset: HTMLElement): void {
  const selected = selectedHashes(fieldset);
  const status = fieldset.querySelector<HTMLElement>("[data-hash-status]");
  if (status)
    status.textContent = selected.length
      ? t("hashSelected", {
          n: formatNumber(selected.length),
          names: selected.join(", "),
        })
      : t("hashNone");
  for (const group of groupsByFieldset.get(fieldset) ?? []) {
    const count = group.inputs.filter((input) => input.checked).length;
    group.summary.textContent = t("hashGroup", {
      category: choiceLabel(group.category),
      n: formatNumber(count),
      total: formatNumber(group.inputs.length),
    });
  }
}

export function refreshHashes(container: HTMLElement): void {
  const fieldset = container.querySelector<HTMLElement>(".hash-selection");
  if (!fieldset) return;
  const legend = fieldset.querySelector("legend");
  if (legend) legend.textContent = t("hashLegend");
  for (const button of fieldset.querySelectorAll<HTMLElement>(
    "[data-hash-preset]",
  )) {
    const key = button.dataset.hashPreset;
    if (key === "popular") button.textContent = t("hashPopular");
    if (key === "all") button.textContent = t("hashSelectAll");
    if (key === "clear") button.textContent = t("hashClear");
  }
  updateHashes(fieldset);
}

export function configureHashes(
  container: HTMLElement,
  onChange: () => void,
): void {
  const fieldset = document.createElement("fieldset");
  fieldset.className = "hash-selection";
  const legend = document.createElement("legend");
  legend.textContent = t("hashLegend");
  const actions = document.createElement("div");
  actions.className = "hash-presets";
  const status = document.createElement("p");
  status.dataset.hashStatus = "";
  status.setAttribute("role", "status");
  const groups: {
    summary: HTMLElement;
    inputs: HTMLInputElement[];
    category: string;
  }[] = [];
  groupsByFieldset.set(fieldset, groups);

  function select(names: readonly string[]): void {
    const selected = new Set(names);
    for (const input of fieldset.querySelectorAll<HTMLInputElement>(
      "[data-hash]",
    ))
      input.checked = selected.has(input.value);
    updateHashes(fieldset);
  }

  const presets: [MessageKey, string, readonly string[]][] = [
    ["hashPopular", "popular", popularHashes],
    ["hashSelectAll", "all", hashAlgorithms.map((algorithm) => algorithm.name)],
    ["hashClear", "clear", []],
  ];
  for (const [key, preset, names] of presets) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = t(key);
    button.dataset.hashPreset = preset;
    button.onclick = () => {
      select(names);
      onChange();
    };
    actions.append(button);
  }
  fieldset.append(legend, actions, status);
  for (const category of new Set(
    hashAlgorithms.map((algorithm) => algorithm.category),
  )) {
    const details = document.createElement("details");
    const summary = document.createElement("summary");
    const choices = document.createElement("div");
    choices.className = "hash-choices";
    const inputs: HTMLInputElement[] = [];
    for (const algorithm of hashAlgorithms.filter(
      (algorithm) => algorithm.category === category,
    )) {
      const label = document.createElement("label");
      const input = document.createElement("input");
      input.type = "checkbox";
      input.value = algorithm.name;
      input.dataset.hash = algorithm.name;
      label.append(input, document.createTextNode(algorithm.name));
      choices.append(label);
      inputs.push(input);
    }
    groups.push({ summary, inputs, category });
    details.append(summary, choices);
    fieldset.append(details);
  }
  fieldset.addEventListener("change", () => updateHashes(fieldset));
  select(popularHashes);
  container.append(fieldset);
}
