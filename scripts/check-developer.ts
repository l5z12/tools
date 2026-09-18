// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import init, { run } from "../public/wasm/l5z12_tools";
import { tools, hashtags } from "../src/lib/catalog";
import { matchesTool } from "../src/lib/search";

await init({
  module_or_path: await readFile("public/wasm/l5z12_tools_bg.wasm"),
});
const result = (id: string, input: string, option = "") =>
  JSON.parse(run(id, input, option));
assert.equal(new Set(tools.map((t) => t.id)).size, tools.length);
assert.ok(
  tools.every(
    (t) => t.tags.length > 0 && t.tags.every((tag) => hashtags.includes(tag)),
  ),
);
const jsonType = tools.find((t) => t.id === "json-typescript")!;
assert.ok(
  matchesTool(
    jsonType,
    "#json typescript",
    new Set(["developer", "converters"]),
  ),
);
assert.ok(!matchesTool(jsonType, "#images", new Set()));
assert.ok(!matchesTool(jsonType, "#json", new Set(["images"])));
assert.ok(matchesTool(jsonType, "TYPEscript JSON", new Set()));
const regex = result(
  "regex-playground",
  "🌍 Ada: 42",
  "(?P<name>\\w+): (?P<score>\\d+)",
);
assert.equal(regex[0].start, 3);
assert.equal(regex[0].groups[1].value, "42");
const valid = result(
  "json-schema",
  '{"a":3}',
  '{"type":"object","properties":{"a":{"type":"integer"}},"required":["a"]}',
);
assert.equal(valid.valid, true);
const invalid = result(
  "json-schema",
  '{"a":"x"}',
  '{"properties":{"a":{"type":"integer"}}}',
);
assert.equal(invalid.valid, false);
assert.equal(invalid.errors[0].path, "/a");
assert.throws(() =>
  run("json-schema", "{}", '{"$ref":"https://example.invalid/schema.json"}'),
);
const diff = result(
  "json-diff",
  '{"a/b":1,"list":[1,2]}',
  '{"a/b":2,"list":[1]}',
);
assert.equal(diff[0].path, "/a~1b");
assert.ok(
  diff.some(
    (c: { path: string; op: string }) =>
      c.path === "/list/1" && c.op === "remove",
  ),
);
const cron = result(
  "cron-explorer",
  "*/15 9-17 * * MON-FRI",
  "2026-09-14T08:00:00+08:00",
);
assert.equal(cron.schedule[0].timestamp, "2026-09-14T09:00:00+08:00");
assert.equal(cron.schedule.length, 10);
const semver = result("semver-test", "1.2.3 2.0.0", "^1.2.0");
assert.equal(semver[0].matches, true);
assert.equal(semver[1].matches, false);
const hex = result("hex-viewer", "AAFB/w==");
assert.equal(hex.rows[0].hex, "00 01 41 FF");
assert.equal(hex.rows[0].ascii, "..A.");
const env = result("env-diff", 'A=1\nB="old"', "A=1\nB=new\nC=3");
assert.equal(env.find((r: { key: string }) => r.key === "B").status, "changed");
assert.throws(() =>
  run("curl-fetch", "curl https://example.com -d @secret", ""),
);
console.log(
  "Developer tool known answers, invalid inputs, local-only schemas, tag combinations, and search passed.",
);
