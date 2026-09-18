// SPDX-License-Identifier: AGPL-3.0-only
import type { SuiteOptions } from "../workbench-types";
import { bypassLimits, overLimit } from "../limits";

export const MEDIA_LIMIT = 64 * 1024 * 1024;
export type MediaStream = {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  duration?: string;
  sample_rate?: string;
  channels?: number;
  side_data_list?: { rotation?: number }[];
};
export type MediaInfo = {
  format?: { duration?: string; [key: string]: unknown };
  streams?: MediaStream[];
};
export type MediaPlan = { args: string[]; output: string; mime: string };

export function numeric(
  options: SuiteOptions,
  key: string,
  min: number,
  max: number,
): number {
  const raw = options[key];
  const value =
    typeof raw === "number"
      ? raw
      : typeof raw === "string" && raw.trim()
        ? Number(raw)
        : NaN;
  if (!Number.isFinite(value) || value < min || overLimit(value, max, options))
    throw Error(`${key} must be between ${min} and ${max}.`);
  return value;
}
function integer(
  options: SuiteOptions,
  key: string,
  min: number,
  max: number,
): number {
  const value = numeric(options, key, min, max);
  if (!Number.isInteger(value)) throw Error(`${key} must be a whole number.`);
  return value;
}
function choice(
  options: SuiteOptions,
  key: string,
  choices: readonly string[],
  fallback: string,
): string {
  const value = String(options[key] ?? fallback);
  if (!choices.includes(value)) throw Error(`Choose a supported ${key}.`);
  return value;
}
export function duration(info: MediaInfo): number {
  const value = Number(
    info.format?.duration ??
      info.streams?.find((s) => Number(s.duration) > 0)?.duration,
  );
  if (!Number.isFinite(value) || value <= 0)
    throw Error("The file has no readable duration.");
  return value;
}
export const inputArgs = (path: string): string[] => [
  "-protocol_whitelist",
  "file,pipe",
  "-probesize",
  "5000000",
  "-analyzeduration",
  "10000000",
  "-i",
  path,
];

function audioEncoding(format: string): { args: string[]; mime: string } {
  switch (format) {
    case "mp3":
      return {
        args: ["-c:a", "libmp3lame", "-b:a", "192k"],
        mime: "audio/mpeg",
      };
    case "wav":
      return { args: ["-c:a", "pcm_s16le"], mime: "audio/wav" };
    case "flac":
      return { args: ["-c:a", "flac"], mime: "audio/flac" };
    case "m4a":
      return { args: ["-c:a", "aac", "-b:a", "192k"], mime: "audio/mp4" };
    case "ogg":
      return { args: ["-c:a", "libvorbis", "-q:a", "5"], mime: "audio/ogg" };
    default:
      throw Error("Choose a supported audio format.");
  }
}
function tempo(speed: number): string {
  if (speed < 0.5) return `atempo=0.5,atempo=${speed / 0.5}`;
  if (speed > 2) return `atempo=2,atempo=${speed / 2}`;
  return `atempo=${speed}`;
}

