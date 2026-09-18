// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Window } from "happy-dom";
import init, { suite_run } from "../public/wasm/l5z12_tools";
import { popularHashes, hashAlgorithms } from "../src/lib/hash-tools";
import { selectedHashes } from "../src/hash-controls";
import { hashSuite, hashWorkerCount } from "../src/hash-runtime";
import { configureSuite, executeSuite } from "../src/workbench-ui";
import type { SuiteOptions, SuiteResult } from "../src/workbench-types";

await init({
  module_or_path: await readFile("public/wasm/l5z12_tools_bg.wasm"),
});
function direct(options: SuiteOptions): SuiteResult {
  return JSON.parse(
    suite_run(
      "hash-workbench",
      "abc",
      new Uint8Array(),
      JSON.stringify(options),
    ),
  );
}
const selection = ["CRC-32C", "SHA-256", "BLAKE3"];
const subset = direct({ algorithms: selection });
assert.deepEqual(
  subset.rows!.map((row) => row.algorithm),
  ["SHA-256", "BLAKE3", "CRC-32C"],
);
for (const row of subset.rows!)
  assert.equal(row.hex, direct({ algorithm: row.algorithm }).text);
assert.equal(direct({ algorithms: ["SHA-256", "SHA-256"] }).kind, "code");
for (const algorithms of [
  [],
  ["SHA-256", "unknown"],
  [null],
  "SHA-256",
  null,
  Array(51).fill("SHA-256"),
])
  assert.throws(() => direct({ algorithms }));

// Real worker threads run WASM. Only their file-loading entry point differs from the browser.
const NativeWorker = globalThis.Worker;
const created: TestWorker[] = [];
class TestWorker {
  worker = new NativeWorker(
    new URL("./fixtures/hash-worker.ts", import.meta.url),
  );
  terminated = false;
  constructor() {
    created.push(this);
  }
  set onmessage(handler: Worker["onmessage"]) {
    this.worker.onmessage = handler;
  }
  set onerror(handler: Worker["onerror"]) {
    this.worker.onerror = handler;
  }
  postMessage(message: unknown) {
    this.worker.postMessage(message);
  }
  terminate() {
    this.terminated = true;
    this.worker.terminate();
  }
}
const window = new Window();
Object.assign(globalThis, {
  Worker: TestWorker,
  document: window.document,
  HTMLInputElement: window.HTMLInputElement,
});
assert.equal(hashWorkerCount(50, 32), 4);
assert.equal(hashWorkerCount(50, 1), 2);
assert.equal(hashWorkerCount(2, 8), 2);
try {
  const allNames = hashAlgorithms.map((algorithm) => algorithm.name);
  const parallel = await hashSuite("abc", new Uint8Array(), {
    algorithms: allNames,
  });
  assert.deepEqual(parallel.rows, direct({ algorithm: "All algorithms" }).rows);
  assert.deepEqual(
    JSON.parse(Buffer.from(parallel.files![0].base64, "base64").toString()),
    parallel.rows,
  );
  assert.ok(created.length >= 2 && created.length <= 4);
  assert.ok(created.every((worker) => worker.terminated));
  const selected = await hashSuite("61-62-63", new Uint8Array(), {
    algorithms: selection,
    inputFormat: "Hex",
  });
  assert.deepEqual(selected.rows, subset.rows);
  const file = await hashSuite("ignored", new Uint8Array([97, 98, 99]), {
    algorithms: selection,
    fileProvided: true,
  });
  assert.deepEqual(file.rows, subset.rows);
  const single = await hashSuite("abc", new Uint8Array(), {
    algorithms: ["SHA-256"],
  });
  assert.equal(
    single.formatBytes,
    direct({ algorithm: "SHA-256" }).formatBytes,
  );
  await assert.rejects(
    hashSuite("abc", new Uint8Array(), { algorithms: selection, seed: "-1" }),
  );
  assert.ok(
    created.every((worker) => worker.terminated),
    "failed batches terminate the entire pool",
  );
  await assert.rejects(
    hashSuite("", new Uint8Array(1024 * 1024 + 1), {
      algorithms: selection,
      fileProvided: true,
    }),
  );
  await assert.rejects(hashSuite("abc", new Uint8Array(), { algorithms: [] }));

  window.document.body.innerHTML =
    '<div id="suite-controls"></div><div id="file-field"></div><div id="animation-options"></div><textarea id="input"></textarea><div class="field-header"></div>';
  let invalidations = 0;
  configureSuite("hash-workbench", () => {
    invalidations++;
  });
  const root = window.document.getElementById(
    "suite-controls",
  ) as unknown as HTMLElement;
  assert.deepEqual(new Set(selectedHashes(root)), new Set(popularHashes));
  const preset = (label: string) =>
    Array.from(root.querySelectorAll("button"))
      .find((button) => button.textContent === label)!
      .click();
  preset("Select all");
  assert.equal(selectedHashes(root).length, 50);
  preset("Clear selection");
  await assert.rejects(
    executeSuite("hash-workbench", "abc"),
    /Select at least one/,
  );
  const checkbox = root.querySelector<HTMLInputElement>(
    '[data-hash="SHA-256"]',
  )!;
  checkbox.click();
  assert.deepEqual(selectedHashes(root), ["SHA-256"]);
  assert.ok(
    root
      .querySelector('[role="status"]')!
      .textContent!.startsWith("1 selected"),
  );
  assert.equal((await executeSuite("hash-workbench", "abc")).kind, "code");
  preset("Popular");
  assert.ok(
    invalidations >= 4,
    "presets and checkbox changes invalidate old results",
  );
  const popular = await executeSuite("hash-workbench", "abc");
  assert.deepEqual(
    popular.rows,
    direct({ algorithms: [...popularHashes] }).rows,
  );
  configureSuite("util-byte-order", () => {});
  assert.equal(root.querySelectorAll("[data-hash]").length, 0);
  assert.ok(created.every((worker) => worker.terminated));
} finally {
  globalThis.Worker = NativeWorker;
}
console.log(
  "Custom/popular/all selection, real parallel WASM workers, ordered reports, limits, worker cleanup, and workbench controls passed.",
);
