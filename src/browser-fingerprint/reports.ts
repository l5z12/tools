// SPDX-License-Identifier: AGPL-3.0-only
import type { SuiteResult, SuiteFile } from "../workbench-types";

export function textFile(
  name: string,
  text: string,
  mime = "application/json",
): SuiteFile {
  const bytes = new TextEncoder().encode(text);
  const chunks: string[] = [];
  for (let index = 0; index < bytes.length; index += 8192)
    chunks.push(String.fromCharCode(...bytes.subarray(index, index + 8192)));
  return { name, mime, base64: btoa(chunks.join("")) };
}

export interface FingerprintJsCollection {
  report: {
    visitorId: string;
    version: string;
    confidence: { score: number; comment?: string };
    components: Record<
      string,
      { value?: unknown; error?: unknown; duration: number }
    >;
  };
  input: string;
}

export function fingerprintJsReport({
  report,
  input,
}: FingerprintJsCollection): SuiteResult {
  const text = JSON.stringify(report, null, 2);
  return {
    kind: "table",
    text,
    headline: {
      label: "FingerprintJS 3.4.2 · MurmurHash3",
      value: report.visitorId,
    },
    fingerprintSections: Object.entries(report.components).map(
      ([name, component]) => ({
        name,
        status: component.error
          ? "blocked or failed"
          : component.value === undefined
            ? "unavailable"
            : "available",
        value: component.error ?? component.value ?? null,
      }),
    ),
    data: {
      version: report.version,
      confidenceScore: report.confidence.score,
      note: "Pinned v3 format. Signals can change or be masked; this ID is not proof of identity. Component durations are excluded from the hash.",
    },
    files: [
      textFile("fingerprintjs.json", text),
      textFile("fingerprintjs-id.txt", report.visitorId, "text/plain"),
      textFile("fingerprintjs-hash-input.txt", input, "text/plain"),
    ],
  };
}

export interface CreepCollection {
  fingerprint: Record<string, unknown>;
  creep: Record<string, unknown>;
  fpHash: string;
  creepHash: string;
  fuzzyFingerprint: string;
}

export function creepReport(report: CreepCollection): SuiteResult {
  const text = JSON.stringify(report, null, 2);
  return {
    kind: "table",
    text,
    headline: {
      label: "CreepJS local · stable SHA-256",
      value: report.creepHash,
    },
    fingerprintSections: Object.entries(report.fingerprint).map(
      ([name, value]) => ({
        name,
        status: value === undefined ? "unavailable" : "available",
        value: value ?? null,
      }),
    ),
    data: {
      stable: report.creepHash,
      loose: report.fpHash,
      fuzzy: report.fuzzyFingerprint,
      revision: "10aa6724cd33a1015db1574211890518cd04f0cc",
      note: "Local adaptation using a dedicated worker and inspection frame. Website network extras are excluded; results may differ from the public CreepJS website. Probe durations and temporary IDs can make the loose fingerprint change between runs.",
    },
    files: [
      textFile("creepjs-local.json", text),
      textFile("creepjs-stable-input.json", JSON.stringify(report.creep)),
      textFile("creepjs-loose-input.json", JSON.stringify(report.fingerprint)),
      textFile(
        "creepjs-ids.txt",
        `stable: ${report.creepHash}\nloose: ${report.fpHash}\nfuzzy: ${report.fuzzyFingerprint}\n`,
        "text/plain",
      ),
    ],
  };
}
