// SPDX-License-Identifier: AGPL-3.0-only
import { suiteCore } from "../workbench-core";
import type { SuiteOptions, SuiteResult } from "../workbench-types";
import { browserSignals, canonicalJson, type Signal } from "./signals";
import { canvasSignal, webglSignals, type HashBytes } from "./rendering";
import { collectInFrame } from "./collect-frame";
import { collectClientHints } from "./client-hints";
import {
  fingerprintJsReport,
  creepReport,
  textFile,
  type FingerprintJsCollection,
  type CreepCollection,
} from "./reports";

async function rustSha256(bytes: Uint8Array): Promise<string> {
  const result = await suiteCore("hash-workbench", "", bytes, {
    algorithm: "SHA-256",
    fileProvided: true,
  });
  return result.text!;
}

function base64Utf8(text: string): string {
  const bytes = new TextEncoder().encode(text);
  const chunks: string[] = [];
  for (let index = 0; index < bytes.length; index += 8192)
    chunks.push(String.fromCharCode(...bytes.subarray(index, index + 8192)));
  return btoa(chunks.join(""));
}

export async function browserFingerprint(
  options: SuiteOptions,
  environment: Window = window,
  hash: HashBytes = rustSha256,
): Promise<SuiteResult> {
  if (options.profile === "FingerprintJS 3.4.2")
    return fingerprintJsReport(
      (await collectInFrame("fingerprintjs")) as FingerprintJsCollection,
    );
  if (options.profile === "CreepJS (local)")
    return creepReport((await collectInFrame("creepjs")) as CreepCollection);
  if (options.profile === "User-Agent Client Hints") {
    const snapshot = await collectClientHints(
      environment,
      options.highEntropy === true,
    );
    const input = canonicalJson(snapshot);
    const fingerprint = await hash(new TextEncoder().encode(input));
    const report = {
      schema: "l5z12-client-hints-snapshot-v1",
      fingerprint,
      algorithm: "SHA-256",
      ...snapshot,
    };
    const text = JSON.stringify(report, null, 2);
    return {
      kind: "table",
      text,
      headline: {
        label: "Client Hints snapshot · local SHA-256",
        value: fingerprint,
      },
      rows: Object.entries(snapshot.hints).map(([signal, value]) => ({
        group: "Client Hints",
        signal,
        status: "available",
        value,
      })),
      data: {
        status: snapshot.status,
        highEntropy: snapshot.highEntropy,
        note: "The standard defines hints, not a fingerprint hash. Unsupported hints are omitted. An empty snapshot is shared by all browsers without this API.",
      },
      files: [
        textFile("client-hints.json", text),
        textFile("client-hints-input.json", input),
        textFile("client-hints-sha256.txt", fingerprint, "text/plain"),
      ],
    };
  }
  if (options.profile !== undefined && options.profile !== "L5Z12 v1")
    throw Error("Unknown browser fingerprint format.");
  const signals = browserSignals(environment);
  const excluded = (name: string): Signal => ({
    group: "Rendering",
    name,
    status: "excluded",
    value: null,
  });
  signals.push(
    options.canvas === false
      ? excluded("Canvas RGBA SHA-256")
      : await canvasSignal(environment.document, hash),
  );
  signals.push(
    ...(options.webgl === false
      ? [excluded("WebGL context")]
      : webglSignals(environment.document)),
  );
  const profile = {
    schema: "l5z12-browser-fingerprint-v1",
    signals: [...signals].sort((a, b) =>
      `${a.group}/${a.name}` < `${b.group}/${b.name}` ? -1 : 1,
    ),
  };
  const canonical = canonicalJson(profile);
  const fingerprint = await hash(new TextEncoder().encode(canonical));
  const report = {
    fingerprint,
    algorithm: "SHA-256",
    profile,
    note: "A fingerprint of reported browser signals, not proof of identity or uniqueness. Missing and masked values are not evidence of a specific privacy tool.",
  };
  const text = JSON.stringify(report, null, 2);
  return {
    kind: "table",
    text,
    headline: { label: "Browser fingerprint · SHA-256", value: fingerprint },
    rows: profile.signals.map((signal) => ({
      group: signal.group,
      signal: signal.name,
      status: signal.status,
      value: signal.value,
    })),
    data: {
      schema: profile.schema,
      availableSignals: signals.filter(
        (signal) => signal.status === "available",
      ).length,
      totalSignals: signals.length,
      note: report.note,
    },
    files: [
      {
        name: "browser-fingerprint.txt",
        mime: "text/plain",
        base64: btoa(fingerprint),
      },
      {
        name: "browser-fingerprint.json",
        mime: "application/json",
        base64: base64Utf8(text),
      },
      {
        name: "browser-fingerprint-input.json",
        mime: "application/json",
        base64: base64Utf8(canonical),
      },
    ],
  };
}
