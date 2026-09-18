// SPDX-License-Identifier: AGPL-3.0-only
import { workbenchTools, workbenchIds } from "./lib/workbench-tools";
import { suiteCore } from "./workbench-core";
import { configureHashes, selectedHashes } from "./hash-controls";
import { hashSuite } from "./hash-runtime";
import { configureFingerprintProfile } from "./browser-fingerprint/controls";
import { configureArchives, runArchives } from "./archives/ui";
import { mediaIds } from "./lib/media-tools";
import { pythonIds } from "./lib/python-tools";
import { rustCompilerIds } from "./lib/rust-tools";
import { goIds } from "./lib/go-tools";
import { sqlRuntimeIds } from "./lib/sql-tools";
import { configureSqlite, runSqlite, cancelSqlite } from "./sql/runtime";
import { configureDatabaseControls } from "./sql/controls";
import { cppRuntimeIds } from "./lib/cpp-tools";
import { configureCpp, runCpp, cancelCpp } from "./cpp/runtime";
import { configureGo, runGo, cancelGo } from "./go/runtime";
import { configureRust, runRust, cancelRust } from "./rust/runtime";
import { configureMedia, runMedia, cancelMedia } from "./media/runtime";
import {
  configurePython,
  runPython,
  cancelPython,
  disposePython,
} from "./python/runtime";
import { configureCrypto } from "./crypto-controls";
import { imageSuite } from "./workbench-images";
import { prepareBinaryComparison } from "./utility-ui";
import type { SuiteOptions, SuiteResult } from "./workbench-types";
import { configureReference, queryReference, referenceIds } from "./references";
import { clearWorkbenchView, renderWorkbenchView } from "./workbench-view";
import { element } from "./ui/dom";
export { workbenchIds };
export { downloadSuite } from "./workbench-view";

