// SPDX-License-Identifier: AGPL-3.0-only
import {
  configureSuite,
  executeSuite,
  renderSuite,
  clearSuite,
  downloadSuite,
  refreshSuiteLocale,
  workbenchIds,
} from "./workbench-ui";
import { suiteCore } from "./workbench-core";
import type { SuiteResult } from "./workbench-types";
import {
  clearOutputFormat,
  configureOutputFormat,
  hasFormattedOutput,
} from "./output-format-ui";
import { referenceInputChanged, isReferenceBrowser } from "./references";
let suiteResult: SuiteResult | null = null;
import { configureDirectory } from "./ui/directory";
import { TextDrafts } from "./ui/drafts";
import { updatePageMetadata } from "./ui/page-metadata";
import { toolPath } from "./lib/site";
import {
  applyDocumentMessages,
  applyLocalizedCatalog,
  cycleLanguagePreference,
  ensureLocale,
  formatNumber,
  languageButtonLabel,
  localizedTool,
  t,
  themeButtonLabel,
} from "./i18n";
import { archiveAliases } from "./lib/archive-tools";
import {
  configureAnimation,
  loadAnimationFiles,
  processAnimation,
} from "./animation";
import { tools, type Tool } from "./lib/catalog";
import { renderResult } from "./results";
import { unitOptions } from "./lib/converters";
import { processImage, type ImageArtifact } from "./image-tools";
import { armTimeout, formBypassLimits, overLimit } from "./limits";
let artifact: ImageArtifact | null = null;
const fileTool = (id: string) =>
  id === "file-sha256" || id === "hex-viewer" || id.startsWith("image-");
type Controls = {
  input: HTMLTextAreaElement;
  output: HTMLTextAreaElement;
  option: HTMLTextAreaElement;
  file: HTMLInputElement;
  search: HTMLInputElement;
  index: HTMLDetailsElement;
  run: HTMLButtonElement;
  copy: HTMLButtonElement;
  download: HTMLButtonElement;
};
function $<K extends string>(
  id: K,
): K extends keyof Controls ? Controls[K] : HTMLElement {
  const node = document.getElementById(id);
  if (!node) throw new Error("Missing element: " + id);
  return node as K extends keyof Controls ? Controls[K] : HTMLElement;
}
let current: Tool | undefined;
let ready = false,
  busy = false;
let worker: Worker;
let request = 0;
let timeout: ReturnType<typeof setTimeout> | undefined;
const drafts = new TextDrafts();
let clearedText: string | undefined;
let linkFeedback: ReturnType<typeof setTimeout> | undefined;
let copyFeedback: ReturnType<typeof setTimeout> | undefined;
function updateFileLimitLabel(): void {
  const fileLabel =
    document.querySelector<HTMLLabelElement>('label[for="file"]');
  if (!fileLabel || !current) return;
  if (formBypassLimits()) {
    fileLabel.textContent = t("chooseFile");
    return;
  }
  fileLabel.textContent =
    current.id === "hex-viewer" ? t("chooseFile1MiB") : t("chooseFile32");
}
function updateRunState(): void {
  $("run").disabled = !current || !ready || busy;
  $("run-label").textContent = busy ? t("working") : t("runTool");
  $("tool-form").setAttribute("aria-busy", String(busy));
}
function updateInputSummary(): void {
  const input = $("input");
  $("input-summary").hidden = input.hidden;
  const lines = input.value ? input.value.split("\n").length : 0;
  $("input-summary").textContent = t("inputSummary", {
    n: formatNumber(input.value.length),
    lines: formatNumber(lines),
    lineLabel: lines === 1 ? t("line") : t("lines"),
  });
}
function forgetClear(): void {
  clearedText = undefined;
  $("undo-clear").hidden = true;
}

