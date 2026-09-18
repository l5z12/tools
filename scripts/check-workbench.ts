// SPDX-License-Identifier: AGPL-3.0-only
import { runImageRequest } from "../src/raster-engine";
import type { ImageRequest } from "../src/image-worker";
import { referenceIds } from "../src/lib/reference-tools";
import { codecIds } from "../src/lib/codec-tools";
import { utilityIds } from "../src/lib/utility-tools";
import { hashIds } from "../src/lib/hash-tools";
import { browserToolIds } from "../src/lib/browser-tools";
import { mediaIds } from "../src/lib/media-tools";
import { pythonIds } from "../src/lib/python-tools";
import { rustIds } from "../src/lib/rust-tools";
import { everydayIds } from "../src/lib/everyday-tools";
import { devInspectIds } from "../src/lib/dev-inspect-tools";
import { goIds } from "../src/lib/go-tools";
import { sqlIds } from "../src/lib/sql-tools";
import { cppIds } from "../src/lib/cpp-tools";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHmac, createHash, X509Certificate } from "node:crypto";
import { rootCertificates } from "node:tls";
import {
  gzipSync,
  gunzipSync,
  brotliCompressSync,
  brotliDecompressSync,
} from "node:zlib";
import { SignJWT, generateKeyPair, exportSPKI, exportJWK } from "jose";
import { Window } from "happy-dom";
import { createCanvas, loadImage, ImageData } from "@napi-rs/canvas";
import init, { suite_run, encode_apng } from "../src/generated/l5z12_tools";

import { workbenchTools, workbenchIds } from "../src/lib/workbench-tools";
import { tools } from "../src/lib/catalog";
import type { SuiteOptions, SuiteResult } from "../src/workbench-types";
await init({
  module_or_path: await readFile("public/wasm/l5z12_tools_bg.wasm"),
});
const run = (
  id: string,
  input = "",
  bytes: Uint8Array = new Uint8Array(),
  options: SuiteOptions = {},
): SuiteResult =>
  JSON.parse(suite_run(id, input, bytes, JSON.stringify(options)));
const contents = (r: SuiteResult, n = 0) =>
  Buffer.from(r.files![n].base64, "base64");
const payload = Buffer.from("Hello 🌍\n".repeat(100));
for (const algorithm of ["SHA-256", "SHA-384", "SHA-512"]) {
  const r = run("hmac-calc", "", payload, {
    fileProvided: true,
    key: "key",
    algorithm,
  });
  assert.equal(
    (r.data as { hex: string }).hex,
    createHmac(algorithm.replace("-", "").toLowerCase(), "key")
      .update(payload)
      .digest("hex"),
  );
  const sri = run("sri-generator", "", payload, {
    fileProvided: true,
    algorithm,
  });
  assert.equal(
    (sri.data as { integrity: string }).integrity,
    algorithm.replace("-", "").toLowerCase() +
      "-" +
      createHash(algorithm.replace("-", "").toLowerCase())
        .update(payload)
        .digest("base64"),
  );
}
const certificate = rootCertificates[0];
const parsed = run("cert-inspector", certificate, new Uint8Array(), {
  now: (Date.now() / 1000) | 0,
}).data as { SHA256: string }[];
assert.equal(
  parsed[0].SHA256,
  new X509Certificate(certificate).fingerprint256
    .replaceAll(":", "")
    .toLowerCase(),
);
assert.throws(() => run("cert-inspector", "no certificate"));
assert.ok(
  run("url-diff", "https://example.com/?q=a&q=b", new Uint8Array(), {
    second: "https://example.com/?q=a",
  }).rows?.some((r) => r.part === "query: q" && r.changed),
);
assert.equal(
  run("http-headers", "Set-Cookie: a=1\nSet-Cookie: b=2").rows?.length,
  2,
);
assert.throws(() => run("http-headers", "broken"));
for (const t of workbenchTools.filter((t) =>
  ["sql-formatter", "graphql-formatter"].includes(t.id),
))
  assert.ok(run(t.id, t.sample).text?.includes("\n"));
