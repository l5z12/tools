// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { murmurX64Hash128, hashComponents } from "@fingerprintjs/fingerprintjs";
import init, { fingerprint_hash } from "../public/wasm/l5z12_tools";
import { fingerprintjsInput } from "../src/browser-fingerprint/fingerprintjs-format";
import { collectClientHints } from "../src/browser-fingerprint/client-hints";

await init({
  module_or_path: await readFile("public/wasm/l5z12_tools_bg.wasm"),
});
for (let length = 0; length <= 80; length++) {
  for (const alphabet of ["abcZ09", "é漢字", "😀🌍", "\0\u00ff\u0100\uffff"]) {
    const input = alphabet.repeat(90).slice(0, length);
    // WASM string boundaries replace unpaired surrogates; real inputs use JSON.stringify.
    const normalized = input.toWellFormed();
    assert.equal(
      fingerprint_hash("fingerprintjs-3.4.2", normalized),
      murmurX64Hash128(normalized),
      `Murmur ${length} ${JSON.stringify(normalized)}`,
    );
    let mini = 0x811c9dc5;
    for (let index = 0; index < normalized.length; index++)
      mini = (Math.imul(31, mini) + normalized.charCodeAt(index)) | 0;
    assert.equal(
      fingerprint_hash("creep-mini", normalized),
      (mini >>> 0).toString(16).padStart(8, "0"),
    );
    assert.equal(
      fingerprint_hash("sha256", normalized),
      createHash("sha256").update(normalized).digest("hex"),
    );
  }
}
const components = {
  "a:|\\": { value: ["😀", undefined, null, 1.5], duration: 19 },
  z: { error: new Error("Blocked"), duration: 0 },
  undefined: { value: undefined, duration: 4 },
};
assert.equal(
  fingerprint_hash("fingerprintjs-3.4.2", fingerprintjsInput(components)),
  hashComponents(components),
);
const environment = (userAgentData?: unknown) =>
  ({ navigator: { userAgentData } }) as unknown as Window;
assert.equal(
  (await collectClientHints(environment(), true)).status,
  "unavailable",
);
let requested = false;
const agent = {
  brands: [{ brand: "Test", version: "1" }],
  mobile: false,
  platform: "TestOS",
  getHighEntropyValues: async (keys: string[]) => {
    requested = true;
    assert.ok(keys.includes("architecture"));
    return { architecture: "arm", wow64: false };
  },
};
assert.equal(
  (await collectClientHints(environment(agent), false)).highEntropy,
  "excluded",
);
assert.equal(requested, false);
assert.equal(
  (await collectClientHints(environment(agent), true)).hints.architecture,
  "arm",
);
agent.getHighEntropyValues = async () => {
  throw Error("Denied");
};
const blocked = await collectClientHints(environment(agent), true);
assert.equal(blocked.highEntropy, "blocked or failed");
assert.equal(blocked.hints.mobile, false);
console.log(
  "Fingerprint profiles passed: 324 upstream Murmur comparisons, Rust mini/SHA-256 parity, serialization, and Client Hints availability and opt-in.",
);
