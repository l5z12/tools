// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { tools } from "../src/lib/catalog";
import { pageMetadata, siteUrl, toolPath } from "../src/lib/site";
import { updatePageMetadata } from "../src/ui/page-metadata";

const window = new Window({ settings: { enableJavaScriptEvaluation: false } });
const document = window.document;
function readHtml(html: string): void {
  document.open();
  document.write(html);
  document.close();
}
function checkMetadata(tool?: (typeof tools)[number]): void {
  const metadata = pageMetadata(tool);
  assert.equal(document.title, metadata.title);
  assert.equal(
    document.querySelector('meta[name="description"]')?.getAttribute("content"),
    metadata.description,
  );
  assert.equal(document.querySelectorAll('link[rel="canonical"]').length, 1);
  assert.equal(
    document.querySelector('link[rel="canonical"]')?.getAttribute("href"),
    metadata.canonical,
  );
  assert.equal(
    document.querySelector('meta[property="og:url"]')?.getAttribute("content"),
    metadata.canonical,
  );
  assert.equal(
    document
      .querySelector('meta[property="og:title"]')
      ?.getAttribute("content"),
    metadata.title,
  );
  assert.equal(
    document
      .querySelector('meta[name="twitter:title"]')
      ?.getAttribute("content"),
    metadata.title,
  );
}

const paths = ["/", ...tools.map((tool) => toolPath(tool.id))];
const sitemap = new window.DOMParser().parseFromString(
  await Bun.file("dist/sitemap.xml").text(),
  "application/xml",
);
assert.deepEqual(
  [...sitemap.querySelectorAll("loc")].map((loc) => loc.textContent).sort(),
  paths.map((path) => new URL(path, siteUrl).href).sort(),
  "Every public page must appear exactly once; assets and the 404 page must not appear.",
);
assert.ok(
  (await Bun.file("dist/robots.txt").text()).includes(
    `Sitemap: ${siteUrl}/sitemap.xml`,
  ),
);

for (const tool of [undefined, ...tools]) {
  const path = tool ? toolPath(tool.id) : "/";
  readHtml(await Bun.file(`dist${path}index.html`).text());
  checkMetadata(tool);
  const headings = [...document.querySelectorAll("h1")].filter(
    (heading) => !heading.closest("[hidden]"),
  );
  assert.equal(headings.length, 1, `${path}: exactly one visible main heading`);
  if (tool) {
    assert.equal(headings[0]!.textContent.trim(), tool.name);
    assert.equal(
      document.getElementById("description")!.textContent.trim(),
      tool.description,
    );
    assert.equal(
      document.getElementById("workspace")!.hasAttribute("hidden"),
      false,
    );
    assert.equal(
      document.getElementById("start-page")!.hasAttribute("hidden"),
      true,
    );
  }
  for (const link of document.querySelectorAll("a[data-tool]"))
    assert.equal(
      link.getAttribute("href"),
      toolPath(link.getAttribute("data-tool")!),
    );
  for (const asset of document.querySelectorAll(
    "script[src], link[rel=stylesheet]",
  ))
    assert.ok(
      (asset.getAttribute("src") ?? asset.getAttribute("href"))?.startsWith(
        "/",
      ),
      "Nested routes need root-relative assets.",
    );
}

// Client navigation must keep sharing metadata in sync with the current page.
Object.assign(globalThis, { document });
updatePageMetadata(tools[0]);
checkMetadata(tools[0]);
updatePageMetadata();
checkMetadata();
readHtml(await Bun.file("dist/404.html").text());
assert.equal(
  document.querySelector('meta[name="robots"]')?.getAttribute("content"),
  "noindex",
);
await window.happyDOM.close();

if (process.env.CLOUDFLARE_TEST_URL) {
  const base = process.env.CLOUDFLARE_TEST_URL;
  for (const path of [
    "/",
    "/json-format/",
    "/sql-runner/",
    "/sitemap.xml",
    "/robots.txt",
  ]) {
    const response = await fetch(new URL(path, base));
    assert.equal(response.status, 200, path);
    if (path === "/json-format/")
      assert.ok((await response.text()).includes("JSON formatter"));
  }
  const redirect = await fetch(new URL("/json-format", base), {
    redirect: "manual",
  });
  assert.ok([301, 307, 308].includes(redirect.status));
  assert.equal(
    new URL(redirect.headers.get("location")!, base).pathname,
    "/json-format/",
  );
  assert.equal((await fetch(new URL("/not-a-real-tool/", base))).status, 404);
}
console.log(
  `Routing and SEO passed: ${paths.length} static pages, canonical metadata, crawlable links, sitemap, robots, and not-found handling.`,
);