assert.throws(() => run("sql-formatter", "select from"));
assert.throws(() => run("graphql-formatter", "query {"));
const patch = run("json-patch", '{"a":1}', new Uint8Array(), {
  second: '{"a":2,"b":[1]}',
}).data as { patch: unknown };
const applied = run("json-patch", '{"a":1}', new Uint8Array(), {
  mode: "apply",
  second: JSON.stringify(patch.patch),
}).data as { result: unknown };
assert.deepEqual(applied.result, { a: 2, b: [1] });
assert.throws(() =>
  run("json-patch", "{}", new Uint8Array(), {
    mode: "apply",
    second: '[{"op":"remove","path":"/missing"}]',
  }),
);
const xml = '<root id="a"><item>x&amp;y</item><item>z</item></root>';
const mapping = run("xml-json", xml).data;
assert.deepEqual(mapping, { root: { "@id": "a", item: ["x&y", "z"] } });
assert.equal(
  run("xml-json", JSON.stringify(mapping), new Uint8Array(), {
    mode: "json-to-xml",
  }).text,
  xml,
);
assert.throws(() => run("xml-json", "<r>a<b/>c</r>"));
assert.throws(() =>
  run("xml-json", '<!DOCTYPE r [<!ENTITY a "x">]><r>&a;</r>'),
);
const csv = "name,score,lang\nAda,9,Rust\nLin,12,Rust\nSam,3,TS";
const csvResult = run("csv-workbench", csv, new Uint8Array(), {
  columns: [
    { key: "score", name: "points" },
    { key: "name", name: "person" },
  ],
  filterColumn: "lang",
  filterValue: "Rust",
  sortColumn: "score",
  numeric: true,
  descending: true,
});
assert.equal(contents(csvResult).toString(), "points,person\n12,Lin\n9,Ada\n");
assert.deepEqual(
  run("csv-workbench", csv, new Uint8Array(), { preview: true }).headers,
  ["name", "score", "lang"],
);
for (const to of [
  "utf-8",
  "utf-16le",
  "utf-16be",
  "windows-1252",
  "shift_jis",
]) {
  const original = Buffer.from(
    to === "windows-1252"
      ? "café €"
      : to === "shift_jis"
        ? "日本語"
        : "Hello 🌍",
  );
  const converted = run("encoding-file", "", original, {
    from: "utf-8",
    to,
    bom: true,
  });
  assert.equal(
    run("encoding-file", "", contents(converted), { from: to, to: "utf-8" })
      .text,
    original.toString(),
  );
}
assert.throws(() =>
  run("encoding-file", "", Buffer.from("🌍"), {
    from: "utf-8",
    to: "windows-1252",
  }),
);
assert.throws(() =>
  run("encoding-file", "", new Uint8Array([255]), {
    from: "utf-8",
    to: "utf-8",
  }),
);
for (const algorithm of ["gzip", "brotli", "zstd"]) {
  const compressed = contents(
    run("compression-workbench", "", payload, { algorithm, mode: "compress" }),
  );
  assert.deepEqual(
    contents(
      run("compression-workbench", "", compressed, {
        algorithm,
        mode: "decompress",
      }),
    ),
    payload,
  );
  if (algorithm === "gzip") {
    assert.deepEqual(gunzipSync(compressed), payload);
    assert.deepEqual(
      contents(
        run("compression-workbench", "", gzipSync(payload), {
          algorithm,
          mode: "decompress",
        }),
      ),
      payload,
    );
  }
  if (algorithm === "brotli") {
    assert.deepEqual(brotliDecompressSync(compressed), payload);
    assert.deepEqual(
      contents(
        run("compression-workbench", "", brotliCompressSync(payload), {
          algorithm,
          mode: "decompress",
        }),
      ),
      payload,
    );
  }
  if (algorithm === "zstd")
    assert.deepEqual(Buffer.from(Bun.zstdDecompressSync(compressed)), payload);
  assert.throws(() =>
    run("compression-workbench", "", new Uint8Array([1, 2, 3]), {
      algorithm,
      mode: "decompress",
    }),
  );
}
function crc(b: Uint8Array) {
  let n = 0xffffffff;
  for (const v of b) {
    n ^= v;
    for (let i = 0; i < 8; i++) n = (n >>> 1) ^ (n & 1 ? 0xedb88320 : 0);
  }
  return (n ^ 0xffffffff) >>> 0;
}
function zip(name: string, body: Buffer) {
  const n = Buffer.from(name);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50);
  local.writeUInt16LE(20, 4);
  local.writeUInt32LE(crc(body), 14);
  local.writeUInt32LE(body.length, 18);
  local.writeUInt32LE(body.length, 22);
  local.writeUInt16LE(n.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50);
  central.writeUInt16LE(20, 6);
  central.writeUInt32LE(crc(body), 16);
  central.writeUInt32LE(body.length, 20);
  central.writeUInt32LE(body.length, 24);
  central.writeUInt16LE(n.length, 28);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(46 + n.length, 12);
  end.writeUInt32LE(30 + n.length + body.length, 16);
  return Buffer.concat([local, n, body, central, n, end]);
}
function tar(name: string, body: Buffer) {
  const h = Buffer.alloc(512);
  h.write(name);
  h.write("0000644\0", 100);
  h.write("0000000\0", 108);
  h.write("0000000\0", 116);
  h.write(body.length.toString(8).padStart(11, "0") + "\0", 124);
  h.write("00000000000\0", 136);
  h.fill(32, 148, 156);
  h.write("0", 156);
  h.write("ustar\0", 257);
  const sum = h.reduce((a, b) => a + b, 0);
  h.write(sum.toString(8).padStart(6, "0") + "\0 ", 148);
  return Buffer.concat([
    h,
    body,
    Buffer.alloc(((512 - (body.length % 512)) % 512) + 1024),
  ]);
}
for (const make of [zip, tar]) {
  assert.deepEqual(
    contents(
      run("archive-explorer", "", make("folder/test.txt", payload), {
        mode: "extract",
      }),
    ),
    payload,
  );
  assert.equal(
    run("archive-explorer", "", make("../escape.txt", payload), {
      mode: "extract",
    }).files?.length,
    0,
  );
  assert.equal(
    run("archive-explorer", "", make("test.txt", payload), { mode: "inspect" })
      .rows?.length,
    1,
  );
}
const red = new Uint8Array([255, 0, 0, 255]),
  blue = new Uint8Array([0, 0, 255, 255]);
