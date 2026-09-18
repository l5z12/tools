// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createCanvas } from "@napi-rs/canvas";
import {
  Window,
  type HTMLSelectElement as TestSelect,
  type HTMLInputElement as TestInput,
} from "happy-dom";
import { creepReport } from "../src/browser-fingerprint/reports";
import { browserFingerprint } from "../src/browser-fingerprint";
import {
  browserSignals,
  canonicalJson,
  probe,
} from "../src/browser-fingerprint/signals";
import {
  canvasSignal,
  webglSignals,
} from "../src/browser-fingerprint/rendering";
import { tools } from "../src/lib/catalog";
import { matchesTool } from "../src/lib/search";
import {
  configureSuite,
  executeSuite,
  renderSuite,
  clearSuite,
} from "../src/workbench-ui";

const hash = async (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
assert.equal(
  canonicalJson({ z: [{ b: 2, a: 1 }], a: false }),
  '{"a":false,"z":[{"a":1,"b":2}]}',
);
assert.notEqual(canonicalJson([1, 2]), canonicalJson([2, 1]));
assert.equal(probe("test", "zero", () => 0).status, "available");
assert.equal(probe("test", "false", () => false).value, false);
assert.equal(probe("test", "missing", () => undefined).status, "unavailable");
assert.equal(
  probe("test", "blocked", () => {
    throw Error("private error");
  }).status,
  "blocked or failed",
);

const window = new Window();
const environment = window as unknown as globalThis.Window;
const navigator = window.navigator;
Object.defineProperty(navigator, "userAgent", {
  configurable: true,
  value: "Test browser 🌍",
});
Object.defineProperty(navigator, "deviceMemory", {
  configurable: true,
  get() {
    throw Error("denied");
  },
});
let forbiddenCalls = 0;
const forbidden = () => {
  forbiddenCalls++;
  throw Error("Unexpected network, storage, or permission call");
};
Object.assign(window, { fetch: forbidden });
Object.defineProperty(window, "localStorage", { get: forbidden });
Object.defineProperty(window, "sessionStorage", { get: forbidden });
Object.defineProperty(navigator, "geolocation", { get: forbidden });
Object.defineProperty(navigator, "mediaDevices", { get: forbidden });
const first = await browserFingerprint(
  { canvas: false, webgl: false },
  environment,
  hash,
);
const second = await browserFingerprint(
  { canvas: false, webgl: false },
  environment,
  hash,
);
assert.equal(first.headline!.value, second.headline!.value);
assert.match(first.headline!.value, /^[0-9a-f]{64}$/);
assert.equal(
  first.rows!.find((row) => row.signal === "Device memory GiB (reported)")!
    .status,
  "blocked or failed",
);
assert.equal(first.rows!.filter((row) => row.status === "excluded").length, 2);
const report = JSON.parse(
  Buffer.from(first.files![1].base64, "base64").toString(),
);
const exactInput = Buffer.from(first.files![2].base64, "base64");
assert.equal(
  createHash("sha256").update(exactInput).digest("hex"),
  report.fingerprint,
);
assert.deepEqual(JSON.parse(exactInput.toString()), report.profile);
assert.ok(first.text!.includes("Test browser 🌍"));
Object.defineProperty(navigator, "userAgent", {
  configurable: true,
  value: "Changed browser",
});
assert.notEqual(
  (await browserFingerprint({ canvas: false, webgl: false }, environment, hash))
    .headline!.value,
  first.headline!.value,
);
assert.equal(forbiddenCalls, 0);
assert.equal(browserSignals(environment).length, 32);

// Actual native canvas pixels validate repeatability and nonempty render output.
const canvasDocument = {
  createElement: () => createCanvas(280, 80),
} as unknown as Document;
const canvas = await canvasSignal(canvasDocument, hash);
assert.equal(canvas.status, "available");
assert.match(String(canvas.value), /^[0-9a-f]{64}$/);
assert.equal((await canvasSignal(canvasDocument, hash)).value, canvas.value);
assert.notEqual(canvas.value, await hash(new Uint8Array(280 * 80 * 4)));
const unavailableDocument = {
  createElement: () => ({ getContext: () => null }),
} as unknown as Document;
assert.equal(
  (await canvasSignal(unavailableDocument, hash)).status,
  "unavailable",
);
assert.equal(webglSignals(unavailableDocument)[0].status, "unavailable");
const blockedDocument = {
  createElement: () => {
    throw Error("denied");
  },
} as unknown as Document;
assert.equal(
  (await canvasSignal(blockedDocument, hash)).status,
  "blocked or failed",
);
assert.equal(webglSignals(blockedDocument)[0].status, "blocked or failed");

let released = 0;
const gl = {
  VENDOR: 1,
  RENDERER: 2,
  VERSION: 3,
  SHADING_LANGUAGE_VERSION: 4,
  MAX_TEXTURE_SIZE: 5,
  MAX_VERTEX_ATTRIBS: 6,
  getParameter: (key: number) => {
    if (key === 2) throw Error("masked");
    return `parameter ${key}`;
  },
  getSupportedExtensions: () => ["Z", "A"],
  getExtension: (name: string) =>
    name === "WEBGL_lose_context"
      ? {
          loseContext: () => {
            released++;
          },
        }
      : null,
};
const webglDocument = {
  createElement: () => ({ getContext: () => gl }),
} as unknown as Document;
const webgl = webglSignals(webglDocument);
assert.equal(
  webgl.find((signal) => signal.name === "Renderer")!.status,
  "blocked or failed",
);
assert.equal(
  webgl.find((signal) => signal.name === "Unmasked renderer")!.status,
  "unavailable",
);
assert.deepEqual(webgl.find((signal) => signal.name === "Extensions")!.value, [
  "A",
  "Z",
]);
assert.equal(released, 1);
const renderingEnvironment = {
  navigator: environment.navigator,
  screen: environment.screen,
  devicePixelRatio: environment.devicePixelRatio,
  matchMedia: environment.matchMedia.bind(environment),
  document: {
    createElement: () => {
      const canvas = createCanvas(280, 80);
      return {
        width: 280,
        height: 80,
        getContext: (kind: string) =>
          kind === "webgl" ? gl : canvas.getContext("2d"),
      };
    },
  },
} as unknown as globalThis.Window;
const complete = await browserFingerprint({}, renderingEnvironment, hash);
assert.equal(complete.rows!.length, 43);
assert.equal(
  complete.rows!.filter((row) => row.status === "excluded").length,
  0,
);
assert.equal(
  complete.rows!.find((row) => row.signal === "Canvas RGBA SHA-256")!.value,
  canvas.value,
);
assert.equal(released, 2);

// Route the production browser UI through real WASM worker threads with a local-file loader.
const NativeWorker = globalThis.Worker;
class LocalWorker extends NativeWorker {
  constructor() {
    super(new URL("./fixtures/hash-worker.ts", import.meta.url));
  }
}
Object.assign(globalThis, {
  window,
  document: window.document,
  HTMLInputElement: window.HTMLInputElement,
  Worker: LocalWorker,
});
let copied = "";
Object.defineProperty(globalThis.navigator, "clipboard", {
  configurable: true,
  value: {
    writeText: async (text: string) => {
      copied = text;
    },
  },
});
window.document.body.innerHTML =
  '<div id="suite-controls"></div><div id="file-field"></div><div id="animation-options"></div><textarea id="input"></textarea><div class="field-header"></div><div id="result"></div>';
try {
  const tool = tools.find((tool) => tool.id === "browser-fingerprint")!;
  assert.ok(
    matchesTool(tool, "browser fingerprint #privacy", new Set(["privacy"])),
  );
  configureSuite(tool.id, () => {});
  assert.equal(environment.document.getElementById("input")!.hidden, true);
  assert.equal(
    window.document.querySelector(".field-header")!.getAttribute("hidden"),
    "",
  );
  assert.equal(window.document.getElementById("suite-file"), null);
  assert.equal(window.document.querySelectorAll("[data-key]").length, 4);
  const profileSelect =
    window.document.querySelector<TestSelect>("#suite-profile")!;
  const highEntropy =
    window.document.querySelector<TestInput>("#suite-highEntropy")!;
  const canvasControl =
    window.document.querySelector<TestInput>("#suite-canvas")!;
  assert.equal(profileSelect.options.length, 4);
  assert.equal(highEntropy.parentElement!.hasAttribute("hidden"), true);
  for (const profile of [
    "FingerprintJS 3.4.2",
    "CreepJS (local)",
    "User-Agent Client Hints",
  ]) {
    profileSelect.value = profile;
    profileSelect.dispatchEvent(new window.Event("change", { bubbles: true }));
    assert.equal(canvasControl.parentElement!.hasAttribute("hidden"), true);
    assert.equal(
      highEntropy.parentElement!.hasAttribute("hidden"),
      profile !== "User-Agent Client Hints",
    );
  }
  const hintsResult = await executeSuite(tool.id, "ignored");
  assert.equal((hintsResult.data as { status: string }).status, "unavailable");
  assert.match(hintsResult.headline!.value, /^[0-9a-f]{64}$/);
  profileSelect.value = "L5Z12 v1";
  profileSelect.dispatchEvent(new window.Event("change", { bubbles: true }));
  assert.equal(canvasControl.parentElement!.hasAttribute("hidden"), false);
  for (const input of environment.document.querySelectorAll<HTMLInputElement>(
    'input[type="checkbox"][data-key]',
  ))
    input.checked = false;
  const actual = await executeSuite(tool.id, "ignored");
  assert.equal(
    actual.headline!.value,
    (
      await browserFingerprint(
        { canvas: false, webgl: false },
        environment,
        hash,
      )
    ).headline!.value,
  );
  const result = window.document.getElementById(
    "result",
  ) as unknown as HTMLElement;
  renderSuite(result, actual);
  assert.equal(result.querySelectorAll("tbody tr").length, actual.rows!.length);
  assert.equal(result.querySelectorAll("a[download]").length, 3);
  result.querySelector("button")!.click();
  await Promise.resolve();
  assert.equal(copied, actual.headline!.value);
  assert.equal(forbiddenCalls, 0);
  const component = {
    platform: "<img src=x onerror=alert(1)>",
    enabled: false,
    zero: 0,
    missing: null,
    nested: { locale: "en-US" },
    values: Array.from({ length: 51 }, (_, index) => index),
    long: "x".repeat(3000),
  };
  const readableReport = creepReport({
    fingerprint: { workerScope: component },
    creep: {},
    fpHash: "a",
    creepHash: "b",
    fuzzyFingerprint: "c",
  });
  renderSuite(result, readableReport);
  assert.equal(result.querySelector("table"), null);
  const section = result.querySelector<HTMLDetailsElement>(
    ".fingerprint-component",
  )!;
  assert.equal(section.querySelector("dl"), null, "closed branches are lazy");
  section.open = true;
  section.dispatchEvent(new window.Event("toggle") as unknown as Event);
  assert.equal(section.querySelectorAll(".fingerprint-fields > div").length, 7);
  assert.equal(
    section.querySelector("img"),
    null,
    "signal text is never parsed as HTML",
  );
  const array = [...section.querySelectorAll("details")].find(
    (node) => node.querySelector("summary")!.textContent === "51 items",
  )!;
  array.open = true;
  array.dispatchEvent(new window.Event("toggle") as unknown as Event);
  assert.equal(array.querySelectorAll("dt").length, 50);
  array.querySelector("button")!.click();
  assert.equal(array.querySelectorAll("dt").length, 51);
  const rawToggle = section.querySelector<HTMLButtonElement>(
    'button[aria-label="View raw JSON for workerScope"]',
  )!;
  rawToggle.click();
  const raw = section.querySelector<HTMLPreElement>(
    'pre[aria-label="Raw JSON for workerScope"]',
  )!;
  assert.equal(raw.hidden, false);
  assert.deepEqual(JSON.parse(raw.textContent!), component);
  rawToggle.click();
  assert.equal(raw.hidden, true);
  assert.equal(array.open, true, "tree state survives switching raw view");
  assert.deepEqual(
    JSON.parse(
      Buffer.from(readableReport.files![0].base64, "base64").toString(),
    ).fingerprint.workerScope,
    component,
  );
  clearSuite();
  configureSuite("hash-workbench", () => {});
  assert.equal(environment.document.getElementById("input")!.hidden, false);
} finally {
  globalThis.Worker = NativeWorker;
}
console.log(
  "Browser fingerprint passed: exact hash reproduction, signal changes, blocked/missing APIs, native canvas pixels, GPU cleanup, local-only probes, WASM integration, copy and report rendering.",
);
