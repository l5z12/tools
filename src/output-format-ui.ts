// SPDX-License-Identifier: AGPL-3.0-only
import {
  defaultFormat,
  formatOutput,
  outputModes,
  outputSource,
  supportsOutputFormat,
  type OutputFormat,
  type OutputMode,
} from "./output-format";
import type { SuiteResult } from "./workbench-types";
import { choiceLabel, t } from "./i18n";

type RenderOutput = (text: string, formatted: boolean) => void;
let formatted = false;
let dispose: (() => void) | undefined;
export const hasFormattedOutput = () => formatted;

export function clearOutputFormat(): void {
  dispose?.();
  dispose = undefined;
  formatted = false;
  document.getElementById("output-format-controls")?.replaceChildren();
}

function selectControl(
  parent: HTMLElement,
  labelText: string,
  key: string,
  choices: readonly string[],
  initial: string,
): HTMLSelectElement {
  const label = document.createElement("label");
  label.textContent = labelText;
  const select = document.createElement("select");
  select.id = `output-format-${key}`;
  label.htmlFor = select.id;
  for (const value of choices) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = choiceLabel(value);
    select.append(option);
  }
  select.value = initial;
  parent.append(label, select);
  return select;
}

export function configureOutputFormat(
  id: string,
  original: string,
  result: SuiteResult | null,
  render: RenderOutput,
): void {
  clearOutputFormat();
  const root = document.getElementById("output-format-controls");
  if (!root || !supportsOutputFormat(id)) return;
  if (id === "hash-workbench" && result?.formatBytes === undefined) return;

  const mode = selectControl(
    root,
    t("outputFormat"),
    "mode",
    outputModes,
    "Original",
  );
  const hexOptions = document.createElement("div");
  hexOptions.className = "output-format-options";
  const letterCase = selectControl(
    hexOptions,
    t("hexLetterCase"),
    "case",
    ["Lowercase", "Uppercase"],
    "Lowercase",
  );
  const separator = selectControl(
    hexOptions,
    t("betweenGroups"),
    "separator",
    ["None", "Spaces", "Hyphens", "Colons", "Commas", "Newlines"],
    "None",
  );
  const groupBytes = selectControl(
    hexOptions,
    t("bytesPerGroup"),
    "group",
    ["1", "2", "4", "8", "16"],
    "1",
  );
  const prefix = selectControl(
    hexOptions,
    t("groupPrefix"),
    "prefix",
    ["None", "0x", "\\x"],
    "None",
  );
  const lineBytes = selectControl(
    hexOptions,
    t("bytesPerLine"),
    "line",
    ["0", "8", "16", "32", "64"],
    "0",
  );

  const base64Options = document.createElement("div");
  base64Options.className = "output-format-options";
  const padding = selectControl(
    base64Options,
    t("base64Padding"),
    "padding",
    ["Padded", "Unpadded"],
    "Padded",
  );
  const wrap = selectControl(
    base64Options,
    t("base64Wrap"),
    "wrap",
    ["0", "64", "76"],
    "0",
  );
  const note = document.createElement("p");
  note.className = "muted";
  note.setAttribute("role", "status");
  root.append(hexOptions, base64Options, note);

  const separators: Record<string, string> = {
    None: "",
    Spaces: " ",
    Hyphens: "-",
    Colons: ":",
    Commas: ", ",
    Newlines: "\n",
  };
  let source: ReturnType<typeof outputSource> | undefined;
  let revision = 0;
  const update = async () => {
    const ticket = ++revision;
    const selected = mode.value as OutputMode;
    hexOptions.hidden = selected !== "Hex" && selected !== "C byte array";
    base64Options.hidden = selected !== "Base64" && selected !== "Base64url";
    // C arrays use byte-sized groups and their language's required punctuation.
    for (const control of [separator, groupBytes, prefix, lineBytes])
      control.disabled = selected === "C byte array";
    if (selected === "Original") {
      formatted = false;
      note.textContent = "";
      render(original, false);
      return;
    }
    try {
      source ??= outputSource(id, original, result);
      const options: OutputFormat = {
        ...defaultFormat,
        mode: selected,
        uppercase: letterCase.value === "Uppercase",
        separator: separators[separator.value],
        groupBytes: Number(groupBytes.value),
        prefix: prefix.value === "None" ? "" : prefix.value,
        lineBytes: Number(lineBytes.value),
        padding: padding.value === "Padded",
        wrap: Number(wrap.value),
      };
      formatted = false;
      render(original, false);
      note.textContent = t("formatting");
      const text = await formatOutput(source.bytes, options);
      if (ticket !== revision) return;
      formatted = true;
      note.textContent = t("formatNote", { description: source.description });
      render(text, true);
    } catch (error) {
      if (ticket !== revision) return;
      // Never leave Copy/Download targeting a stale, differently formatted result.
      formatted = false;
      mode.value = "Original";
      hexOptions.hidden = true;
      base64Options.hidden = true;
      render(original, false);
      note.textContent = t("formatError", { error: String(error) });
    }
  };
  root.addEventListener("change", update);
  dispose = () => {
    revision++;
    root.removeEventListener("change", update);
  };
  hexOptions.hidden = true;
  base64Options.hidden = true;
}
