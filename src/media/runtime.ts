// SPDX-License-Identifier: AGPL-3.0-only
import { fetchRuntimeAsset } from "../runtime-assets";
import type { FFmpeg } from "@ffmpeg/ffmpeg";
import type { SuiteOptions, SuiteResult } from "../workbench-types";
import { MEDIA_LIMIT, planMedia, type MediaInfo } from "./plan";
import { armTimeout, overLimit } from "../limits";
import { t } from "../i18n";

type MediaControls = {
  status: HTMLElement;
  cancel: HTMLButtonElement;
  log: HTMLElement;
};
let activeCancel: (() => void) | undefined;
const joinOrders = new WeakMap<HTMLElement, File[]>();
export function cancelMedia(): void {
  activeCancel?.();
}

export function configureMedia(
  container: HTMLElement,
  multiple: boolean,
  changed: () => void,
): void {
  const status = document.createElement("p");
  status.dataset.mediaStatus = "";
  status.setAttribute("role", "status");
  status.textContent = t("mediaReady");
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = t("cancelProcessing");
  cancel.dataset.mediaCancel = "";
  cancel.disabled = true;
  cancel.onclick = cancelMedia;
  const details = document.createElement("details");
  const summary = document.createElement("summary");
  summary.textContent = t("processingLog");
  const log = document.createElement("pre");
  log.dataset.mediaLog = "";
  log.className = "media-log";
  details.append(summary, log);
  container.append(status, cancel, details);
  if (multiple) {
    const order = document.createElement("ol");
    order.setAttribute("aria-label", t("audioJoinOrder"));
    const renderOrder = () => {
      const files = joinOrders.get(container) ?? [];
      order.replaceChildren(
        ...files.map((file, index) => {
          const row = document.createElement("li");
          row.textContent = file.name;
          for (const direction of [-1, 1]) {
            const move = document.createElement("button");
            move.type = "button";
            move.textContent = direction < 0 ? "Move up" : "Move down";
            move.setAttribute(
              "aria-label",
              `${move.textContent}: ${file.name}`,
            );
            const target = index + direction;
            move.disabled = target < 0 || target >= files.length;
            move.onclick = () => {
              [files[index], files[target]] = [files[target], files[index]];
              renderOrder();
              changed();
            };
            row.append(move);
          }
          return row;
        }),
      );
    };
    container
      .querySelector<HTMLInputElement>("#suite-file")!
      .addEventListener("change", (event) => {
        joinOrders.set(
          container,
          Array.from((event.target as HTMLInputElement).files ?? []),
        );
        renderOrder();
      });
    container.append(order);
  }
}

async function probe(
  engine: FFmpeg,
  path: string,
  index: number,
  options: SuiteOptions,
): Promise<MediaInfo> {
  const report = `probe-${index}.json`;
  const code = await engine.ffprobe(
    [
      "-v",
      "error",
      "-max_alloc",
      "67108864",
      "-protocol_whitelist",
      "file,pipe",
      "-probesize",
      "5000000",
      "-analyzeduration",
      "10000000",
      "-show_format",
      "-show_streams",
      "-of",
      "json",
      "-o",
      report,
      path,
    ],
    20_000,
  );
  // core 0.12.10 leaves ret at -1 when ffprobe returns normally. Require a
  // complete JSON report with streams as well as a non-error status.
  if (code !== 0 && code !== -1)
    throw Error("FFmpeg could not read this media file.");
  const text = await engine.readFile(report, "utf8");
  if (typeof text !== "string" || overLimit(text.length, 1_000_000, options))
    throw Error("Media metadata exceeds the preview limit.");
  const info: MediaInfo = JSON.parse(text);
  if (!info.streams?.length || overLimit(info.streams.length, 32, options))
    throw Error("Choose media containing 1–32 readable streams.");
  return info;
}

