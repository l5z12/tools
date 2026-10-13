// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { Window } from "happy-dom";
import init, {
  run,
  suite_run,
  set_bypass_limits,
} from "../src/generated/l5z12_tools";
import { runImageRequest } from "../src/raster-engine";
import { imageSuite } from "../src/workbench-images";
import { renderWorkbenchView, clearWorkbenchView } from "../src/workbench-view";
import type { ImageRequest, SuiteRequest } from "../src/workers/protocol";
import type { SuiteResult } from "../src/workbench-types";

await init({
  module_or_path: await readFile("public/wasm/l5z12_tools_bg.wasm"),
});
let activeWorkers = 0;
Object.assign(globalThis, {
  Worker: class {
    onmessage?: (event: {
      data: { result: unknown } | { error: string };
    }) => void;
    constructor() {
      activeWorkers++;
    }
    terminate() {
      activeWorkers--;
    }
    postMessage(request: ImageRequest | SuiteRequest) {
      queueMicrotask(async () => {
        try {
          set_bypass_limits(
            "kind" in request
              ? request.bypassLimits === true
              : request.options.bypassLimits === true,
          );
          const result =
            "kind" in request
              ? await runImageRequest(request)
              : JSON.parse(
                  suite_run(
                    request.id,
                    request.input,
                    request.bytes,
                    JSON.stringify(request.options),
                  ),
                );
          this.onmessage?.({ data: { result } });
        } catch (error) {
          this.onmessage?.({ data: { error: String(error) } });
        }
      });
    }
  },
});

// Generate with the existing encoder, rasterize independently, then exercise
// file decoding and the QR decoder through the browser's imageSuite adapter.
async function qrCanvas(text: string) {
  const image = await loadImage(Buffer.from(run("qr-code", text, "")));
  const canvas = createCanvas(image.width, image.height);
  canvas.getContext("2d").drawImage(image, 0, 0);
  return canvas;
}
const payload =
  '你好 🌍\nhttps://example.com/?a=1&b=2\n<img src=x onerror="alert(1)">';
const canvas = await qrCanvas(payload);
let result: SuiteResult | undefined;
for (const format of ["png", "jpeg", "webp"] as const) {
  const encoded =
    format === "png" ? canvas.encodeSync("png") : canvas.encodeSync(format);
  const file = new File([new Uint8Array(encoded)], `qr.${format}`, {
    type: `image/${format}`,
  });
  result = await imageSuite("qr-decode", [file], {});
  assert.equal(result.text, payload);
  assert.equal(result.rows?.length, 1);
  assert.equal(result.rows[0].text, payload);
  assert.equal(result.rows[0].errorCorrection, "M");
  assert.deepEqual(
    Buffer.from(result.files![0].base64, "base64"),
    Buffer.from(payload),
  );
}

const first = await qrCanvas("first");
const second = await qrCanvas("second");
const multiple = createCanvas(
  first.width + second.width + 40,
  Math.max(first.height, second.height),
);
const context = multiple.getContext("2d");
context.fillStyle = "white";
context.fillRect(0, 0, multiple.width, multiple.height);
context.drawImage(first, 0, 0);
context.drawImage(second, first.width + 40, 0);
const multipleResult = await imageSuite(
  "qr-decode",
  [new File([new Uint8Array(multiple.encodeSync("png"))], "multiple.png")],
  {},
);
assert.deepEqual(multipleResult.rows!.map((row) => row.text).sort(), [
  "first",
  "second",
]);
assert.equal(multipleResult.files!.length, 2);
assert.deepEqual(JSON.parse(multipleResult.text!), multipleResult.rows);

await assert.rejects(imageSuite("qr-decode", [], {}), /Choose an image/);
await assert.rejects(
  imageSuite("qr-decode", [new File(["not an image"], "bad.png")], {}),
);
const blank = createCanvas(100, 100);
blank.getContext("2d").fillRect(0, 0, 100, 100);
await assert.rejects(
  imageSuite(
    "qr-decode",
    [new File([new Uint8Array(blank.encodeSync("png"))], "blank.png")],
    {},
  ),
  /No QR code/,
);
assert.equal(activeWorkers, 0, "Success and failure must release all workers.");

const window = new Window({ settings: { enableJavaScriptEvaluation: false } });
Object.assign(globalThis, { document: window.document });
const view = window.document.createElement("div") as unknown as HTMLElement;
renderWorkbenchView(view, result!, "qr-decode", () => {});
assert.ok(view.textContent!.includes(payload));
assert.equal(
  view.querySelectorAll("img, script, iframe").length,
  0,
  "Decoded content must be rendered as text.",
);
const download = view.querySelector<HTMLAnchorElement>("a[download]")!;
assert.equal(download.download, "qr-1.txt");
assert.equal(await (await fetch(download.href)).text(), payload);
clearWorkbenchView();
await assert.rejects(
  fetch(download.href),
  "Clearing results must revoke download URLs.",
);
renderWorkbenchView(view, multipleResult, "qr-decode", () => {});
assert.equal(view.querySelectorAll("tbody tr").length, 2);
assert.equal(view.querySelectorAll("a[download]").length, 2);
clearWorkbenchView();
await window.happyDOM.close();
console.log(
  "QR decoding passed: PNG/JPEG/WebP uploads, Unicode, multiple codes, exact downloads, safe rendering, error paths and worker cleanup.",
);
