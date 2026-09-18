// SPDX-License-Identifier: AGPL-3.0-only
import { fetchRuntimeAsset } from "../runtime-assets";
import init, { fingerprint_hash } from "../generated/l5z12_tools";
let ready: ReturnType<typeof init> | undefined;
export function initializeFingerprintWasm() {
  return (ready ??= init({
    module_or_path: fetchRuntimeAsset("/wasm/l5z12_tools_bg.wasm"),
  }));
}
export function creepHashMini(value: unknown): string {
  return fingerprint_hash("creep-mini", `${JSON.stringify(value)}`);
}
export async function creepHashify(
  value: unknown,
  algorithm = "SHA-256",
): Promise<string> {
  if (algorithm !== "SHA-256")
    throw Error("Unsupported CreepJS hash algorithm.");
  await initializeFingerprintWasm();
  return fingerprint_hash("sha256", `${JSON.stringify(value)}`);
}
export { fingerprint_hash };
