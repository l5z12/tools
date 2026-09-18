// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { tools } from "../src/lib/catalog";
import { workbenchTools } from "../src/lib/workbench-tools";
import {
  LANGUAGE_BROWSER,
  LANGUAGE_CHINESE,
  LANGUAGE_ENGLISH,
  isChineseLanguageTag,
  localeFromNavigator,
  parseLanguagePreference,
  resolveLocale,
  t,
  toolsZh,
} from "../src/i18n";
import { matchesTool } from "../src/lib/search";

assert.equal(parseLanguagePreference(null), LANGUAGE_BROWSER);
assert.equal(parseLanguagePreference("0"), LANGUAGE_BROWSER);
assert.equal(parseLanguagePreference("1"), LANGUAGE_ENGLISH);
assert.equal(parseLanguagePreference("2"), LANGUAGE_CHINESE);
assert.equal(parseLanguagePreference("9"), LANGUAGE_BROWSER);

assert.equal(isChineseLanguageTag("zh"), true);
assert.equal(isChineseLanguageTag("zh-CN"), true);
assert.equal(isChineseLanguageTag("zh-TW"), true);
assert.equal(isChineseLanguageTag("zh-Hans-CN"), true);
assert.equal(isChineseLanguageTag("en"), false);
assert.equal(isChineseLanguageTag("en-US"), false);

assert.equal(localeFromNavigator({ language: "en-US" }), "en");
assert.equal(
  localeFromNavigator({ languages: ["fr-FR", "zh-CN"], language: "fr-FR" }),
  "zh",
);
assert.equal(resolveLocale(LANGUAGE_BROWSER, { language: "zh-CN" }), "zh");
assert.equal(resolveLocale(LANGUAGE_ENGLISH, { language: "zh-CN" }), "en");
assert.equal(resolveLocale(LANGUAGE_CHINESE, { language: "en-US" }), "zh");

assert.equal(t("runTool"), "Run tool");
for (const tool of tools) {
  const zh = toolsZh[tool.id];
  assert.ok(zh?.name.trim(), `Missing Chinese name: ${tool.id}`);
  assert.ok(zh.description.trim(), `Missing Chinese description: ${tool.id}`);
  if (tool.optionLabel)
    assert.ok(
      zh.optionLabel?.trim(),
      `Missing Chinese option label: ${tool.id}`,
    );
}
for (const tool of workbenchTools) {
  const zh = toolsZh[tool.id];
  assert.ok(zh, `Missing Chinese workbench: ${tool.id}`);
  if (tool.help) assert.ok(zh.help?.trim(), `Missing Chinese help: ${tool.id}`);
  for (const field of tool.fields)
    assert.ok(
      zh.fields?.[field.key]?.trim(),
      `Missing Chinese field ${tool.id}/${field.key}`,
    );
}

const json = tools.find((tool) => tool.id === "json-format")!;
assert.ok(toolsZh[json.id], "json-format must have a Chinese catalog entry.");
assert.ok(matchesTool(json, "json-format", new Set()));
assert.ok(matchesTool(json, toolsZh["json-format"]!.name, new Set()));
assert.ok(matchesTool(json, "#json", new Set()));
assert.equal(
  json.tags?.includes("json"),
  true,
  "Hashtags stay English catalog tokens.",
);

console.log(
  `i18n passed: preference 0/1/2, browser detection, ${tools.length} Chinese tool names, workbench labels, and English hashtags.`,
);