function clearResult() {
  clearOutputFormat();
  clearSuite();
  suiteResult = null;
  if (artifact) {
    URL.revokeObjectURL(artifact.url);
    if (artifact.secondaryUrl) URL.revokeObjectURL(artifact.secondaryUrl);
    artifact = null;
  }
  $("result-view").replaceChildren();
  $("result-view").hidden = true;
  $("toggle-raw").hidden = true;
  $("output").hidden = true;
  $("empty-result").hidden = false;
  $("output").value = "";
  clearTimeout(copyFeedback);
  $("copy").textContent = t("copy");
  $("copy").disabled = true;
  $("download").disabled = true;
  $("error").hidden = true;
  $("result-status").textContent = t("readyWhenYouAre");
}
function fail(message: string) {
  clearTimeout(timeout);
  busy = false;
  updateRunState();
  if (!current) return;
  $("error").textContent = message;
  $("error").hidden = false;
  $("result-status").textContent = t("checkMessage");
  $("error").focus();
}
function result(value: string) {
  if (!current) return;
  renderOutput(value, false);
  configureOutputFormat(current.id, value, suiteResult, renderOutput);
}
function renderOutput(value: string, formatted: boolean) {
  if (!current) return;
  $("empty-result").hidden = true;
  clearSuite();
  if (formatted) {
    const preview = document.createElement("pre");
    const code = document.createElement("code");
    code.textContent = value.slice(0, 65536);
    preview.append(code);
    $("result-view").replaceChildren(preview);
    $("result-view").hidden = false;
    if (value.length > 65536) {
      const note = document.createElement("p");
      note.textContent = t("previewLimited");
      $("result-view").append(note);
    }
  }
  let rich = formatted;
  if (!formatted && suiteResult) {
    renderSuite($("result-view"), suiteResult);
    rich = true;
  } else if (!formatted) {
    rich = renderResult(
      $("result-view"),
      current.id,
      value,
      $("input").value,
      artifact,
    );
  }
  $("output").hidden = rich;
  $("toggle-raw").hidden = !rich;
  $("toggle-raw").textContent = t("showRaw");
  clearTimeout(timeout);
  busy = false;
  updateRunState();
  $("output").value = value;
  $("copy").disabled = false;
  $("download").disabled = false;
  $("result-status").textContent = t("doneBytes", {
    n: formatNumber(new TextEncoder().encode(value).length),
  });
  $("error").hidden = true;
}
function startWorker() {
  worker = new Worker(new URL("./worker.ts", import.meta.url), {
    type: "module",
  });
  worker.onmessage = ({ data }) => {
    if (data.ready) {
      ready = true;
      $("engine-status").textContent = t("readyLocal");
      updateRunState();
      if (current && isReferenceBrowser(current.id) && !busy) execute();
      return;
    }
    if (data.fatal) {
      console.error("WebAssembly initialization failed:", data.fatal);
      ready = false;
      $("engine-status").textContent = t("unableToLoad");
      fail(t("wasmFailed"));
      return;
    }
    if (data.request !== request) return;
    if (data.error) fail(data.error);
    else result(data.result);
  };
  worker.onerror = () => {
    ready = false;
    $("engine-status").textContent = t("unableToLoad");
    fail(t("workerFailed"));
  };
}
function saveDraft(): void {
  if (current && !$("input").hidden)
    drafts.save(current.id, {
      input: $("input").value,
      option: $("option").value,
    });
}

function showHome(message = ""): void {
  saveDraft();
  current = undefined;
  request++;
  busy = false;
  clearTimeout(timeout);
  clearResult();
  updateRunState();
  $("workspace").hidden = true;
  $("start-page").hidden = false;
  $("route-message").textContent = message;
  $("route-message").hidden = !message;
  updatePageMetadata();
  document
    .querySelectorAll("[data-tool]")
    .forEach((link) => link.removeAttribute("aria-current"));
  directory.home();
}

