// SPDX-License-Identifier: AGPL-3.0-only
import {
  initializeFingerprintWasm,
  fingerprint_hash,
} from "../../src/browser-fingerprint/wasm";
import { fingerprintjsInput } from "../../src/browser-fingerprint/fingerprintjs-format";

export async function collect() {
  await initializeFingerprintWasm();
  const FingerprintJS = await import("@fingerprintjs/fingerprintjs");
  const agent = await FingerprintJS.load({ monitoring: false });
  const result = await agent.get();
  const input = fingerprintjsInput(result.components);
  return {
    report: {
      visitorId: fingerprint_hash("fingerprintjs-3.4.2", input),
      version: result.version,
      confidence: result.confidence,
      components: JSON.parse(
        FingerprintJS.componentsToDebugString(result.components),
      ),
    },
    input,
  };
}
