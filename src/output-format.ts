// SPDX-License-Identifier: AGPL-3.0-only
import { suiteCore } from "./workbench-core";
import { decodeHex, decodeBase64 } from "./byte-input";
import type { SuiteResult } from "./workbench-types";
import { t } from "./i18n";

export const outputModes = [
  "Original",
  "Hex",
  "Base64",
  "Base64url",
  "Binary",
  "Octal",
  "Decimal",
  "UTF-8",
  "C byte array",
  "JSON byte array",
] as const;
export type OutputMode = (typeof outputModes)[number];
export type OutputFormat = {
  mode: OutputMode;
  uppercase: boolean;
  separator: string;
  groupBytes: number;
  prefix: string;
  lineBytes: number;
  padding: boolean;
  wrap: number;
};

export const defaultFormat: OutputFormat = {
  mode: "Original",
  uppercase: false,
  separator: "",
  groupBytes: 1,
  prefix: "",
  lineBytes: 0,
  padding: true,
  wrap: 0,
};

const digestTools = new Set(["hex-encode", "sha256", "sha512", "file-sha256"]);
const base64Tools = new Set(["base64-encode", "base64url-encode"]);

export function supportsOutputFormat(id: string): boolean {
  return (
    id.startsWith("codec-") ||
    id.startsWith("cipher-") ||
    id.startsWith("crypto-") ||
    id === "hash-workbench" ||
    digestTools.has(id) ||
    base64Tools.has(id) ||
    [
      "hex-decode",
      "base64-decode",
      "base64url-decode",
      "hmac-calc",
      "sri-generator",
    ].includes(id)
  );
}

export type OutputSource = { bytes: Uint8Array; description: string };

/** Prefer exact binary artifacts over text previews, which can be truncated. */
export function outputSource(
  id: string,
  original: string,
  result: SuiteResult | null,
): OutputSource {
  const ciphertext = result?.files?.find(
    (file) => file.name === "ciphertext.bin",
  );
  if (ciphertext)
    return {
      bytes: decodeBase64(ciphertext.base64),
      description: t("ciphertextBytes"),
    };
  const binary = result?.files?.find((file) => file.name === "result.bin");
  if (binary)
    return {
      bytes: decodeBase64(binary.base64),
      description: t("exactBytes"),
    };
  if (result?.formatBytes !== undefined)
    return {
      bytes: decodeBase64(result.formatBytes),
      description:
        id === "hash-workbench" ? t("digestBytes") : t("encodedBytes"),
    };
  if (digestTools.has(id))
    return { bytes: decodeHex(original), description: t("resultBytes") };
  if (base64Tools.has(id))
    return {
      bytes: decodeBase64(original),
      description: t("encodedBytes"),
    };
  if (id === "hmac-calc" || id === "sri-generator") {
    const data = result?.data as
      { hex?: string; integrity?: string } | undefined;
    if (data?.hex)
      return { bytes: decodeHex(data.hex), description: t("digestBytes") };
    if (data?.integrity)
      return {
        bytes: decodeBase64(
          data.integrity.slice(data.integrity.indexOf("-") + 1),
        ),
        description: t("digestBytes"),
      };
  }
  return {
    bytes: new TextEncoder().encode(original),
    description: t("utf8Bytes"),
  };
}

/** Formatting changes representations only; it never reruns a cipher or changes its bytes. */
export async function formatOutput(
  bytes: Uint8Array,
  format: OutputFormat,
): Promise<string> {
  const result = await suiteCore("format-output", "", bytes, format);
  return result.text ?? "";
}