export async function runMedia(
  id: string,
  files: File[],
  options: SuiteOptions,
  container: HTMLElement,
): Promise<SuiteResult> {
  files = [...(joinOrders.get(container) ?? files)];
  if (!files.length) throw Error("Choose a media file first.");
  if (files.length > (id === "audio-join" ? 8 : 1) && !options.bypassLimits)
    throw Error("Too many input files for this tool.");
  if (
    overLimit(
      files.reduce((sum, f) => sum + f.size, 0),
      MEDIA_LIMIT,
      options,
    )
  )
    throw Error("Combined input exceeds 64 MiB.");
  cancelMedia();
  const controls: MediaControls = {
    status: container.querySelector("[data-media-status]")!,
    cancel: container.querySelector("[data-media-cancel]")!,
    log: container.querySelector("[data-media-log]")!,
  };
  let engine: FFmpeg | undefined;
  let wasmUrl: string | undefined;
  const runtimeDownload = new AbortController();
  let rejectStop: (error: Error) => void = () => {};
  const stopped = new Promise<never>((_, reject) => {
    rejectStop = reject;
  });
  const stop = () => {
    runtimeDownload.abort();
    rejectStop(Error("Processing cancelled."));
  };
  activeCancel = stop;
  const deadline = armTimeout(
    () =>
      rejectStop(
        Error(
          "Processing exceeded two minutes. Try a shorter or smaller file.",
        ),
      ),
    120_000,
    options,
  );
  const wait = <T>(promise: Promise<T>): Promise<T> =>
    Promise.race([promise, stopped]);
  const logs: string[] = [];
  controls.cancel.disabled = false;
  controls.log.textContent = "";
  controls.status.textContent = "Loading local FFmpeg…";
  try {
    const local = (path: string) =>
      new URL(`/ffmpeg/${path}`, location.origin).href;
    const { FFmpeg } = (await wait(
      import(/* @vite-ignore */ local("classes.js")),
    )) as typeof import("@ffmpeg/ffmpeg");
    engine = new FFmpeg();
    engine.on("log", ({ message }) => {
      logs.push(message.slice(0, 1500));
      if (logs.length > 100) logs.shift();
      controls.log.textContent = logs.join("\n");
    });
    engine.on("progress", ({ time }) => {
      if (Number.isFinite(time) && time >= 0)
        controls.status.textContent = `Processing… ${Math.round(time / 1_000_000)} seconds of output`;
    });
    const wasmResponse = await wait(
      fetchRuntimeAsset(local("ffmpeg-core.wasm"), runtimeDownload.signal),
    );
    wasmUrl = URL.createObjectURL(await wait(wasmResponse.blob()));
    await wait(
      engine.load({
        classWorkerURL: local("worker.js"),
        coreURL: local("ffmpeg-core.js"),
        wasmURL: wasmUrl,
      }),
    );
    const paths: string[] = [],
      infos: MediaInfo[] = [];
    for (const [index, file] of files.entries()) {
      controls.status.textContent = `Reading ${index + 1} of ${files.length}…`;
      const extension =
        file.name.match(/\.([a-z0-9]{1,8})$/i)?.[1]?.toLowerCase() ?? "bin";
      const path = `input-${index}.${extension}`;
      paths.push(path);
      await wait(
        engine.writeFile(path, new Uint8Array(await wait(file.arrayBuffer()))),
      );
      infos.push(await wait(probe(engine, path, index, options)));
    }
    if (id === "media-inspect") {
      const data = { file: files[0].name, bytes: files[0].size, ...infos[0] };
      controls.status.textContent = "Inspection complete.";
      return { kind: "data", data, text: JSON.stringify(data, null, 2) };
    }
    const plan = planMedia(id, options, paths, infos);
    controls.status.textContent = "Processing…";
    const code = await wait(engine.exec(plan.args, 110_000));
    if (code !== 0)
      throw Error(
        "FFmpeg could not complete this operation. Check the processing log; try a different output format or a smaller file.",
      );
    const output = await wait(engine.readFile(plan.output));
    if (typeof output === "string" || !output.length)
      throw Error("FFmpeg produced no output.");
    // -fs can stop a muxer at its limit with exit status 0. Never offer that
    // incomplete file as a successful conversion.
    if (overLimit(output.length, MEDIA_LIMIT - 65536, options))
      throw Error(
        "Output reached the 64 MiB limit. Choose a shorter clip or a smaller output format.",
      );
    const data = {
      operation: id,
      inputFiles: files.length,
      inputBytes: files.reduce((sum, file) => sum + file.size, 0),
      outputBytes: output.length,
      output: plan.output,
    };
    const bytes = new Uint8Array(output.length);
    bytes.set(output);
    controls.status.textContent = "Done. Your result is ready below.";
    return {
      kind: "media",
      data,
      text: JSON.stringify(data, null, 2),
      mediaFiles: [{ name: plan.output, mime: plan.mime, bytes }],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    controls.status.textContent = message;
    throw Error(message);
  } finally {
    clearTimeout(deadline);
    runtimeDownload.abort();
    engine?.terminate();
    if (wasmUrl) URL.revokeObjectURL(wasmUrl);
    controls.cancel.disabled = true;
    if (activeCancel === stop) activeCancel = undefined;
  }
}