function select(id: string): void {
  const archiveMode = archiveAliases[id];
  if (archiveMode) id = "archive-workbench";
  const found = tools.find((t) => t.id === id);
  if (!found) {
    showHome(id ? t("toolUnavailable") : "");
    return;
  }
  if (location.pathname !== toolPath(found.id))
    history.replaceState(null, "", toolPath(found.id) + location.search);
  if (current?.id === found.id && !archiveMode) return;
  saveDraft();
  const draft = drafts.read(found.id);
  forgetClear();
  clearTimeout(linkFeedback);
  $("copy-tool-link").textContent = t("copyLink");
  current = found;
  $("workspace").hidden = false;
  $("start-page").hidden = true;
  request++;
  busy = false;
  clearTimeout(timeout);
  updateRunState();
  clearResult();
  $("tool-title").textContent = localizedTool(current).name;
  $("description").textContent = localizedTool(current).description;
  $("tool-category").textContent =
    current.tags?.map((t) => "#" + t).join(" ") ?? "";
  $("input").value = draft?.input ?? current.sample;
  $("input").rows =
    ["Text", "Encoding", "Data", "Developer"].includes(current.group) ||
    ["markdown-preview", "html-preview", "line-diff", "jwt-decode"].includes(
      current.id,
    )
      ? 7
      : 2;
  $("option").value = draft?.option ?? current.option;
  $("option-label").textContent =
    localizedTool(current).optionLabel || t("options");
  $("option-field").hidden = !current.optionLabel;
  const unitSelect = document.getElementById(
    "unit-select",
  ) as HTMLSelectElement;
  const choices = unitOptions[current.id];
  unitSelect.replaceChildren();
  unitSelect.hidden = !choices;
  $("option").hidden = Boolean(choices);
  if (choices) {
    for (const unit of choices) unitSelect.add(new Option(unit, unit));
    unitSelect.value = $("option").value;
  }
  unitSelect.onchange = () => {
    $("option").value = unitSelect.value;
    invalidate();
  };
  $("file-field").hidden = !fileTool(current.id);
  $("file").accept = current.id.startsWith("image-")
    ? "image/png,image/jpeg,image/webp,image/gif,image/avif,image/bmp"
    : "";
  $("file").value = "";
  updateFileLimitLabel();
  configureAnimation(current.id);
  $("input").hidden = fileTool(current.id);
  document.querySelector<HTMLElement>(".field-header")!.hidden = fileTool(
    current.id,
  );
  configureSuite(current.id, invalidate, execute);
  if (archiveMode) {
    const operation = document.getElementById(
      "suite-mode",
    ) as HTMLSelectElement;
    operation.value = archiveMode;
    operation.dispatchEvent(new Event("change", { bubbles: true }));
  }
  if (isReferenceBrowser(current.id)) $("input").rows = 1;
  $("input").placeholder = isReferenceBrowser(current.id)
    ? t("searchReferencePlaceholder")
    : "";
  document.querySelector<HTMLLabelElement>('label[for="input"]')!.textContent =
    isReferenceBrowser(current.id) ? t("searchReference") : t("input");
  $("tool-form").hidden = false;
  updatePageMetadata(current);
  document
    .querySelectorAll<HTMLElement>("[data-tool]")
    .forEach((a) =>
      a.setAttribute("aria-current", String(a.dataset.tool === found.id)),
    );
  updateInputSummary();
  directory.visit(current.id);
}
async function execute() {
  updateInputSummary();
  if (!current || busy || !ready) return;
  clearResult();
  busy = true;
  updateRunState();
  $("result-status").textContent = t("working");
  const ticket = ++request;
  const limits = { bypassLimits: formBypassLimits() };
  try {
    if (workbenchIds.has(current.id)) {
      const value = await executeSuite(current.id, $("input").value);
      if (ticket === request) {
        suiteResult = value;
        result(
          value.text ?? JSON.stringify(value.data ?? value.rows ?? {}, null, 2),
        );
      }
      return;
    }
    if (current.id === "image-apng" || current.id === "image-fallback-apng") {
      const image = await processAnimation(limits.bypassLimits);
      if (ticket === request) {
        artifact = image;
        result(image.text);
      } else {
        URL.revokeObjectURL(image.url);
        if (image.secondaryUrl) URL.revokeObjectURL(image.secondaryUrl);
      }
      return;
    }
    if (current.id.startsWith("image-")) {
      const image = await processImage(
        current.id,
        $("file").files?.[0],
        $("option").value,
        limits.bypassLimits,
      );
      if (ticket === request) {
        artifact = image;
        result(image.text);
      } else URL.revokeObjectURL(image.url);
      return;
    }
    if (current.id === "uuid" || current.id === "password") {
      const value = await suiteCore(current.id, $("input").value);
      if (ticket === request) result(value.text ?? "");
      return;
    }
    if (current.id === "hex-viewer") {
      const file = $("file").files?.[0];
      if (!file) throw Error(t("chooseFileFirst"));
      if (overLimit(file.size, 1024 * 1024, limits))
        throw Error(t("hexViewerLimit"));
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (ticket !== request) return;
      let binary = "";
      for (let i = 0; i < bytes.length; i += 8192)
        binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
      worker.postMessage({
        request: ticket,
        id: "hex-viewer",
        input: btoa(binary),
        option: "",
      });
      return;
    }
    if (current.id === "file-sha256") {
      const file = $("file").files?.[0];
      if (!file) throw Error(t("chooseFileFirst"));
      if (overLimit(file.size, 32 * 1024 * 1024, limits))
        throw Error(t("file32Limit"));
      const value = await suiteCore(
        "file-sha256",
        "",
        new Uint8Array(await file.arrayBuffer()),
      );
      if (ticket === request) result(value.text ?? "");
      return;
    }
    worker.postMessage({
      request: ticket,
      id: current.id,
      input: $("input").value,
      option: $("option").value,
      bypassLimits: limits.bypassLimits,
    });
    timeout = armTimeout(
      () => {
        worker.terminate();
        ready = false;
        fail(t("processingTimeout"));
        startWorker();
      },
      10000,
      limits,
    );
  } catch (e) {
    if (ticket === request) fail(e instanceof Error ? e.message : String(e));
  }
}
$("tool-form").addEventListener("submit", (e) => {
  e.preventDefault();
  execute();
});
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
    e.preventDefault();
    execute();
  }
});
$("example").onclick = () => {
  if (!current) return;
  forgetClear();
  $("input").value = current.sample;
  $("option").value = current.option;
  (document.getElementById("unit-select") as HTMLSelectElement).value =
    current.option;
  invalidate();
};
$("clear").onclick = () => {
  clearedText = $("input").value || undefined;
  $("undo-clear").hidden = clearedText === undefined;
  $("input").value = "";
  invalidate();
  $("input").focus();
};
$("undo-clear").onclick = () => {
  if (clearedText === undefined) return;
  $("input").value = clearedText;
  forgetClear();
  invalidate();
  $("input").focus();
};
function invalidate() {
  updateInputSummary();
  request++;
  busy = false;
  clearTimeout(timeout);
  updateRunState();
  clearResult();
  referenceInputChanged();
}
$("input").oninput = () => {
  forgetClear();
  invalidate();
};
$("option").oninput = invalidate;
document.getElementById("bypass-limits")!.onchange = () => {
  updateFileLimitLabel();
  invalidate();
};
$("file").onchange = () => {
  invalidate();
  loadAnimationFiles();
};
$("file").addEventListener("animationchange", invalidate);
["animation-loops", "fallback-color", "fallback-file"].forEach((id) =>
  $(id).addEventListener("input", invalidate),
);
$("toggle-raw").onclick = () => {
  $("output").hidden = !$("output").hidden;
  $("toggle-raw").textContent = $("output").hidden
    ? t("showRaw")
    : t("hideRaw");
};
$("copy").onclick = async () => {
  try {
    await navigator.clipboard.writeText($("output").value);
    $("result-status").textContent = t("copiedClipboard");
    $("copy").textContent = t("copied");
    clearTimeout(copyFeedback);
    copyFeedback = setTimeout(() => {
      $("copy").textContent = t("copy");
    }, 2000);
  } catch {
    $("output").hidden = false;
    $("output").select();
    $("result-status").textContent = t("clipboardManual");
  }
};
$("download").onclick = () => {
  if (!current) return;
  if (!hasFormattedOutput() && suiteResult && downloadSuite(suiteResult))
    return;
  let ext =
    current.id === "qr-code"
      ? "svg"
      : ["markdown-preview", "html-preview"].includes(current.id)
        ? "html"
        : current.id.endsWith("to-csv")
          ? "csv"
          : current.id === "csv-to-tsv"
            ? "tsv"
            : current.id.startsWith("json-") || current.id.endsWith("to-json")
              ? "json"
              : "txt";
  if (current.id === "json-typescript") ext = "ts";
  if (current.id === "curl-fetch") ext = "js";
  if (current.id.endsWith("-yaml")) ext = "yaml";
  if (current.id.endsWith("-toml")) ext = "toml";
  if (current.id.endsWith("-jsonl")) ext = "jsonl";
  if (current.id === "csv-to-markdown") ext = "md";
  let blob = new Blob([$("output").value], {
    type:
      ext === "svg"
        ? "image/svg+xml"
        : ext === "html"
          ? "text/html"
          : "text/plain;charset=utf-8",
  });
  if (artifact && current.id !== "image-inspect") {
    blob = artifact.blob;
    ext =
      blob.type === "image/jpeg"
        ? "jpg"
        : blob.type === "image/webp"
          ? "webp"
          : "png";
  }
  const u = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = u;
  a.download = current.id + "." + ext;
  a.click();
  setTimeout(() => URL.revokeObjectURL(u), 1000);
};
const directory = configureDirectory(tools, (id) => {
  if (current?.id !== id) {
    history.pushState(null, "", toolPath(id));
    select(id);
  }
});
$("copy-tool-link").onclick = async () => {
  if (!current) return;
  try {
    await navigator.clipboard.writeText(
      new URL(toolPath(current.id), location.origin).href,
    );
    $("copy-tool-link").textContent = t("linkCopied");
    clearTimeout(linkFeedback);
    linkFeedback = setTimeout(() => {
      $("copy-tool-link").textContent = t("copyLink");
    }, 2000);
    $("result-status").textContent = t("toolLinkCopied");
  } catch {
    $("result-status").textContent = t("copyFromAddressBar");
  }
};
function readRoute(): void {
  // Bookmarks from the original hash router still resolve to canonical URLs.
  const legacyId = location.hash.slice(1);
  if (
    location.pathname === "/" &&
    (tools.some((tool) => tool.id === legacyId) ||
      Object.hasOwn(archiveAliases, legacyId))
  ) {
    select(legacyId);
    return;
  }
  const id = location.pathname.replace(/^\/|\/$/g, "");
  if (id !== (current?.id ?? "") || !id) select(id);
}
window.addEventListener("popstate", readRoute);
window.addEventListener("hashchange", readRoute);
document.querySelectorAll<HTMLAnchorElement>("[data-home]").forEach((link) => {
  link.addEventListener("click", (event) => {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey)
      return;
    event.preventDefault();
    if (location.pathname !== "/" || location.hash || location.search)
      history.pushState(null, "", "/");
    showHome();
    $("start-title").focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: "instant" });
  });
});
function applyLocaleChrome(): void {
  applyDocumentMessages();
  applyLocalizedCatalog(tools);
  $("language").textContent = languageButtonLabel();
  $("theme").textContent = themeButtonLabel(theme);
  updateFileLimitLabel();
  updateRunState();
  updateInputSummary();
  if (current) {
    const localized = localizedTool(current);
    $("tool-title").textContent = localized.name;
    $("description").textContent = localized.description;
    $("option-label").textContent = localized.optionLabel || t("options");
    $("input").placeholder = isReferenceBrowser(current.id)
      ? t("searchReferencePlaceholder")
      : "";
    document.querySelector<HTMLLabelElement>(
      'label[for="input"]',
    )!.textContent = isReferenceBrowser(current.id)
      ? t("searchReference")
      : t("input");
    $("copy-tool-link").textContent = t("copyLink");
    clearTimeout(linkFeedback);
    refreshSuiteLocale();
  }
  if (!$("output").hidden || !$("result-view").hidden)
    $("toggle-raw").textContent = $("output").hidden
      ? t("showRaw")
      : t("hideRaw");
  if (!$("copy").disabled && $("copy").textContent !== t("copied"))
    $("copy").textContent = t("copy");
  updatePageMetadata(current);
  directory.refresh();
  if (ready) $("engine-status").textContent = t("readyLocal");
  else $("engine-status").textContent = t("gettingReady");
  if ($("error").hidden && $("empty-result").hidden && $("output").value)
    $("result-status").textContent = t("doneBytes", {
      n: formatNumber(new TextEncoder().encode($("output").value).length),
    });
  else if (!$("error").hidden)
    $("result-status").textContent = t("checkMessage");
  else if (current) $("result-status").textContent = t("readyWhenYouAre");
  else $("result-status").textContent = t("resultMeta");
}