let currentId = "";
let invalidate = () => {};
let columnVersion = 0;
const root = () => document.getElementById("suite-controls")!;
export function configureSuite(
  id: string,
  onChange: () => void,
  onRun = () => {},
) {
  cancelMedia();
  disposePython();
  cancelRust();
  cancelGo();
  cancelCpp();
  cancelSqlite();
  configureReference(id, onRun);
  currentId = id;
  invalidate = onChange;
  columnVersion++;
  const container = root();
  container.replaceChildren();
  const tool = workbenchTools.find((t) => t.id === id);
  container.hidden = !tool;
  if (!tool) return;
  document.getElementById("file-field")!.hidden = true;
  document.getElementById("animation-options")!.hidden = true;
  const hide =
    tool.inputMode === "file" ||
    tool.inputMode === "images" ||
    tool.inputMode === "none";
  document.getElementById("input")!.hidden = hide;
  document.querySelector<HTMLElement>(".field-header")!.hidden = hide;
  if (tool.help) {
    if (tool.help.length > 240) {
      const help = element("details");
      help.className = "usage-help";
      help.append(
        element("summary", "Usage & limits"),
        element("p", tool.help),
      );
      container.append(help);
    } else container.append(element("p", tool.help));
  }
  if (tool.inputMode && tool.inputMode !== "none") {
    const label = element(
      "label",
      tool.inputMode === "optional-file"
        ? sqlRuntimeIds.has(id)
          ? "Optional SQLite database (SQL runs against a fresh copy)"
          : "Optional file (takes precedence over text)"
        : "Choose file" + (tool.multiple ? "s" : ""),
    );
    label.htmlFor = "suite-file";
    const picker = element("input");
    picker.type = "file";
    picker.id = "suite-file";
    picker.multiple = !!tool.multiple;
    picker.accept =
      tool.accept ??
      (tool.inputMode === "images"
        ? "image/png,image/jpeg,image/webp,image/gif,image/avif,image/bmp"
        : "");
    container.append(label, picker);
    const clear = element("button", "Clear file selection");
    clear.type = "button";
    clear.className = "link-button";
    clear.onclick = () => {
      picker.value = "";
      picker.dispatchEvent(new Event("change", { bubbles: true }));
      invalidate();
    };
    container.append(clear);
  }
  if (id === "hash-workbench") configureHashes(container, onChange);
  for (const f of tool.fields) {
    const label = element("label", f.label);
    label.htmlFor = "suite-" + f.key;
    let input: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
    if (f.choices) {
      input = element("select");
      f.choices.forEach((c) => {
        const option = element("option", c);
        option.value = c;
        input.append(option);
      });
    } else if (f.type === "textarea") {
      input = element("textarea");
      input.rows = 4;
      input.spellcheck = false;
    } else {
      input = element("input");
      input.type = f.type ?? "text";
      if (f.type === "checkbox") input.checked = f.value === "true";
    }
    input.id = "suite-" + f.key;
    input.dataset.key = f.key;
    input.value = f.value ?? "";
    input.autocomplete = "off";
    if (f.type === "checkbox") {
      label.className = "suite-checkbox";
      label.prepend(input);
      container.append(label);
    } else {
      container.append(label, input);
    }
  }
  if (id === "browser-fingerprint") configureFingerprintProfile(container);
  if (id === "archive-workbench") configureArchives(container, onChange);
  if (mediaIds.has(id)) configureMedia(container, !!tool.multiple, onChange);
  if (pythonIds.has(id)) configurePython(container, id !== "python-runner");
  if (rustCompilerIds.has(id)) configureRust(container);
  if (goIds.has(id)) configureGo(container);
  if (cppRuntimeIds.has(id)) configureCpp(container);
  if (sqlRuntimeIds.has(id)) configureSqlite(container);
  if (id === "sql-schema") configureDatabaseControls(container, onRun);
  if (id === "csv-workbench") {
    const button = element("button", "Read columns");
    button.type = "button";
    const status = element("p");
    status.setAttribute("role", "status");
    const columns = element("div");
    columns.id = "suite-columns";
    button.onclick = async () => {
      const version = ++columnVersion;
      const source = (document.getElementById("input") as HTMLTextAreaElement)
        .value;
      button.disabled = true;
      status.textContent = "Reading columns…";
      try {
        const r = await suiteCore(id, source, new Uint8Array(), {
          preview: true,
        });
        if (version !== columnVersion || currentId !== id) return;
        if (
          source !==
          (document.getElementById("input") as HTMLTextAreaElement).value
        ) {
          status.textContent = "Input changed. Read columns again.";
          return;
        }
        columns.replaceChildren();
        for (const key of r.headers ?? []) {
          const row = element("div");
          row.className = "csv-column";
          row.dataset.column = key;
          const check = element("input");
          check.type = "checkbox";
          check.checked = true;
          check.setAttribute("aria-label", "Include " + key);
          const name = element("input");
          name.value = key;
          name.setAttribute("aria-label", "Output name for " + key);
          const up = element("button", "↑");
          up.type = "button";
          up.setAttribute("aria-label", "Move " + key + " up");
          up.onclick = () => {
            if (row.previousElementSibling)
              columns.insertBefore(row, row.previousElementSibling);
            invalidate();
          };
          const down = element("button", "↓");
          down.type = "button";
          down.setAttribute("aria-label", "Move " + key + " down");
          down.onclick = () => {
            if (row.nextElementSibling)
              columns.insertBefore(row.nextElementSibling, row);
            invalidate();
          };
          row.append(check, element("span", key), name, up, down);
          columns.append(row);
        }
        status.textContent =
          "Select columns, edit their output names, and use arrows to reorder.";
        invalidate();
      } catch (e) {
        status.textContent = String(e);
      } finally {
        button.disabled = false;
      }
    };
    container.append(button, status, columns);
  }
  configureCrypto(id, container, onChange);
  container.oninput = () => invalidate();
  container.onchange = () => invalidate();
}
export async function executeSuite(
  id: string,
  input: string,
): Promise<SuiteResult> {
  const tool = workbenchTools.find((t) => t.id === id)!;
  const options: SuiteOptions = { now: Math.floor(Date.now() / 1000) };
  if (id === "everyday-calendar")
    options.uid = crypto.randomUUID() + "@tools.l5z12.dev";
  root()
    .querySelectorAll<
      HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
    >("[data-key]")
    .forEach((e) => {
      options[e.dataset.key!] =
        e instanceof HTMLInputElement && e.type === "checkbox"
          ? e.checked
          : e.value;
    });
  if (referenceIds.has(id)) return queryReference(id, input, options);
  if (id === "browser-fingerprint") {
    const { browserFingerprint } = await import("./browser-fingerprint");
    return browserFingerprint(options);
  }
  if (id === "hash-workbench") {
    options.algorithms = selectedHashes(root());
    if (!(options.algorithms as string[]).length)
      throw Error("Select at least one hash or checksum variant.");
  }
  if (id === "csv-workbench") {
    const rows = Array.from(
      root().querySelectorAll<HTMLElement>("[data-column]"),
    );
    if (rows.length)
      options.columns = rows
        .filter((r) => r.querySelector("input")!.checked)
        .map((r) => ({
          key: r.dataset.column,
          name: r.querySelectorAll("input")[1].value,
        }));
  }
  const files = Array.from(
    (document.getElementById("suite-file") as HTMLInputElement | null)?.files ??
      [],
  );
  if (id === "archive-workbench") return runArchives(root(), options);
  if (mediaIds.has(id)) return runMedia(id, files, options, root());
  if (sqlRuntimeIds.has(id))
    return runSqlite(id, input, files[0], options, root());
  if (goIds.has(id)) return runGo(id, input, files[0], options, root());
  if (cppRuntimeIds.has(id))
    return runCpp(id, input, files[0], options, root());
  if (rustCompilerIds.has(id))
    return runRust(id, input, files[0], options, root());
  if (pythonIds.has(id))
    return runPython(
      input,
      files[0],
      options,
      root(),
      id === "python-runner" ? undefined : id,
    );
  if (tool.inputMode === "images") return imageSuite(id, files, options);
  if (id === "util-binary-diff") {
    const comparison = await prepareBinaryComparison(files);
    return suiteCore(id, "", comparison.bytes, {
      ...options,
      ...comparison.options,
    });
  }
  if (tool.inputMode === "file" && !files.length)
    throw Error("Choose a file first.");
  const f = files[0];
  if (f && f.size > 32 * 1024 * 1024) throw Error("File exceeds 32 MiB.");
  options.fileProvided = !!f;
  options.filename = f?.name;
  const bytes = f ? new Uint8Array(await f.arrayBuffer()) : new Uint8Array();
  if (id === "hash-workbench") return hashSuite(input, bytes, options);
  return suiteCore(id, input, bytes, options);
}

export function clearSuite(): void {
  cancelCpp();
  cancelSqlite();
  cancelGo();
  cancelMedia();
  cancelPython();
  cancelRust();
  clearWorkbenchView();
}

export function renderSuite(container: HTMLElement, result: SuiteResult): void {
  renderWorkbenchView(container, result, currentId, invalidate);
}
