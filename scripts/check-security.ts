// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Window } from "happy-dom";
import { contentSecurityPolicy, securityHeaders } from "../src/lib/security";
const policy = contentSecurityPolicy();
assert.ok(policy.includes("script-src 'self' 'wasm-unsafe-eval'"));
assert.ok(!policy.includes("'unsafe-eval'"));
assert.ok(policy.includes("script-src-attr 'none'"));
assert.ok(policy.includes("connect-src 'self';"));
assert.ok(!policy.includes("https:") && !policy.includes("ws:"));
assert.ok(contentSecurityPolicy(false, true).includes("'unsafe-eval'"));
assert.equal(securityHeaders["X-Content-Type-Options"], "nosniff");
const window = new Window({ settings: { enableJavaScriptEvaluation: false } });
window.document.write(await readFile("dist/index.html", "utf8"));
assert.equal(
  window.document
    .querySelector('meta[http-equiv="Content-Security-Policy"]')!
    .getAttribute("content"),
  policy,
);
for (const script of window.document.querySelectorAll("script")) {
  if (script.type === "application/json") continue;
  assert.ok(script.src, "Production scripts must be external under this CSP.");
}
const headers = await readFile("dist/_headers", "utf8");
assert.ok(headers.includes("frame-ancestors 'self'"));
assert.ok(headers.includes("/fingerprint/*"));
assert.ok(
  (await readFile("dist/fingerprint/index.html", "utf8")).includes(
    contentSecurityPolicy(false, true),
  ),
);
const config = await readFile(".cargo/config.toml", "utf8");
assert.ok(config.includes("--max-memory=536870912"));
if (process.env.SECURITY_TEST_URL) {
  for (const path of ["/", "/fingerprint/index.html"]) {
    const response: Response = await fetch(
      new URL(path, process.env.SECURITY_TEST_URL),
    );
    assert.equal(response.status, 200);
    assert.ok(
      response.headers
        .get("content-security-policy")
        ?.includes("frame-ancestors 'self'"),
    );
    const document = new Window({
      settings: { enableJavaScriptEvaluation: false },
    }).document;
    document.write(await response.text());
    assert.equal(
      document
        .querySelector('meta[http-equiv="Content-Security-Policy"]')
        ?.getAttribute("content"),
      contentSecurityPolicy(false, path.startsWith("/fingerprint/")),
    );
    for (const [name, value] of Object.entries(securityHeaders))
      assert.equal(response.headers.get(name), value);
  }
}
console.log(
  "Security checks passed: production CSP, external scripts, collector isolation, deployment headers, and WASM memory limit.",
);
