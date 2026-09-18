// SPDX-License-Identifier: AGPL-3.0-only
import { suiteCore } from "../workbench-core";
import type { SuiteOptions, SuiteResult } from "../workbench-types";
import { formBypassLimits, overLimit } from "../limits";
import { formatNumber, t } from "../i18n";
const INPUT_LIMIT = 32 * 1024 * 1024;
type Source = { file: File; name: string };
type State = { sources: Source[]; selected?: string[] };
const states = new WeakMap<HTMLElement, State>();
const archiveRefresh = new WeakMap<HTMLElement, () => void>();
export function refreshArchives(container: HTMLElement): void {
  archiveRefresh.get(container)?.();
}
function node<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string) {
  const result = document.createElement(tag);
  if (text !== undefined) result.textContent = text;
  return result;
}
function button(text: string, action: () => void) {
  const result = node("button", text);
  result.type = "button";
  result.onclick = action;
  return result;
}
function field(container: HTMLElement, key: string) {
  return container.querySelector<HTMLInputElement | HTMLSelectElement>(
    `[data-key="${key}"]`,
  )!;
}

function panel() {
  const wrapper = node("div");
  const controls = node("div");
  controls.className = "archive-actions";
  const status = node("p");
  status.setAttribute("role", "status");
  const list = node("div");
  list.className = "archive-entries";
  wrapper.append(controls, status, list);
  return { wrapper, controls, status, list };
}
export function configureArchives(
  container: HTMLElement,
  changed: () => void,
): void {
  const state: State = { sources: [] };
  states.set(container, state);
  const picker = container.querySelector<HTMLInputElement>("#suite-file")!;
  const builder = setupBuilder(container, state, picker, changed);
  const browser = setupExplorer(container, state, picker, changed);
  container.append(builder, browser);
  const mode = field(container, "mode");
  const format = field(container, "format") as HTMLSelectElement;
  const pickerLabel = container.querySelector<HTMLLabelElement>(
    'label[for="suite-file"]',
  )!;
  container.insertBefore(
    container.querySelector('label[for="suite-mode"]')!,
    pickerLabel,
  );
  container.insertBefore(mode, pickerLabel);
  const description = node("p");
  description.setAttribute("role", "status");
  container.insertBefore(description, builder);
  const update = () => {
    const action = mode.value;
    const writing = action === "create" || action === "repack";
    const streaming = action === "compress" || action === "decompress";
    const formats = streaming
      ? ["gzip", "brotli", "zstd"]
      : ["zip", "7z", "rar", "tar", "tar.gz"];
    const previous = format.value;
    format.replaceChildren(
      ...formats.map((value) => {
        const option = node("option", value);
        option.value = value;
        return option;
      }),
    );
    format.value = formats.includes(previous) ? previous : formats[0];
    for (const key of [
      "format",
      "password",
      "archiveName",
      "level",
      "outputPassword",
      "solid",
      "encryptNames",
    ]) {
      const input = field(container, key);
      const visible =
        key === "password"
          ? (!writing && !streaming) || action === "repack"
          : key === "format"
            ? writing || streaming
            : ["solid", "encryptNames"].includes(key)
              ? writing && ["7z", "rar"].includes(format.value)
              : writing;
      if (input instanceof HTMLInputElement && input.type === "checkbox")
        input.parentElement!.hidden = !visible;
      else {
        input.hidden = !visible;
        container.querySelector<HTMLLabelElement>(
          `label[for="${input.id}"]`,
        )!.hidden = !visible;
      }
    }
    picker.multiple = action === "create";
    pickerLabel.textContent =
      action === "create"
        ? t("addFiles")
        : streaming
          ? t("chooseFile")
          : t("chooseArchive");
    container.querySelector<HTMLLabelElement>(
      'label[for="suite-format"]',
    )!.textContent =
      action === "decompress" ? t("inputFormat") : t("outputFormatLabel");
    builder.hidden = action !== "create";
    browser.hidden = (writing && action !== "repack") || streaming;
    description.textContent = streaming
      ? t("archiveStreamHelp")
      : action === "create"
        ? t("archiveCreateHelp")
        : t("archiveBrowseHelp");
  };
  mode.addEventListener("change", update);
  format.addEventListener("change", update);
  archiveRefresh.set(container, update);
  update();
}
function setupBuilder(
  container: HTMLElement,
  state: State,
  picker: HTMLInputElement,
  changed: () => void,
): HTMLElement {
  const { wrapper, controls, status, list } = panel();
  const render = () => {
    list.replaceChildren();
    status.textContent = t("archiveFilesBytes", {
      n: formatNumber(state.sources.length),
      bytes: formatNumber(
        state.sources.reduce((sum, source) => sum + source.file.size, 0),
      ),
    });
    state.sources.forEach((source, index) => {
      const row = node("div");
      row.className = "archive-source";
      const path = node("input");
      path.value = source.name;
      path.setAttribute(
        "aria-label",
        t("archivePath", { name: source.file.name }),
      );
      path.oninput = () => {
        source.name = path.value;
        changed();
      };
      row.append(
        path,
        node("span", t("nBytes", { n: formatNumber(source.file.size) })),
        button(t("remove"), () => {
          state.sources.splice(index, 1);
          render();
          changed();
        }),
      );
      list.append(row);
    });
  };
  const add = (files: FileList | null) => {
    const added = Array.from(files ?? []);
    if (
      overLimit(state.sources.length + added.length, 500, {
        bypassLimits: formBypassLimits(),
      }) ||
      overLimit(
        [...state.sources.map((s) => s.file), ...added].reduce(
          (sum, f) => sum + f.size,
          0,
        ),
        INPUT_LIMIT,
        { bypassLimits: formBypassLimits() },
      )
    ) {
      status.textContent =
        "Choose at most 500 files and 32 MiB combined. These files were not added.";
      return;
    }
    state.sources.push(
      ...added.map((file) => ({
        file,
        name: file.webkitRelativePath || file.name,
      })),
    );
    render();
    changed();
  };
  picker.addEventListener("change", () => {
    if (field(container, "mode").value !== "create") return;
    if (!picker.files?.length) {
      state.sources = [];
      render();
    } else add(picker.files);
    picker.value = "";
  });
  const folder = node("input");
  folder.type = "file";
  folder.multiple = true;
  folder.setAttribute("webkitdirectory", "");
  folder.hidden = true;
  folder.onchange = () => {
    add(folder.files);
    folder.value = "";
  };
  controls.append(
    button(t("addFolder"), () => folder.click()),
    button(t("clearArchiveFiles"), () => {
      state.sources = [];
      render();
      changed();
    }),
    folder,
  );
  render();

  return wrapper;
}
function setupExplorer(
  container: HTMLElement,
  state: State,
  picker: HTMLInputElement,
  changed: () => void,
): HTMLElement {
  const { wrapper, controls, status, list } = panel();
  let revision = 0;
  const reset = () => {
    revision++;
    delete state.selected;
    list.replaceChildren();
    status.textContent = t("archiveBrowseHint");
  };
  picker.addEventListener("change", reset);
  field(container, "password").addEventListener("input", reset);
  const browse = button(t("browseEntries"), () => {
    void inspect();
  });
  const inspect = async () => {
    const current = ++revision;
    delete state.selected;
    list.replaceChildren();
    browse.disabled = true;
    status.textContent = t("readingArchive");
    try {
      const file = picker.files?.[0];
      if (!file) throw Error("Choose an archive first.");
      if (
        overLimit(file.size, INPUT_LIMIT, { bypassLimits: formBypassLimits() })
      )
        throw Error("Archive exceeds 32 MiB.");
      const result = await suiteCore(
        "archive-explorer",
        "",
        new Uint8Array(await file.arrayBuffer()),
        {
          mode: "inspect",
          password: field(container, "password").value,
          bypassLimits: formBypassLimits(),
        },
      );
      if (current !== revision || !container.isConnected) return;
      const rows = result.rows ?? [];
      const checks: HTMLInputElement[] = [];
      const update = () => {
        state.selected = checks.filter((c) => c.checked).map((c) => c.value);
        status.textContent = t("archiveSelected", {
          n: formatNumber(state.selected.length),
          total: formatNumber(rows.length),
        });
        changed();
      };
      list.append(
        button(t("selectAllSafe"), () => {
          checks.forEach((c) => (c.checked = !c.disabled));
          update();
        }),
        button(t("hashClear"), () => {
          checks.forEach((c) => (c.checked = false));
          update();
        }),
      );
      for (const row of rows) {
        const label = node("label");
        label.className = "suite-checkbox";
        const check = node("input");
        check.type = "checkbox";
        check.value = String(row.name);
        check.disabled = row.extractable !== true;
        check.checked = !check.disabled;
        check.onchange = update;
        checks.push(check);
        label.append(
          check,
          node(
            "span",
            `${row.name} · ${Number(row.bytes).toLocaleString()} bytes${check.disabled ? " · skipped (unsafe path, duplicate, directory or link)" : ""}`,
          ),
        );
        list.append(label);
      }
      update();
    } catch (error) {
      if (current === revision)
        status.textContent =
          error instanceof Error ? error.message : String(error);
    } finally {
      browse.disabled = false;
    }
  };
  controls.append(browse);
  reset();

  return wrapper;
}
export function archiveOptions(container: HTMLElement): SuiteOptions {
  const selected = states.get(container)?.selected;
  return selected === undefined ? {} : { selected };
}
export async function buildArchive(
  container: HTMLElement,
  options: SuiteOptions,
): Promise<SuiteResult> {
  const sources = states.get(container)?.sources ?? [];
  if (!sources.length) throw Error("Add files or a folder first.");
  const size = sources.reduce((sum, source) => sum + source.file.size, 0);
  if (
    overLimit(sources.length, 500, options) ||
    overLimit(size, INPUT_LIMIT, options)
  )
    throw Error("Archive input exceeds 500 files or 32 MiB.");
  // Snapshot paths and File references before asynchronous reads.
  const snapshot = sources.map((source) => ({ ...source }));
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const source of snapshot) {
    bytes.set(new Uint8Array(await source.file.arrayBuffer()), offset);
    offset += source.file.size;
  }
  return suiteCore("archive-create", "", bytes, {
    ...options,
    entries: snapshot.map((source) => ({
      name: source.name,
      size: source.file.size,
    })),
  });
}

export async function runArchives(
  container: HTMLElement,
  options: SuiteOptions,
): Promise<SuiteResult> {
  const mode = String(options.mode);
  if (mode === "create") return buildArchive(container, options);
  const file =
    container.querySelector<HTMLInputElement>("#suite-file")!.files?.[0];
  if (!file) throw Error("Choose a file first.");
  if (overLimit(file.size, INPUT_LIMIT, options))
    throw Error("File exceeds 32 MiB.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (mode === "compress" || mode === "decompress")
    return suiteCore("compression-workbench", "", bytes, {
      mode,
      algorithm: options.format,
      filename: file.name,
    });
  return suiteCore("archive-explorer", "", bytes, {
    ...options,
    ...archiveOptions(container),
  });
}
