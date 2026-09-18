// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { mediaTools } from "../src/lib/media-tools";
import { planMedia, type MediaInfo } from "../src/media/plan";
import type { SuiteOptions } from "../src/workbench-types";

type Core = {
  exec(...args: string[]): void;
  ffprobe(...args: string[]): void;
  ret: number;
  reset(): void;
  setLogger(callback: (entry: { message: string }) => void): void;
  FS: {
    writeFile(path: string, bytes: Uint8Array): void;
    readFile(path: string): Uint8Array;
    unlink(path: string): void;
  };
};
// The shipped core targets a browser worker. Supply its URL environment while
// loading the exact WASM bytes locally; no network or replacement codec is used.
Object.assign(globalThis, {
  self: globalThis,
  location: { href: "http://localhost/ffmpeg-core.js" },
});
const require = createRequire(import.meta.url);
const createCore = require("@ffmpeg/core") as (options: {
  wasmBinary: Uint8Array;
  mainScriptUrlOrBlob: string;
}) => Promise<Core>;
const coreOptions = {
  wasmBinary: await readFile("public/ffmpeg/ffmpeg-core.wasm"),
  mainScriptUrlOrBlob:
    "http://localhost/ffmpeg-core.js#" +
    btoa(JSON.stringify({ wasmURL: "http://localhost/ffmpeg-core.wasm" })),
};
let core = await createCore({ ...coreOptions });
let logs: string[] = [];
core.setLogger(({ message }) => {
  logs.push(message);
  if (logs.length > 30) logs.shift();
});
await mkdir("work/media-tests", { recursive: true });
execFileSync(
  "ffmpeg",
  [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=320x240:rate=12:duration=2",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=48000:duration=2",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-shortest",
    "work/media-tests/source.mp4",
  ],
  { stdio: "pipe" },
);
const source = await readFile("work/media-tests/source.mp4");
core.FS.writeFile("input-0.mp4", source);
core.FS.writeFile("input-1.mp4", source);
core.ffprobe(
  "-v",
  "error",
  "-show_format",
  "-show_streams",
  "-of",
  "json",
  "-o",
  "probe.json",
  "input-0.mp4",
);
assert.ok(core.ret === 0 || core.ret === -1, logs.join("\n"));
core.reset();
const info: MediaInfo = JSON.parse(
  new TextDecoder().decode(core.FS.readFile("probe.json")),
);
assert.equal(info.streams?.find((s) => s.codec_type === "video")?.width, 320);
const defaults = (id: string): SuiteOptions =>
  Object.fromEntries(
    mediaTools.find((t) => t.id === id)!.fields.map((f) => [f.key, f.value]),
  );

for (const tool of mediaTools.filter((t) => t.id !== "media-inspect")) {
  core = await createCore({ ...coreOptions });
  if (typeof Bun !== "undefined") Bun.gc(true);
  core.setLogger(({ message }) => {
    logs.push(message);
    if (logs.length > 30) logs.shift();
  });
  core.FS.writeFile("input-0.mp4", source);
  core.FS.writeFile("input-1.mp4", source);
  const options = {
    ...defaults(tool.id),
    duration: "1",
    start: "0.25",
    width: "160",
    height: "120",
    fadeIn: "0.2",
    fadeOut: "0.3",
    columns: "2",
    rows: "2",
  };
  const joining = tool.id === "audio-join";
  const plan = planMedia(
    tool.id,
    options,
    joining ? ["input-0.mp4", "input-1.mp4"] : ["input-0.mp4"],
    joining ? [info, info] : [info],
  );
  logs = [];
  core.exec(...plan.args);
  assert.equal(core.ret, 0, `${tool.id}\n${logs.join("\n")}`);
  core.reset();
  const bytes = core.FS.readFile(plan.output);
  assert.ok(bytes.length > 0, tool.id);
  const path = `work/media-tests/${tool.id}.${plan.output.split(".").at(-1)}`;
  await writeFile(path, bytes);
  const report = JSON.parse(
    execFileSync(
      "ffprobe",
      ["-v", "error", "-show_format", "-show_streams", "-of", "json", path],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ),
  ) as MediaInfo;
  const audio = report.streams?.find((s) => s.codec_type === "audio");
  const video = report.streams?.find((s) => s.codec_type === "video");
  if (tool.id === "video-mute") assert.equal(audio, undefined);
  if (tool.id === "video-resize" || tool.id === "video-crop") {
    assert.equal(video?.width, 160);
    assert.equal(video?.height, 120);
  }
  if (tool.id === "video-rotate") {
    assert.equal(video?.width, 240);
    assert.equal(video?.height, 320);
  }
  if (tool.id.endsWith("-trim"))
    assert.ok(Math.abs(Number(report.format?.duration) - 1) < 0.2);
  if (tool.id.endsWith("-speed"))
    assert.ok(Number(report.format?.duration) < 1.6);
  if (tool.id === "audio-join")
    assert.ok(Number(report.format?.duration) > 3.9);
  if (plan.mime.startsWith("image/")) assert.ok(video?.width && video.height);
  core.FS.unlink(plan.output);
  console.log(`Passed ${tool.id}`);
}
for (const format of ["webm", "mkv", "wav", "flac", "m4a", "ogg"]) {
  console.log(`Checking format ${format}`);
  core = await createCore({ ...coreOptions });
  if (typeof Bun !== "undefined") Bun.gc(true);
  core.setLogger(({ message }) => {
    logs.push(message);
    if (logs.length > 30) logs.shift();
  });
  core.FS.writeFile("input-0.mp4", source);
  const id = ["webm", "mkv"].includes(format)
    ? "video-convert"
    : "audio-convert";
  const plan = planMedia(
    id,
    { ...defaults(id), format },
    ["input-0.mp4"],
    [info],
  );
  try {
    core.exec(...plan.args);
  } catch (error) {
    console.log(logs.join("\n"));
    throw error;
  }
  assert.equal(core.ret, 0, `${format}: ${logs.join("\n")}`);
  core.reset();
  assert.ok(core.FS.readFile(plan.output).length);
  core.FS.unlink(plan.output);
}
assert.throws(() =>
  planMedia(
    "video-crop",
    { ...defaults("video-crop"), width: "80", height: "80", x: "999" },
    ["input-0.mp4"],
    [info],
  ),
);
assert.throws(() =>
  planMedia(
    "audio-volume",
    { gain: "1,anull", format: "mp3" },
    ["input-0.mp4"],
    [info],
  ),
);
assert.throws(() =>
  planMedia(
    "video-trim",
    { start: "1", duration: "5" },
    ["input-0.mp4"],
    [info],
  ),
);
assert.throws(() =>
  planMedia("audio-join", { format: "mp3" }, ["input-0.mp4"], [info]),
);
console.log(
  `${mediaTools.length} media tools checked against the shipped FFmpeg WASM core and native ffprobe.`,
);
