// SPDX-License-Identifier: AGPL-3.0-only
import { initializeFingerprintWasm } from "../../src/browser-fingerprint/wasm";
export async function collect() {
  await initializeFingerprintWasm();
  const { collectCreep } = await import("./src/creep");
  return collectCreep();
}