const animation = encode_apng(
  1,
  1,
  new Uint8Array([...red, ...blue]),
  new Uint16Array([100, 250]),
  3,
  new Uint8Array(),
);
const extracted = run("apng-extract", "", animation);
assert.equal(extracted.files?.length, 3);
assert.equal(
  (extracted.data as { frames: { milliseconds: number }[] }).frames[1]
    .milliseconds,
  250,
);
const invalid = new Uint8Array(animation);
invalid[30] ^= 1;
assert.throws(() => run("apng-extract", "", invalid));
const key = new TextEncoder().encode("a secret with at least thirty-two bytes");
const token = await new SignJWT({ role: "reader" })
  .setProtectedHeader({ alg: "HS256" })
  .setIssuer("test")
  .setAudience("tools")
  .setExpirationTime("1h")
  .sign(key);
assert.equal(
  (
    await browserSuite("jwt-verify", token, {
      algorithm: "HS256",
      keyFormat: "text",
      key: new TextDecoder().decode(key),
      issuer: "test",
      audience: "tools",
    })
  ).kind,
  "data",
);
await assert.rejects(() =>
  browserSuite("jwt-verify", token, {
    algorithm: "HS256",
    keyFormat: "text",
    key: "wrong",
  }),
);
await assert.rejects(() =>
  browserSuite("jwt-verify", token, {
    algorithm: "HS512",
    keyFormat: "text",
    key: new TextDecoder().decode(key),
  }),
);
await assert.rejects(() =>
  browserSuite("jwt-verify", token, {
    algorithm: "HS256",
    keyFormat: "text",
    key: new TextDecoder().decode(key),
    issuer: "wrong",
  }),
);
const pair = await generateKeyPair("RS256", { extractable: true });
const rsa = await new SignJWT({})
  .setProtectedHeader({ alg: "RS256" })
  .sign(pair.privateKey);
