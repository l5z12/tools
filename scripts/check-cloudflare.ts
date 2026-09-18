// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  createRuntimeAssetLoader,
  type AssetManifest,
} from "../src/runtime-assets";

if (!process.env.CLOUDFLARE_TEST_URL) {
  const build = Bun.spawn([process.execPath, "run", "package:cloudflare"], {
    stdout: "inherit",
    stderr: "inherit",
  });
  assert.equal(await build.exited, 0);
}
const assets = "work/cloudflare/assets";
const manifest = (await Bun.file(
  join(assets, "runtime-assets.json"),
).json()) as AssetManifest;
for (const name of await readdir(assets, { recursive: true })) {
  const file = Bun.file(join(assets, name));
  if (await file.exists()) assert.ok(file.size <= 25 * 1024 * 1024, name);
}
const base = process.env.CLOUDFLARE_TEST_URL ?? "https://tools.example";
const load = createRuntimeAssetLoader(
  base,
  process.env.CLOUDFLARE_TEST_URL
    ? fetch
    : async (url) => {
        const file = Bun.file(join(assets, url.pathname.slice(1)));
        return new Response(file.stream());
      },
);
async function digest(stream: ReadableStream<Uint8Array>): Promise<string> {
  const hash = createHash("sha256");
  for await (const bytes of stream) hash.update(bytes);
  return hash.digest("hex");
}
for (const [path, asset] of Object.entries(manifest)) {
  const response = await load(path);
  assert.equal(response.headers.get("Content-Type"), asset.contentType);
  assert.equal(await digest(response.body!), asset.etag.slice(1, -1), path);
  assert.equal(
    await digest(Bun.file(`dist${path}`).stream()),
    asset.etag.slice(1, -1),
    path,
  );
  assert.equal(await Bun.file(join(assets, path.slice(1))).exists(), false);
  if (process.env.CLOUDFLARE_TEST_URL)
    assert.equal((await fetch(new URL(path, base))).status, 404);
}
const config = await readFile("wrangler.jsonc", "utf8");
assert.ok(
  !config.includes('"main"') && !config.includes('"binding"'),
  "Hosting must have no server handler or binding.",
);
const prefix = `/__asset_chunks/${"a".repeat(64)}`;
const tiny = {
  size: 8,
  contentType: "application/wasm",
  etag: '"test"',
  chunks: [`${prefix}/0.bin`, `${prefix}/1.bin`],
};
let manifestFetches = 0;
let partFetches = 0;
const tinyLoad = createRuntimeAssetLoader(base, async (url) => {
  if (url.pathname === "/runtime-assets.json") {
    manifestFetches++;
    return Response.json({ "/tiny.wasm": tiny });
  }
  if (url.pathname === "/small.txt") return new Response("small");
  partFetches++;
  return new Response(
    new Uint8Array(
      url.pathname.endsWith("0.bin") ? [0, 97, 115, 109] : [1, 0, 0, 0],
    ),
  );
});
await WebAssembly.compileStreaming(await tinyLoad("/tiny.wasm"));
assert.equal(partFetches, 2);
assert.equal(await (await tinyLoad("/small.txt")).text(), "small");
assert.equal(manifestFetches, 1);
await assert.rejects(tinyLoad("https://elsewhere.example/x"), /this site/);
const aborted = new AbortController();
aborted.abort();
await assert.rejects(tinyLoad("/tiny.wasm", aborted.signal));
for (const status of [200, 404]) {
  const broken = createRuntimeAssetLoader(base, async (url) =>
    url.pathname === "/runtime-assets.json"
      ? Response.json({ "/tiny.wasm": tiny })
      : new Response("", { status }),
  );
  await assert.rejects(
    (await broken("/tiny.wasm")).arrayBuffer(),
    status === 200 ? /incomplete/ : /runtime part/,
  );
}
let cancelled = false;
partFetches = 0;
const cancelLoad = createRuntimeAssetLoader(base, async (url) => {
  if (url.pathname === "/runtime-assets.json")
    return Response.json({ "/tiny.wasm": tiny });
  partFetches++;
  return new Response(
    new ReadableStream({
      pull(controller) {
        controller.enqueue(new Uint8Array([1]));
      },
      cancel() {
        cancelled = true;
      },
    }),
  );
});
const reader = (await cancelLoad("/tiny.wasm")).body!.getReader();
await reader.read();
await reader.cancel();
assert.equal(cancelled, true);
assert.equal(partFetches, 1);
if (process.env.CLOUDFLARE_TEST_URL) {
  for (const path of ["/", "/fingerprint/", "/fingerprint/index.html"]) {
    const page = await fetch(new URL(path, base));
    assert.equal(page.status, 200, path);
    const csp = page.headers.get("Content-Security-Policy")!;
    assert.ok(csp.includes("frame-ancestors 'self'"), path);
    assert.equal(
      csp.includes("'unsafe-eval'"),
      path.startsWith("/fingerprint/"),
      path,
    );
  }
}
console.log(
  "Static hosting checks passed: no backend, asset limits, browser reassembly, streaming WASM, cancellation, and failed downloads.",
);
