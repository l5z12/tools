// SPDX-License-Identifier: AGPL-3.0-only
import type { Field, Workbench } from "./tool-types";

const number = (key: string, label: string, value: string): Field => ({
  key,
  label,
  value,
  type: "number",
});
const select = (key: string, label: string, choices: string[]): Field => ({
  key,
  label,
  choices,
  value: choices[0],
});
const audioFormat = select("format", "Output format", [
  "mp3",
  "wav",
  "flac",
  "m4a",
  "ogg",
]);
const videoFormat = select("format", "Output format", ["mp4", "webm", "mkv"]);
const trim = [
  number("start", "Start (seconds)", "0"),
  number("duration", "Length (seconds)", "10"),
];
const speed = number("speed", "Playback speed (0.25–4×)", "1.5");

function tool(
  id: string,
  name: string,
  description: string,
  fields: Field[] = [],
  extra: Partial<Workbench> = {},
): Workbench {
  const audio = id.startsWith("audio-");
  return {
    id,
    name,
    description,
    fields,
    group: "Media",
    tags: [
      audio ? "audio" : "video",
      "files",
      ...(id.includes("convert") ? ["converters"] : []),
    ],
    keywords: ["ffmpeg", "media", "sound", "movie"],
    sample: "",
    option: "",
    optionLabel: "",
    inputMode: "file",
    help: "Processes files locally with FFmpeg. Up to 64 MiB input/output, 10 minutes of media and 2 minutes per job. Video inputs are limited to 1920×1080 pixels (or portrait equivalent). FFmpeg loads on first use. Cancel stops processing and releases its memory.",
    ...extra,
  };
}

export const mediaTools: Workbench[] = [
  tool(
    "media-inspect",
    "Media inspector",
    "Inspect codecs, streams, dimensions, duration, bitrate and metadata.",
    [],
    { tags: ["audio", "video", "files", "analysis"] },
  ),
  tool(
    "video-convert",
    "Video converter & compressor",
    "Convert to MP4, WebM or MKV and choose output quality.",
    [
      videoFormat,
      select("quality", "Quality / size", ["balanced", "smaller", "higher"]),
    ],
  ),
  tool(
    "video-trim",
    "Video trimmer",
    "Cut an exact segment and save it as an MP4 video.",
    trim,
  ),
  tool(
    "video-resize",
    "Video resizer",
    "Fit a video inside a chosen size while preserving its proportions.",
    [
      number("width", "Maximum width", "1280"),
      number("height", "Maximum height", "720"),
    ],
  ),
  tool("video-crop", "Video cropper", "Crop a rectangular area from a video.", [
    number("width", "Crop width", "640"),
    number("height", "Crop height", "360"),
    number("x", "Left edge (pixels)", "0"),
    number("y", "Top edge (pixels)", "0"),
  ]),
  tool(
    "video-rotate",
    "Video rotate & flip",
    "Rotate a video or mirror it horizontally or vertically.",
    [
      select("direction", "Transform", [
        "clockwise",
        "counterclockwise",
        "180",
        "horizontal",
        "vertical",
      ]),
    ],
  ),
  tool(
    "video-speed",
    "Video speed changer",
    "Speed up or slow down video while preserving audio pitch.",
    [speed],
  ),
  tool(
    "video-mute",
    "Remove video audio",
    "Remove every audio track without re-encoding the video.",
    [videoFormat],
  ),
  tool(
    "video-extract-audio",
    "Extract audio from video",
    "Save a video's first audio track as a separate audio file.",
    [audioFormat],
    { tags: ["audio", "video", "files", "converters"] },
  ),
  tool(
    "video-gif",
    "Video to GIF",
    "Turn a short clip into an optimized animated GIF.",
    [
      ...trim,
      number("width", "GIF width (up to 800)", "480"),
      number("fps", "Frames per second (1–24)", "12"),
    ],
    { tags: ["video", "images", "animation", "converters"] },
  ),
  tool(
    "video-frame",
    "Video frame capture",
    "Save a frame at a chosen timestamp as PNG.",
    [number("start", "Timestamp (seconds)", "0")],
    { tags: ["video", "images", "files"] },
  ),
  tool(
    "video-contact-sheet",
    "Video contact sheet",
    "Create a grid of evenly spaced video thumbnails.",
    [
      number("columns", "Columns (1–6)", "4"),
      number("rows", "Rows (1–6)", "3"),
    ],
    { tags: ["video", "images", "files"] },
  ),
  tool(
    "audio-convert",
    "Audio converter",
    "Convert audio between MP3, WAV, FLAC, M4A and Ogg Vorbis.",
    [audioFormat],
  ),
  tool("audio-trim", "Audio trimmer", "Cut an exact audio segment.", [
    ...trim,
    audioFormat,
  ]),
  tool(
    "audio-join",
    "Join audio files",
    "Join up to eight audio files in the displayed order, with matching sample rate and channels.",
    [audioFormat],
    { multiple: true },
  ),
  tool(
    "audio-volume",
    "Audio volume",
    "Adjust volume with a gain measured in decibels.",
    [number("gain", "Gain in dB (−30 to +20)", "3"), audioFormat],
  ),
  tool(
    "audio-normalize",
    "Audio loudness normalizer",
    "Normalize perceived loudness with a true-peak ceiling.",
    [
      number("loudness", "Target loudness (−24 to −9 LUFS)", "-16"),
      audioFormat,
    ],
  ),
  tool(
    "audio-speed",
    "Audio speed changer",
    "Change playback speed while preserving pitch.",
    [speed, audioFormat],
  ),
  tool(
    "audio-fade",
    "Audio fade in & out",
    "Apply smooth fades to the beginning and end of an audio file.",
    [
      number("fadeIn", "Fade in (seconds)", "1"),
      number("fadeOut", "Fade out (seconds)", "2"),
      audioFormat,
    ],
  ),
  tool(
    "audio-reverse",
    "Reverse audio",
    "Play an audio clip backwards (up to 60 seconds).",
    [audioFormat],
  ),
  tool(
    "audio-channels",
    "Audio channels & sample rate",
    "Convert between mono and stereo and choose a sample rate.",
    [
      select("channels", "Channels", ["stereo", "mono"]),
      select("sampleRate", "Sample rate (Hz)", [
        "48000",
        "44100",
        "32000",
        "22050",
        "16000",
        "8000",
      ]),
      audioFormat,
    ],
  ),
  tool(
    "audio-waveform",
    "Audio waveform image",
    "Draw the amplitude of an audio file as a PNG waveform.",
    [],
    { tags: ["audio", "images", "analysis"] },
  ),
  tool(
    "audio-spectrogram",
    "Audio spectrogram",
    "Visualize an audio file's frequency content over time as a PNG image.",
    [],
    { tags: ["audio", "images", "analysis"] },
  ),
];
export const mediaIds = new Set(mediaTools.map((tool) => tool.id));