assert.equal(
  (
    await browserSuite("jwt-verify", rsa, {
      algorithm: "RS256",
      keyFormat: "spki",
      key: await exportSPKI(pair.publicKey),
    })
  ).kind,
  "data",
);
for (const algorithm of [
  "HS384",
  "HS512",
  "RS256",
  "PS256",
  "ES256",
  "EdDSA",
]) {
  const asymmetric = !algorithm.startsWith("HS");
  const keys = asymmetric
    ? await generateKeyPair(algorithm, { extractable: true })
    : undefined;
  const signed = await new SignJWT({ aud: ["other", "tools"] })
    .setProtectedHeader({ alg: algorithm })
    .setExpirationTime("1h")
    .sign(keys?.privateKey ?? key);
  const verification: SuiteOptions = {
    algorithm,
    audience: "tools",
    keyFormat: keys ? "spki" : "base64",
    key: keys
      ? await exportSPKI(keys.publicKey)
      : Buffer.from(key).toString("base64"),
  };
  assert.equal(
    (await browserSuite("jwt-verify", signed, verification)).kind,
    "data",
  );
  if (keys) {
    const jwk = await exportJWK(keys.publicKey);
    assert.equal(
      (
        await browserSuite("jwt-verify", signed, {
          ...verification,
          keyFormat: "jwk",
          key: JSON.stringify(jwk),
        })
      ).kind,
      "data",
    );
    await assert.rejects(() =>
      browserSuite("jwt-verify", signed, {
        ...verification,
        keyFormat: "jwk",
        key: JSON.stringify({ ...jwk, use: "enc" }),
      }),
    );
  }
  const parts = signed.split(".");
  parts[1] = Buffer.from('{"admin":true}').toString("base64url");
  await assert.rejects(() =>
    browserSuite("jwt-verify", parts.join("."), verification),
  );
}
for (const claims of [{ exp: 1 }, { nbf: Date.now() / 1000 + 3600 }]) {
  const expired = await new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256" })
    .sign(key);
  await assert.rejects(() =>
    browserSuite("jwt-verify", expired, {
      algorithm: "HS256",
      keyFormat: "text",
      key: new TextDecoder().decode(key),
    }),
  );
}
assert.match(
  run("uuid", "3").text!,
  /^(?:[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\n){2}[a-f0-9-]{36}$/,
);
assert.match(run("password", "64").text!, /^[A-Za-z0-9_-]{64}$/);
assert.throws(() => run("password", "257"));
assert.throws(
  () => run("util-clean-urls", "https://example.com\n".repeat(1001)),
  /1,000/,
);
assert.equal(
  run(
    "util-clean-urls",
    "https://example.com\n".repeat(1001),
    new Uint8Array(),
    {
      bypassLimits: true,
    },
  ).rows?.length,
  1001,
);
assert.equal(
  run("file-sha256", "", payload).text,
  createHash("sha256").update(payload).digest("hex"),
);
const svg = await browserSuite(
  "svg-optimizer",
  '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" onload="alert(1)"><script>alert(1)</script><foreignObject><div>Hi</div></foreignObject><rect width="10" height="10" fill="#ff0000"/></svg>',
  {},
);
assert.ok(!/onload|script|foreignObject/.test(svg.text!));
assert.ok(svg.files?.[0].mime === "image/svg+xml");
// DOM integration uses a native canvas and the real WASM implementation behind a worker stand-in.
const window = new Window();
const document = window.document;
Object.assign(globalThis, {
  document,
  HTMLElement: window.HTMLElement,
  HTMLInputElement: window.HTMLInputElement,
  ImageData,
});
const create = document.createElement.bind(document);
document.createElement = ((tag: string, options?: unknown) => {
  if (tag === "canvas") {
    const c = createCanvas(1, 1);
    Object.assign(c, {
      toBlob: (callback: (b: Blob) => void) =>
        callback(
          new Blob([new Uint8Array(c.toBuffer("image/png"))], {
            type: "image/png",
          }),
        ),
    });
    return c;
  }
  return create(tag, options as never);
}) as typeof document.createElement;
Object.assign(globalThis, {
  createImageBitmap: async (file: File) => {
    const image = await loadImage(Buffer.from(await file.arrayBuffer()));
    Object.assign(image, { close: () => {} });
    return image;
  },
  Worker: class {
    onmessage?: ({
      data,
    }: {
      data: { result?: SuiteResult | Uint8Array; error?: string };
    }) => void;
    terminate() {}
    postMessage(
      d:
        | {
            id: string;
            input: string;
            bytes: Uint8Array;
            options: SuiteOptions;
          }
        | ImageRequest,
    ) {
      queueMicrotask(async () => {
        try {
          this.onmessage?.({
            data: {
              result:
                "kind" in d
                  ? await runImageRequest(d)
                  : run(d.id, d.input, d.bytes, d.options),
            },
          });
        } catch (e) {
          this.onmessage?.({ data: { error: String(e) } });
        }
      });
    }
  },
});
const { imageSuite } = await import("../src/workbench-images");
const c = createCanvas(2, 2);
const ctx = c.getContext("2d");
ctx.fillStyle = "#ff0000";
ctx.fillRect(0, 0, 2, 2);
const f = new File([new Uint8Array(c.toBuffer("image/png"))], "red.png", {
  type: "image/png",
});
ctx.fillStyle = "#0000ff";
ctx.fillRect(0, 0, 2, 2);
const g = new File([new Uint8Array(c.toBuffer("image/png"))], "blue.png", {
  type: "image/png",
});
const palette = await imageSuite("palette-extractor", [f], { count: 4 });
assert.equal(palette.colors?.[0].hex, "#ff0000");
assert.equal(palette.colors?.[0].percent, 100);
const compare = await imageSuite("image-compare", [f, g], {});
assert.equal((compare.data as { changedPixels: number }).changedPixels, 4);
assert.equal(
  (await imageSuite("image-compare", [f, f], {})).data &&
    (
      (await imageSuite("image-compare", [f, f], {})).data as {
        changedPixels: number;
      }
    ).changedPixels,
  0,
);
const sprite = await imageSuite("sprite-builder", [f, g], {
  columns: 2,
  gap: 1,
});
assert.equal(sprite.files?.length, 3);
const sheet = await loadImage(contents(sprite));
assert.equal(sheet.width, 5);
const inspect = createCanvas(5, 2);
inspect.getContext("2d").drawImage(sheet, 0, 0);
assert.deepEqual(
  [...inspect.getContext("2d").getImageData(3, 0, 1, 1).data],
  [0, 0, 255, 255],
);
assert.equal(inspect.getContext("2d").getImageData(2, 0, 1, 1).data[3], 0);
const icons = await imageSuite("favicon-builder", [f], {});
assert.equal(icons.files?.length, 9);
const ico = contents(icons);
assert.equal(ico.readUInt16LE(2), 1);
assert.equal(ico.readUInt16LE(4), 4);
for (let i = 0; i < 4; i++) {
  const length = ico.readUInt32LE(6 + i * 16 + 8),
    offset = ico.readUInt32LE(6 + i * 16 + 12);
  assert.equal(
    ico.subarray(offset, offset + 8).toString("hex"),
    "89504e470d0a1a0a",
  );
  assert.ok(offset + length <= ico.length);
}
document.body.innerHTML =
  '<div class="field-header"></div><textarea id="input"></textarea><div id="file-field"></div><div id="animation-options"></div><div id="suite-controls"></div><div id="result-view"></div>';
const { configureSuite, renderSuite, clearSuite } =
  await import("../src/workbench-ui");
for (const t of workbenchTools) {
  configureSuite(t.id, () => {});
  assert.equal(
    document.getElementById("suite-controls")!.hasAttribute("hidden"),
    false,
  );
  for (const f of t.fields)
    assert.ok(document.getElementById("suite-" + f.key));
}
const view = document.getElementById("result-view") as unknown as HTMLElement;
renderSuite(view, compare);
assert.ok(view.querySelector("input[type=range]"));
clearSuite();
renderSuite(view, csvResult);
assert.equal(view.querySelectorAll("tbody tr").length, 2);
clearSuite();
renderSuite(view, icons);
assert.equal(view.querySelectorAll("a[download]").length, 9);
clearSuite();
renderSuite(view, { kind: "data", data: { test: '<img onerror="alert(1)">' } });
assert.equal(view.querySelectorAll("img").length, 0);
assert.equal(
  workbenchTools.filter(
    (t) =>
      !referenceIds.has(t.id) &&
      !codecIds.has(t.id) &&
      !utilityIds.has(t.id) &&
      !hashIds.has(t.id) &&
      !browserToolIds.has(t.id) &&
      !mediaIds.has(t.id) &&
      !pythonIds.has(t.id) &&
      !rustIds.has(t.id) &&
      !goIds.has(t.id) &&
      !cppIds.has(t.id) &&
      !sqlIds.has(t.id) &&
      !everydayIds.has(t.id) &&
      !devInspectIds.has(t.id),
  ).length,
  19,
);
assert.equal(workbenchIds.size, workbenchTools.length);
assert.equal(new Set(tools.map((t) => t.id)).size, tools.length);
console.log(
  `Workbench controls passed: independent crypto/compression references, format conversions, archives, APNG, native-canvas image exports, and DOM controls/results. ${tools.length} total tools.`,
);

async function browserSuite(
  id: string,
  input: string,
  options: SuiteOptions,
): Promise<SuiteResult> {
  return run(id, input, new Uint8Array(), {
    now: Date.now() / 1000,
    ...options,
  });
}
