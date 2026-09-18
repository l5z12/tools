// SPDX-License-Identifier: AGPL-3.0-only
import type { SuiteOptions } from "./workbench-types";
import { modernSpecs } from "./lib/codec-tools";
export const randomHex = (length: number): string =>
  Array.from(crypto.getRandomValues(new Uint8Array(length)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
export function prepareCrypto(id: string, options: SuiteOptions): SuiteOptions {
  const spec = modernSpecs.find((s) => "crypto-" + s[0] === id);
  const copy = { ...options };
  if (spec && copy.mode !== "Decrypt" && !String(copy.iv ?? "").trim())
    copy.iv = randomHex(spec[3]);
  return copy;
}
