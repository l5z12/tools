// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { tools } from "../src/lib/catalog";
import { workbenchTools } from "../src/lib/workbench-tools";

const ids = new Set<string>();
const tagCounts = new Map<string, number>();
for (const tool of tools) {
  assert.match(
    tool.id,
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    `Invalid tool ID: ${tool.id}`,
  );
  assert.ok(!ids.has(tool.id), `Duplicate tool ID: ${tool.id}`);
  ids.add(tool.id);
  assert.ok(
    tool.name.trim() && tool.description.trim(),
    `Missing tool text: ${tool.id}`,
  );
  assert.ok(tool.tags?.length, `Missing hashtags: ${tool.id}`);
  assert.equal(
    new Set(tool.tags).size,
    tool.tags!.length,
    `Duplicate hashtags: ${tool.id}`,
  );
  for (const tag of tool.tags!)
    tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
}
for (const [tag, count] of tagCounts) {
  assert.match(tag, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  assert.ok(count >= 2, `Singleton tag #${tag} belongs in search keywords.`);
}
for (const tool of workbenchTools) {
  assert.ok(
    ids.has(tool.id),
    `Workbench is absent from the catalog: ${tool.id}`,
  );
  const keys = new Set<string>();
  for (const field of tool.fields) {
    assert.ok(field.key && field.label.trim(), `Unnamed control: ${tool.id}`);
    assert.ok(
      !keys.has(field.key),
      `Duplicate control: ${tool.id}/${field.key}`,
    );
    keys.add(field.key);
    if (field.choices) {
      assert.ok(field.choices.length, `Empty choices: ${tool.id}/${field.key}`);
      assert.equal(new Set(field.choices).size, field.choices.length);
      assert.ok(
        field.value === undefined || field.choices.includes(field.value),
        `Invalid default: ${tool.id}/${field.key}`,
      );
    }
  }
}
console.log(
  `Catalog contracts passed: ${ids.size} unique tools, controls, defaults, and ${tagCounts.size} shared hashtags.`,
);
