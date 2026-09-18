// SPDX-License-Identifier: AGPL-3.0-only
import type { Workbench } from "./tool-types";
export const archiveTools: Workbench[] = [
  {
    id: "archive-workbench",
    name: "Archives & compression",
    group: "Developer",
    description:
      "Create, browse, test, extract and repack archives, or compress and decompress individual files.",
    tags: ["files", "archives", "compression", "converters", "encryption"],
    keywords: [
      "zip",
      "7zip",
      "7z",
      "rar",
      "unrar",
      "winrar",
      "tar",
      "gzip",
      "brotli",
      "zstd",
      "password",
      "archive builder",
      "archive explorer",
    ],
    sample: "",
    option: "",
    optionLabel: "",
    inputMode: "file",
    multiple: true,
    fields: [
      {
        key: "mode",
        label: "Operation",
        choices: [
          "create",
          "inspect",
          "test",
          "extract",
          "repack",
          "compress",
          "decompress",
        ],
        value: "create",
      },
      {
        key: "format",
        label: "Output format",
        choices: ["zip", "7z", "rar", "tar", "tar.gz"],
        value: "zip",
      },
      {
        key: "password",
        label: "Input archive password",
        type: "password",
        value: "",
      },
      {
        key: "archiveName",
        label: "Output archive name (without extension)",
        value: "archive",
      },
      {
        key: "level",
        label: "Compression level",
        choices: ["balanced", "fast", "maximum", "store"],
        value: "balanced",
      },
      {
        key: "outputPassword",
        label: "Output password (ZIP / 7z / RAR; blank for no encryption)",
        type: "password",
        value: "",
      },
      {
        key: "solid",
        label: "Solid compression (7z / RAR)",
        type: "checkbox",
        value: "true",
      },
      {
        key: "encryptNames",
        label: "Encrypt filenames (7z / RAR)",
        type: "checkbox",
        value: "true",
      },
    ],
    help: "Create combines files or folders into ZIP, 7z, RAR, TAR or TAR.GZ. Inspect, Test, Extract and Repack read an existing archive. Compress and Decompress process a single gzip, Brotli or Zstd stream. All processing stays in your browser. Up to 32 MiB input, 500 archive entries and 64 MiB expanded output.",
  },
];

export const archiveAliases: Record<string, string> = {
  "archive-create": "create",
  "archive-explorer": "inspect",
  "compression-workbench": "compress",
};
