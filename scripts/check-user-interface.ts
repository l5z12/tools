// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { tools } from "../src/lib/catalog";
import { configureDirectory } from "../src/ui/directory";
import { TextDrafts } from "../src/ui/drafts";

const drafts = new TextDrafts();
drafts.save("sql-runner", { input: "SELECT 42", option: "" });
drafts.save("json-format", { input: '{"hello":true}', option: "2" });
assert.equal(drafts.read("sql-runner")?.input, "SELECT 42");
for (let i = 0; i < 9; i++)
  drafts.save(`tool-${i}`, { input: "x", option: "" });
assert.equal(
  drafts.read("sql-runner"),
  undefined,
  "Old text must not accumulate indefinitely.",
);
drafts.save("oversized", { input: "x".repeat(2_000_001), option: "" });
assert.equal(drafts.read("oversized"), undefined);

const window = new Window({ settings: { enableJavaScriptEvaluation: false } });
window.document.write(await Bun.file("dist/index.html").text());
Object.assign(globalThis, { document: window.document });
const selected: string[] = [];
const directory = configureDirectory(tools, (id) => selected.push(id));
const get = (id: string) =>
  window.document.getElementById(id)! as unknown as HTMLElement;
const input = get("search") as unknown as HTMLInputElement;
assert.equal(get("start-page").hidden, false);
assert.equal(get("workspace").hidden, true);
assert.equal(input.value, "");
assert.equal(get("input").textContent, "");
for (const link of get("start-page").querySelectorAll<HTMLAnchorElement>(
  "[data-tool]",
)) {
  assert.ok(tools.some((tool) => tool.id === link.dataset.tool));
}
const press = (key: string) =>
  input.dispatchEvent(
    new window.KeyboardEvent("keydown", {
      key,
      bubbles: true,
    }) as unknown as Event,
  );
const visibleTags = () =>
  [...window.document.querySelectorAll("[data-filter-tag]")].filter(
    (button) => !(button as unknown as HTMLElement).hidden,
  );
assert.equal(visibleTags().length, 12);
get("more-tags").click();
assert.equal(visibleTags().length, 71);
(
  window.document.querySelector(
    '[data-filter-tag="animation"]',
  ) as unknown as HTMLButtonElement
).click();
get("more-tags").click();
assert.ok(
  visibleTags().some(
    (button) => button.getAttribute("data-filter-tag") === "animation",
  ),
  "A selected tag must remain visible when the list collapses.",
);
get("clear-search").click();
input.value = "json-format";
input.dispatchEvent(new window.Event("input") as unknown as Event);
assert.equal(get("match-count").textContent, "1 tool");
press("ArrowDown");
assert.equal(
  window.document.activeElement?.getAttribute("data-tool"),
  "json-format",
);
input.focus();
press("Enter");
assert.deepEqual(selected, ["json-format"]);
assert.equal((get("index") as unknown as HTMLDetailsElement).open, false);
input.value = "there-is-no-such-tool";
input.dispatchEvent(new window.Event("input") as unknown as Event);
assert.equal(get("no-results").hidden, false);
press("Enter");
assert.equal(selected.length, 1);
get("clear-search").click();
assert.equal(get("no-results").hidden, true);
input.focus();
press("Escape");
assert.equal(window.document.activeElement?.id, "start-title");
directory.visit("sql-runner");
directory.visit("json-format");
assert.equal(
  get("recent-tools").querySelector("a")?.getAttribute("href"),
  "/sql-runner/",
);
directory.home();
assert.equal(
  get("recent-tools").querySelector("a")?.getAttribute("href"),
  "/json-format/",
);
assert.equal(
  window.localStorage.length,
  0,
  "Tool usage and drafts must not be persisted.",
);
console.log(
  "User interface passed: compact tags, visible selections, search navigation, empty results, recent tools, and bounded in-memory drafts.",
);
