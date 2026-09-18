// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import init, { suite_run } from "../public/wasm/l5z12_tools";
import { everydayTools } from "../src/lib/everyday-tools";
import type { SuiteOptions, SuiteResult } from "../src/workbench-types";

await init({
  module_or_path: await readFile("public/wasm/l5z12_tools_bg.wasm"),
});
function run(
  id: string,
  input = "",
  options: SuiteOptions = {},
  bytes = new Uint8Array(),
): SuiteResult {
  return JSON.parse(
    suite_run(`everyday-${id}`, input, bytes, JSON.stringify(options)),
  );
}
for (const tool of everydayTools) {
  const options: SuiteOptions = { uid: "sample@local", now: 0 };
  for (const field of tool.fields)
    options[field.key] =
      field.type === "checkbox" ? field.value === "true" : field.value;
  assert.ok(
    run(tool.id.replace("everyday-", ""), tool.sample, options).kind,
    tool.id,
  );
}
const recipe = run("recipe", "ingredient,quantity,unit\nSalt,1/2,tsp", {
  original: "4",
  desired: "6",
});
assert.equal(recipe.rows![0].scaled, 0.75);
assert.throws(() => run("recipe", "ingredient,quantity,unit\nSalt,1/0,tsp"));
assert.throws(() =>
  run("recipe", "ingredient,quantity,unit\nSalt,1,tsp", { original: "0" }),
);
const bill = run("bill", "A\nB\nC", { amount: "10.00", tax: "0", tip: "0" });
assert.deepEqual(
  bill.rows!.map((row) => row.amount),
  ["3.34", "3.33", "3.33"],
);
const withTip = run("bill", "A", { amount: "0.05", tax: "0.03", tip: "10" });
assert.equal(withTip.rows![0].amount, "0.09");
for (const amount of ["NaN", "-1", "1.001", "1e6"])
  assert.throws(() => run("bill", "A", { amount }));
assert.equal(
  run("unit-price", "item,price,quantity\nSmall,3,100\nLarge,5,200").rows![0]
    .item,
  "Large",
);
assert.throws(() => run("unit-price", "item,price,quantity\nZero,3,0"));
assert.deepEqual(
  run("print", "", { width: "2", height: "3", unit: "inches", dpi: "300" })
    .data,
  {
    pixelWidth: 600,
    pixelHeight: 900,
    megapixels: 0.54,
    widthInches: 2,
    heightInches: 3,
    dpi: 300,
    uncompressedRgbBytes: "1620000",
  },
);
assert.equal(
  (
    run("reading-time", "one two three", { reading: "60", speaking: "30" })
      .data as { speakingSeconds: number }
  ).speakingSeconds,
  6,
);
const days = run("business-days", "2026-01-01\n2026-01-03", {
  start: "2026-01-01",
  end: "2026-01-07",
}).data as Record<string, number>;
assert.equal(days.businessDays, 4);
assert.equal(days.weekendDays, 2);
assert.equal(days.weekdayHolidays, 1);
assert.equal(
  (
    run("business-days", "", {
      start: "2026-01-01",
      end: "2026-01-01",
      inclusive: false,
    }).data as Record<string, number>
  ).totalDays,
  0,
);
assert.throws(() => run("business-days", "", { start: "2026-02-30" }));
assert.equal(
  (
    run("timesheet", "date,start,end,break_minutes\n2026-01-01,22:00,06:00,30")
      .data as Record<string, number>
  ).totalMinutes,
  450,
);
assert.throws(() =>
  run("timesheet", "date,start,end,break_minutes\n2026-01-01,10:00,11:00,61"),
);
const ranked = run("decision", "option,Price,Comfort\nA,10,0\nB,0,10", {
  weights: "1,3",
}).rows!;
assert.equal(ranked[0].option, "B");
assert.equal(ranked[0].weightedScore, 7.5);
assert.throws(() => run("decision", "option,Price\nA,10", { weights: "0" }));
assert.throws(() => run("decision", "option,Price\nA,11", { weights: "1" }));
const csv = 'name,note\nAda,"a,b"\nLin,"line 1\nline 2"\n';
assert.equal(run("csv-transpose", run("csv-transpose", csv).text!).text, csv);
assert.throws(() => run("csv-transpose", "a,b\nc"));
const uploaded = new TextEncoder().encode("name,value\na,1");
assert.equal(
  run("csv-transpose", "ignored", { fileProvided: true }, uploaded).text,
  "name,a\nvalue,1\n",
);
const checklist = run(
  "checklist",
  "# Work\n- [x] Done\n- [ ] Pending\n```md\n- [ ] Example\n```",
).data as Record<string, number>;
assert.equal(checklist.total, 2);
assert.equal(checklist.percentComplete, 50);
assert.equal(
  run("text-wrap", "one  two three\n\nfour", { width: "10" }).text,
  "one two\nthree\n\nfour",
);
assert.throws(() => run("text-wrap", "a", { width: "10.5" }));
const calendar = run("calendar", "Details; commas, slashes\\\nBEGIN:VEVENT", {
  uid: "test@local",
  title: "🎉".repeat(50),
  location: "Room, A",
  now: 0,
});
const ics = calendar.text!;
for (const line of ics.split("\r\n"))
  assert.ok(Buffer.byteLength(line) <= 75, "Calendar line exceeds 75 octets");
const unfolded = ics.replace(/\r\n /g, "");
assert.ok(unfolded.includes("SUMMARY:" + "🎉".repeat(50)));
assert.ok(unfolded.includes("LOCATION:Room\\, A"));
assert.ok(
  unfolded.includes(
    "DESCRIPTION:Details\\; commas\\, slashes\\\\\\nBEGIN:VEVENT",
  ),
);
assert.equal(ics.match(/^BEGIN:VEVENT$/gm)?.length, 1);
assert.equal(Buffer.from(calendar.files![0].base64, "base64").toString(), ics);
assert.throws(() => run("calendar", "", { uid: "injected\r\nBEGIN:VEVENT" }));
assert.throws(() =>
  run("calendar", "", {
    uid: "test",
    start: "2026-10-01T10:00",
    end: "2026-10-01T09:00",
  }),
);
console.log(
  "Everyday tools passed: 12 samples, cent-exact splits, fractions, dates, overnight shifts, rankings, CSV roundtrip, checklist parsing, and UTF-8 calendar escaping/folding.",
);
