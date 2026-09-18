// SPDX-License-Identifier: AGPL-3.0-only
import { hashAlgorithms, popularHashes } from "./lib/hash-tools";

export function selectedHashes(container: HTMLElement): string[] {
  return Array.from(
    container.querySelectorAll<HTMLInputElement>("[data-hash]:checked"),
    (input) => input.value,
  );
}

export function configureHashes(
  container: HTMLElement,
  onChange: () => void,
): void {
  const fieldset = document.createElement("fieldset");
  fieldset.className = "hash-selection";
  const legend = document.createElement("legend");
  legend.textContent = "Hash and checksum variants";
  const actions = document.createElement("div");
  actions.className = "hash-presets";
  const status = document.createElement("p");
  status.setAttribute("role", "status");
  const groups: {
    summary: HTMLElement;
    inputs: HTMLInputElement[];
    category: string;
  }[] = [];

  function update(): void {
    const selected = selectedHashes(fieldset);
    status.textContent = selected.length
      ? `${selected.length} selected: ${selected.join(", ")}`
      : "Select at least one variant.";
    for (const group of groups) {
      const count = group.inputs.filter((input) => input.checked).length;
      group.summary.textContent = `${group.category} (${count}/${group.inputs.length} selected)`;
    }
  }

  function select(names: readonly string[]): void {
    const selected = new Set(names);
    for (const input of fieldset.querySelectorAll<HTMLInputElement>(
      "[data-hash]",
    ))
      input.checked = selected.has(input.value);
    update();
  }

  const presets: [string, readonly string[]][] = [
    ["Popular", popularHashes],
    ["Select all", hashAlgorithms.map((algorithm) => algorithm.name)],
    ["Clear selection", []],
  ];
  for (const [label, names] of presets) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
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
  // The workbench's delegated change listener invalidates existing results.
  fieldset.addEventListener("change", update);
  select(popularHashes);
  container.append(fieldset);
}