export function planMedia(
  id: string,
  options: SuiteOptions,
  paths: string[],
  infos: MediaInfo[],
): MediaPlan {
  if (!paths.length || paths.length !== infos.length)
    throw Error("Choose a media file first.");
  if (id !== "audio-join" && paths.length !== 1)
    throw Error("Choose exactly one file.");
  if (overLimit(paths.length, 8, options))
    throw Error("Choose at most eight audio files.");
  const lengths = infos.map(duration);
  const seconds = lengths[0];
  if (
    overLimit(
      Math.max(
        ...lengths,
        id === "audio-join" ? lengths.reduce((a, b) => a + b, 0) : 0,
      ),
      600,
      options,
    )
  )
    throw Error("Media is limited to 10 minutes per job.");
  const video = infos[0].streams?.find((s) => s.codec_type === "video");
  const hasAudio = infos[0].streams?.some((s) => s.codec_type === "audio");
  const audioTool = id.startsWith("audio-") || id === "video-extract-audio";
  if (
    audioTool &&
    infos.some((info) => !info.streams?.some((s) => s.codec_type === "audio"))
  )
    throw Error("Every input must contain an audio track.");
  if (!audioTool && !video)
    throw Error("Choose a file containing a video stream.");
  let width = video?.width ?? 0,
    height = video?.height ?? 0;
  if (
    Math.abs(
      video?.side_data_list?.find((s) => s.rotation !== undefined)?.rotation ??
        0,
    ) %
      180 ===
    90
  )
    [width, height] = [height, width];
  if (
    !audioTool &&
    id !== "video-mute" &&
    video &&
    (overLimit(width * height, 1920 * 1080, options) ||
      overLimit(Math.max(width, height), 1920, options))
  )
    throw Error(
      "Video is limited to 1920×1080 pixels or the portrait equivalent.",
    );
  const args = [
    "-hide_banner",
    "-max_alloc",
    "134217728",
    "-filter_threads",
    "1",
    "-filter_complex_threads",
    "1",
    ...paths.flatMap(inputArgs),
  ];
  const addTrim = (maximum = 600) => {
    const start = numeric(options, "start", 0, seconds);
    const length = numeric(options, "duration", 0.01, maximum);
    if (start >= seconds || start + length > seconds + 0.05)
      throw Error("The selected segment extends beyond the file.");
    args.push("-ss", String(start), "-t", String(length));
  };
  let format = "mp4",
    mime = "video/mp4";
  const videoFilters: string[] = [];
  let audioFilter = "",
    graph = "",
    image = false,
    copyVideo = false;

  switch (id) {
    case "video-convert":
      format = choice(options, "format", ["mp4", "webm", "mkv"], "mp4");
      break;
    case "video-trim":
      addTrim();
      break;
    case "video-resize": {
      const w = integer(options, "width", 2, 1920),
        h = integer(options, "height", 2, 1920);
      if (overLimit(w * h, 1920 * 1080, options))
        throw Error("Output dimensions exceed 1080p.");
      videoFilters.push(
        `scale=${w}:${h}:force_original_aspect_ratio=decrease:force_divisible_by=2`,
      );
      break;
    }
    case "video-crop": {
      const w = integer(options, "width", 2, width),
        h = integer(options, "height", 2, height);
      const x = integer(options, "x", 0, width - w),
        y = integer(options, "y", 0, height - h);
      if (w % 2 || h % 2 || x % 2 || y % 2)
        throw Error("Crop dimensions and offsets must be even numbers.");
      videoFilters.push(`crop=${w}:${h}:${x}:${y}`);
      break;
    }
    case "video-rotate": {
      const direction = choice(
        options,
        "direction",
        ["clockwise", "counterclockwise", "180", "horizontal", "vertical"],
        "clockwise",
      );
      videoFilters.push(
        {
          clockwise: "transpose=1",
          counterclockwise: "transpose=2",
          "180": "hflip,vflip",
          horizontal: "hflip",
          vertical: "vflip",
        }[direction]!,
      );
      break;
    }
    case "video-speed":
    case "audio-speed": {
      const speed = numeric(options, "speed", 0.25, 4);
      if (seconds / speed > 600) throw Error("Result would exceed 10 minutes.");
      videoFilters.push(`setpts=(PTS-STARTPTS)/${speed}`);
      audioFilter = tempo(speed);
      break;
    }
    case "video-mute":
      format = choice(options, "format", ["mp4", "webm", "mkv"], "mp4");
      copyVideo = true;
      break;
    case "video-gif": {
      addTrim(30);
      const w = integer(options, "width", 16, 800),
        fps = integer(options, "fps", 1, 24);
      // Trim inside the graph so palette generation sees only the chosen clip.
      args.splice(args.length - 4, 4);
      graph = `[0:v:0]trim=start=${options.start}:duration=${options.duration},setpts=PTS-STARTPTS,fps=${fps},scale=${w}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer[out]`;
      format = "gif";
      mime = "image/gif";
      image = true;
      break;
    }
    case "video-frame": {
      const start = numeric(options, "start", 0, seconds);
      if (start >= seconds)
        throw Error("Timestamp must be before the end of the video.");
      args.push("-ss", String(start));
      format = "png";
      mime = "image/png";
      image = true;
      break;
    }
    case "video-contact-sheet": {
      const columns = integer(options, "columns", 1, 6),
        rows = integer(options, "rows", 1, 6);
      videoFilters.push(
        `fps=${(columns * rows) / seconds},scale=320:-1,tile=${columns}x${rows}:padding=4:margin=4`,
      );
      format = "png";
      mime = "image/png";
      image = true;
      break;
    }
    case "audio-trim":
      addTrim();
      break;
    case "audio-volume":
      audioFilter = `volume=${numeric(options, "gain", -30, 20)}dB`;
      break;
    case "audio-normalize":
      audioFilter = `loudnorm=I=${numeric(options, "loudness", -24, -9)}:TP=-1.5:LRA=11`;
      break;
    case "audio-fade": {
      const fadeIn = numeric(options, "fadeIn", 0, seconds),
        fadeOut = numeric(options, "fadeOut", 0, seconds);
      if (fadeIn + fadeOut > seconds)
        throw Error("The fades must fit inside the audio duration.");
      audioFilter = `afade=t=in:st=0:d=${fadeIn},afade=t=out:st=${seconds - fadeOut}:d=${fadeOut}`;
      break;
    }
    case "audio-reverse":
      if (seconds > 60) throw Error("Reverse accepts clips up to 60 seconds.");
      audioFilter = "areverse";
      break;
    case "audio-channels":
      break;
    case "audio-join": {
      if (paths.length < 2)
        throw Error("Choose at least two audio files to join.");
      graph =
        paths
          .map(
            (_, i) =>
              `[${i}:a:0]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,asetpts=PTS-STARTPTS[a${i}]`,
          )
          .join(";") +
        ";" +
        paths.map((_, i) => `[a${i}]`).join("") +
        `concat=n=${paths.length}:v=0:a=1[out]`;
      break;
    }
    case "audio-waveform":
      graph = "[0:a:0]showwavespic=s=1600x400:colors=8b8dff[out]";
      format = "png";
      mime = "image/png";
      image = true;
      break;
    case "audio-spectrogram":
      graph =
        "[0:a:0]showspectrumpic=s=1024x256:legend=disabled:scale=log[out]";
      format = "png";
      mime = "image/png";
      image = true;
      break;
    case "audio-convert":
    case "video-extract-audio":
      break;
    default:
      throw Error("Unknown media tool.");
  }

  if (graph) args.push("-filter_complex", graph, "-map", "[out]");
  if (image) {
    if (!graph) args.push("-map", "0:v:0");
    args.push("-an");
    if (format === "png") args.push("-frames:v", "1");
    if (videoFilters.length) args.push("-vf", videoFilters.join(","));
    if (format === "gif") args.push("-loop", "0");
  } else if (audioTool) {
    format = choice(
      options,
      "format",
      ["mp3", "wav", "flac", "m4a", "ogg"],
      "mp3",
    );
    const encoding = audioEncoding(format);
    mime = encoding.mime;
    if (!graph) args.push("-map", "0:a:0");
    args.push("-vn", ...encoding.args);
    const sampleRate =
      id === "audio-channels"
        ? choice(
            options,
            "sampleRate",
            ["48000", "44100", "32000", "22050", "16000", "8000"],
            "48000",
          )
        : "48000";
    const channels =
      id === "audio-channels"
        ? choice(options, "channels", ["mono", "stereo"], "stereo")
        : "stereo";
    args.push("-ar", sampleRate, "-ac", channels === "mono" ? "1" : "2");
    if (audioFilter) args.push("-af", audioFilter);
  } else {
    mime =
      format === "webm"
        ? "video/webm"
        : format === "mkv"
          ? "video/x-matroska"
          : "video/mp4";
    args.push("-map", "0:v:0");
    if (copyVideo) args.push("-c:v", "copy", "-an");
    else {
      args.push("-map", "0:a:0?");
      const quality = choice(
        options,
        "quality",
        ["balanced", "smaller", "higher"],
        "balanced",
      );
      const crf =
        quality === "smaller" ? "30" : quality === "higher" ? "20" : "24";
      args.push(
        ...(format === "webm"
          ? [
              "-c:v",
              "libvpx",
              "-b:v",
              "1M",
              "-crf",
              crf,
              "-deadline",
              "realtime",
              "-cpu-used",
              "8",
              "-c:a",
              "libvorbis",
            ]
          : [
              "-c:v",
              "libx264",
              "-preset",
              "ultrafast",
              "-crf",
              crf,
              "-c:a",
              "aac",
            ]),
      );
      videoFilters.push("scale=trunc(iw/2)*2:trunc(ih/2)*2", "setsar=1");
      args.push(
        "-vf",
        videoFilters.join(","),
        "-pix_fmt",
        "yuv420p",
        "-fpsmax",
        "60",
        "-ac",
        "2",
        "-ar",
        "48000",
      );
      if (audioFilter && hasAudio) args.push("-af", audioFilter);
    }
    if (format === "mp4") args.push("-movflags", "+faststart");
  }
  const output = `output.${format}`;
  args.push(
    "-map_metadata",
    "-1",
    "-map_chapters",
    "-1",
    "-threads",
    "1",
    ...(bypassLimits(options) ? [] : ["-fs", String(MEDIA_LIMIT)]),
    output,
  );
  return { args, output, mime };
}
