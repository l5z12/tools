// SPDX-License-Identifier: AGPL-3.0-only
import algorithms from "./hash-algorithms.json";
import type { Workbench } from "./tool-types";

export const popularHashes = [
  "MD5",
  "SHA-1",
  "SHA-256",
  "SHA-512",
  "SHA3-256",
  "BLAKE3",
  "CRC-32/ISO-HDLC",
  "xxHash64",
] as const;

export const hashTools: Workbench[] = [
  {
    id: "hash-workbench",
    name: "Hash & checksum workbench",
    group: "Security",
    description: `Choose from ${algorithms.length} hash/checksum variants and compare a custom selection, the Popular preset, or all variants.`,
    tags: ["hashes", "checksums", "security", "files", "developer"],
    keywords: [
      ...algorithms.map((algorithm) => algorithm.name),
      "SHA2",
      "SHA-2",
      "SHA-3",
      "CRC32",
      "MurmurHash",
    ],
    sample: "abc",
    option: "",
    optionLabel: "",
    inputMode: "optional-file",
    fields: [
      {
        key: "inputFormat",
        label: "Text input format (ignored for files)",
        choices: ["UTF-8", "Hex", "Base64"],
        value: "UTF-8",
      },
      {
        key: "length",
        label: "SHAKE / BLAKE3 XOF output bytes (1–4096)",
        value: "32",
        type: "number",
      },
      {
        key: "seed",
        label: "xxHash / MurmurHash seed (unsigned decimal)",
        value: "0",
      },
      {
        key: "expected",
        label: "Optional expected digest (hex)",
        value: "",
        type: "textarea",
      },
    ],
    help: "Files use exact bytes; text defaults to UTF-8 without an added newline. Multiple hashes: up to 1 MiB. Single hashes: up to 32 MiB (MD2: 4 MiB). Checksums and legacy hashes are labeled separately from modern hashes. xxHash32 and Murmur3 use 32-bit seeds; xxHash64/XXH3 use 64-bit seeds. Numeric checksums use big-endian display bytes. Choose one algorithm for the output-format controls. Fixed BLAKE2 variants use their specified digest length, not truncation. No password hashing or keyed modes are implied.",
  },
];

export const hashIds = new Set(hashTools.map((tool) => tool.id));
export { algorithms as hashAlgorithms };