let theme = document.documentElement.dataset.theme || "auto";
function applyTheme() {
  if (theme === "auto") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  $("theme").textContent = themeButtonLabel(theme);
  try {
    localStorage.setItem("l5z12-theme", theme);
  } catch {}
}
$("theme").onclick = () => {
  theme = (
    { auto: "light", light: "dark", dark: "auto" } as Record<string, string>
  )[theme];
  applyTheme();
};
$("language").onclick = () => {
  cycleLanguagePreference();
  applyLocaleChrome();
};
ensureLocale();
applyTheme();
applyLocaleChrome();
readRoute();
startWorker();
if (document.modelContext?.registerTool) {
  try {
    Promise.resolve(
      document.modelContext.registerTool({
        name: "run_local_tool",
        description:
          "Select a toolbox utility, run it locally, and show the result. File hashing is available only through the file picker.",
        inputSchema: {
          type: "object",
          properties: {
            id: {
              type: "string",
              enum: tools
                .filter((t) => !fileTool(t.id) && !workbenchIds.has(t.id))
                .map((t) => t.id),
            },
            input: { type: "string" },
            option: { type: "string" },
          },
          required: ["id", "input"],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false, untrustedContentHint: true },
        async execute(args) {
          if (
            !args ||
            typeof args.input !== "string" ||
            !tools.some(
              (t) =>
                t.id === args.id && !fileTool(t.id) && !workbenchIds.has(t.id),
            ) ||
            (args.option !== undefined && typeof args.option !== "string")
          )
            throw Error("Invalid tool arguments");
          if (!ready || busy) throw Error("Core is loading or busy");
          select(args.id);
          if (!current) throw Error("Tool is unavailable");
          $("input").value = args.input;
          $("option").value = args.option ?? current.option;
          await execute();
          while (busy) await new Promise((r) => setTimeout(r, 20));
          if (!$("error").hidden) throw Error($("error").textContent);
          return { tool: current.id, result: $("output").value };
        },
      }),
    ).catch(() => {});
  } catch {}
}
