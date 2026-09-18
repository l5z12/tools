// SPDX-License-Identifier: AGPL-3.0-only
import { decodeBase64, decodeHex } from "./byte-input";
import { hashAlgorithms } from "./lib/hash-tools";
import { suiteCore } from "./workbench-core";
import type { SuiteOptions, SuiteResult } from "./workbench-types";
import { armTimeout, overLimit } from "./limits";

export function hashWorkerCount(count: number, cores: number): number {
  const available = Number.isFinite(cores) ? Math.floor(cores) : 2;
  return Math.min(count, Math.max(2, Math.min(4, available)));
}

function inputBytes(
  input: string,
  bytes: Uint8Array,
  options: SuiteOptions,
): Uint8Array {
  if (options.fileProvided) return bytes;
  switch (options.inputFormat ?? "UTF-8") {
    case "UTF-8":
      return new TextEncoder().encode(input);
    case "Hex":
      return decodeHex(input);
    case "Base64":
      return decodeBase64(input);
    default:
      throw Error("Unknown input format.");
  }
}

function mergeReports(
  results: SuiteResult[],
  names: string[],
  byteLength: number,
): SuiteResult {
  const rows = results.flatMap(
    (result) => result.rows ?? [result.data as Record<string, unknown>],
  );
  const byName = new Map(rows.map((row) => [row.algorithm, row]));
  const ordered = names.map((name) => {
    const { inputBytes: _, ...row } = byName.get(name)!;
    return row;
  });
  const text = JSON.stringify(ordered, null, 2);
  // Algorithm names and hex values are ASCII, so btoa preserves the JSON bytes.
  return {
    kind: "table",
    rows: ordered,
    text,
    data: { inputBytes: byteLength, algorithms: names.length },
    files: [
      { name: "hashes.json", mime: "application/json", base64: btoa(text) },
    ],
  };
}

export async function hashSuite(
  input: string,
  bytes: Uint8Array,
  options: SuiteOptions,
): Promise<SuiteResult> {
  const requested = options.algorithms;
  if (
    !Array.isArray(requested) ||
    requested.length === 0 ||
    requested.length > hashAlgorithms.length
  )
    throw Error("Select between 1 and 50 hash or checksum variants.");
  if (
    requested.some(
      (name) =>
        typeof name !== "string" ||
        !hashAlgorithms.some((algorithm) => algorithm.name === name),
    )
  )
    throw Error("Unknown hash algorithm in selection.");
  const names = hashAlgorithms
    .filter((algorithm) => requested.includes(algorithm.name))
    .map((algorithm) => algorithm.name);
  if (names.length === 1)
    return suiteCore("hash-workbench", input, bytes, {
      ...options,
      algorithms: names,
    });
  const source = inputBytes(input, bytes, options);
  if (overLimit(source.length, 1024 * 1024, options))
    throw Error(
      "Multiple-hash calculation is limited to 1 MiB; choose a single algorithm for larger files.",
    );

  const count = hashWorkerCount(names.length, navigator.hardwareConcurrency);
  const batches = Array.from({ length: count }, (_, index) =>
    names.filter((_, position) => position % count === index),
  );
  return new Promise((resolve, reject) => {
    const workers: Worker[] = [];
    const results: SuiteResult[] = [];
    let finished = false;
    const cleanup = () => {
      finished = true;
      clearTimeout(timeout);
      workers.forEach((worker) => worker.terminate());
    };
    const fail = (error: Error) => {
      if (!finished) {
        cleanup();
        reject(error);
      }
    };
    const timeout = armTimeout(
      () =>
        fail(
          Error("Hash calculation exceeded 60 seconds. Try a smaller input."),
        ),
      60000,
      options,
    );
    try {
      for (const algorithms of batches) {
        const worker = new Worker(
          new URL("./workbench-worker.ts", import.meta.url),
          { type: "module" },
        );
        workers.push(worker);
        worker.onerror = () => fail(Error("Hash worker failed."));
        worker.onmessage = ({
          data,
        }: MessageEvent<{ result?: SuiteResult; error?: string }>) => {
          if (finished) return;
          if (data.error || !data.result) {
            fail(Error(data.error ?? "Hash worker returned no result."));
            return;
          }
          results.push(data.result);
          if (results.length === batches.length) {
            try {
              const result = mergeReports(results, names, source.length);
              cleanup();
              resolve(result);
            } catch (error) {
              fail(error instanceof Error ? error : Error(String(error)));
            }
          }
        };
        worker.postMessage({
          id: "hash-workbench",
          input: "",
          bytes: source,
          options: { ...options, algorithms, fileProvided: true },
        });
      }
    } catch (error) {
      fail(error instanceof Error ? error : Error(String(error)));
    }
  });
}
