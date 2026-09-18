// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import initSqlJs from "sql.js";
import init, { suite_run } from "../public/wasm/l5z12_tools";
import { runSqlite } from "../src/sql/engine";
import { sqlTools, sqlRuntimeIds } from "../src/lib/sql-tools";
import { tools, hashtags } from "../src/lib/catalog";
import { matchesTool } from "../src/lib/search";
import { renderSqlResults } from "../src/sql/view";
import {
  configureDatabaseControls,
  updateDatabaseControls,
} from "../src/sql/controls";
import { inspectDatabase } from "../src/sql/inspector";
import { Window } from "happy-dom";
import type { SuiteOptions, SuiteResult } from "../src/workbench-types";

await init({
  module_or_path: await Bun.file(
    "public/wasm/l5z12_tools_bg.wasm",
  ).arrayBuffer(),
});
const SQL = await initSqlJs({
  wasmBinary: await Bun.file("public/sql/sql-wasm.wasm").arrayBuffer(),
});
const core = (
  id: string,
  text: string,
  options: SuiteOptions = {},
): SuiteResult =>
  JSON.parse(suite_run(id, text, new Uint8Array(), JSON.stringify(options)));
const run = (source: string, options: SuiteOptions = {}, bytes?: Uint8Array) =>
  runSqlite(SQL, "sql-runner", source, bytes, options);
const values = (source: string) => run(source).sqlResults!.at(-1)!.values;

const emptyDatabase = run("SELECT 42 AS answer").mediaFiles![0].bytes;
assert.ok(
  emptyDatabase.length >= 512,
  "Query-only downloads must be real SQLite files.",
);
assert.equal(
  new TextDecoder().decode(emptyDatabase.subarray(0, 16)),
  "SQLite format 3\0",
);
assert.deepEqual(run("SELECT 42", {}, emptyDatabase).sqlResults![0].values, [
  [42],
]);

for (const tool of sqlTools.filter((tool) => !sqlRuntimeIds.has(tool.id))) {
  const options = Object.fromEntries(
    tool.fields.map((field) => [field.key, field.value]),
  );
  assert.ok(core(tool.id, tool.sample, options).text, tool.id);
}
for (const dialect of ["sqlite", "postgres", "mysql", "mssql", "generic"]) {
  assert.equal(
    core("sql-inspect", "SELECT 1; SELECT 'a;b';", { dialect }).rows?.length,
    2,
  );
}
assert.throws(() => core("sql-inspect", "SELECT FROM"));
assert.throws(() => core("sql-inspect", "-- just a comment"));
assert.throws(() => core("sql-inspect", "SELECT 1", { dialect: "unknown" }));
assert.equal(
  core("sql-normalize", "select 1 -- comment\n;select 'a;b';").text,
  "SELECT 1;\nSELECT 'a;b';",
);
assert.ok(
  core("sql-tokens", "SELECT\n:id;").rows?.some((row) => row.line === 2),
);

const rows = [
  { id: 1, name: "O'Brien", active: true, note: null },
  { id: 2, name: "line\n🌍", active: false },
];
const inserts = core("sql-json-inserts", JSON.stringify(rows)).text!;
assert.deepEqual(
  values(
    `CREATE TABLE people(id, name, active, note); ${inserts} SELECT id, name, active, note FROM people;`,
  ),
  [
    [1, "O'Brien", 1, null],
    [2, "line\n🌍", 0, null],
  ],
);
assert.deepEqual(
  values(
    `CREATE TABLE people(id, name); ${core("sql-csv-inserts", 'id,name\n001,"O\'Brien"\n002,\\N').text} SELECT * FROM people;`,
  ),
  [
    ["001", "O'Brien"],
    ["002", null],
  ],
);
assert.equal(
  core("sql-in-list", '["O\'Brien",null,42]').text,
  "('O''Brien', NULL, 42)",
);
assert.throws(() => core("sql-in-list", "[]"));
assert.throws(() => core("sql-in-list", '[{"bad":1}]'));
assert.throws(() => core("sql-json-inserts", '[{"x":[]}]'));
assert.throws(
  () =>
    core(
      "sql-json-inserts",
      JSON.stringify(
        Array.from({ length: 257 }, (_, index) => ({
          [`field${index}`]: index,
        })),
      ),
    ),
  /256/,
);
const postgresInsert = core(
  "sql-json-inserts",
  '[{"active":true,"name":"a\\\\b"}]',
  { dialect: "postgres" },
).text!;
assert.ok(
  postgresInsert.includes("TRUE") && postgresInsert.includes("E'a\\\\b'"),
);
assert.ok(
  core("sql-inspect", postgresInsert, { dialect: "postgres" }).rows?.length,
);
assert.throws(() => core("sql-csv-inserts", "a,a\n1,2"));
assert.throws(() => core("sql-csv-inserts", "a,b\n1"));
assert.throws(() => core("sql-json-inserts", '[{"x":"\\u0000"}]'));
assert.ok(
  core("sql-json-inserts", '[{"x":"\\\\🌍"}]', {
    dialect: "mysql",
  }).text?.includes("CONVERT(X'"),
);
assert.ok(
  core("sql-json-inserts", '[{"x":"🌍"}]', {
    dialect: "mssql",
    table: "a]b",
  }).text?.includes("[a]]b]"),
);
const injection = 'people"; DROP TABLE people;--';
assert.ok(
  core("sql-json-inserts", '[{"x":1}]', { table: injection }).text?.includes(
    '"people""; DROP TABLE people;--"',
  ),
);

const result = run(
  "CREATE TABLE people(id INTEGER PRIMARY KEY, name TEXT); INSERT INTO people VALUES (1, 'Ada'); SELECT id, name FROM people;",
);
assert.deepEqual(result.sqlResults!.at(-1)!.values, [[1, "Ada"]]);
const database = result.mediaFiles![0].bytes;
assert.throws(
  () => run("BEGIN; CREATE TABLE t(x); INSERT INTO t VALUES(1);"),
  /COMMIT or ROLLBACK/,
);
assert.equal(
  run(
    "BEGIN; CREATE TABLE t(x); INSERT INTO t VALUES(1); COMMIT; SELECT * FROM t;",
  ).sqlResults!.at(-1)!.values[0][0],
  1,
);
assert.deepEqual(
  run("SELECT * FROM people;", {}, database).sqlResults![0].values,
  [[1, "Ada"]],
);
assert.deepEqual(values("SELECT 9007199254740993, x'00ff', NULL;"), [
  [
    { type: "integer", value: "9007199254740993" },
    { type: "blob", hex: "00ff" },
    null,
  ],
]);
const duplicate = run(
  "SELECT 1 AS n, 2 AS n; SELECT '<img src=x onerror=alert(1)>';",
);
assert.deepEqual(duplicate.sqlResults![0].columns, ["n", "n"]);
assert.deepEqual(duplicate.sqlResults![0].values, [[1, 2]]);
assert.deepEqual(
  run("SELECT :value;", { parameters: '{":value":"bound"}' }).sqlResults![0]
    .values,
  [["bound"]],
);
assert.deepEqual(
  run("SELECT ? + ?;", { parameters: "[20,22]" }).sqlResults![0].values,
  [[42]],
);
assert.throws(() => run("SELECT ?", { parameters: "[9007199254740993]" }));
assert.throws(() => run("SELECT ?", { parameters: "[[1]]" }));
assert.throws(() => run("SELECT FROM;"));
assert.throws(() => run("SELECT 1", {}, new Uint8Array(128)));
assert.throws(
  () =>
    run(
      "WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<5001) SELECT * FROM n;",
    ),
  /5,000/,
);
assert.throws(() => run("SELECT 1;".repeat(1001)), /1,000/);

const schema = runSqlite(SQL, "sql-schema", "", database, {});
assert.ok(
  schema
    .sqlResults!.find((set) => set.title === "Database objects")!
    .values.some((row) => row[1] === "people"),
);
assert.ok(schema.text?.includes("foreignKeys"));
assert.deepEqual(
  runSqlite(SQL, "sql-integrity", "", database, {}).sqlResults![0].values,
  [["ok"]],
);
assert.throws(() => runSqlite(SQL, "sql-schema", "", undefined, {}));
const plan = runSqlite(
  SQL,
  "sql-explain",
  "SELECT name FROM people WHERE id=1",
  database,
  {},
);
assert.ok(
  plan.sqlResults![0].values.some((row) =>
    String(row).includes("INTEGER PRIMARY KEY"),
  ),
);
assert.throws(
  () => runSqlite(SQL, "sql-explain", "SELECT 1; SELECT 2", undefined, {}),
  /exactly one/,
);
assert.ok(
  runSqlite(SQL, "sql-explain", "SELECT 1", undefined, {
    mode: "Virtual machine",
  }).sqlResults![0].columns.includes("opcode"),
);

const broken = new SQL.Database();
broken.run(
  "CREATE TABLE parent(id PRIMARY KEY); CREATE TABLE child(id REFERENCES parent(id)); INSERT INTO child VALUES(42);",
);
const brokenBytes = broken.export();
broken.close();
assert.equal(
  runSqlite(SQL, "sql-integrity", "", brokenBytes, {}).sqlResults![1].values
    .length,
  1,
);

const window = new Window();
Object.assign(globalThis, { document: window.document, Event: window.Event });
const fixture = new SQL.Database();
fixture.run(`
  PRAGMA user_version=12;
  PRAGMA application_id=42;
  CREATE TABLE people(id INTEGER PRIMARY KEY, name TEXT, team TEXT, initials TEXT GENERATED ALWAYS AS (substr(name,1,1)) VIRTUAL);
  WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<63)
  INSERT INTO people(id,name,team) SELECT x, 'Person ' || x, CASE WHEN x%2=0 THEN 'Blue' ELSE 'Red' END FROM n;
  UPDATE people SET name='O''Brien %_' WHERE id=2;
  CREATE INDEX team_index ON people(team, name DESC) WHERE team='Blue';
  CREATE TABLE payloads(id INTEGER PRIMARY KEY, text_value TEXT, number_value INTEGER, bytes BLOB, empty_value);
  INSERT INTO payloads VALUES(1, '=2+2', 9007199254740993, x'00ff', NULL);
  CREATE VIEW blue_people AS SELECT id,name FROM people WHERE team='Blue';
  CREATE VIEW broken_view AS SELECT * FROM missing_table;
  CREATE TRIGGER keep_names AFTER INSERT ON people BEGIN UPDATE people SET name=coalesce(name,'Anonymous') WHERE id=new.id; END;
  CREATE TABLE pairs(a TEXT,b INTEGER,PRIMARY KEY(a,b)) WITHOUT ROWID;
  INSERT INTO pairs VALUES('b',2),('a',3),('a',1);
`);
const inspectorBytes = new Uint8Array(fixture.export());
fixture.close();
const originalBytes = inspectorBytes.slice();
const inspect = (options: SuiteOptions = {}) =>
  runSqlite(SQL, "sql-schema", "", inspectorBytes, {
    table: "people",
    ...options,
  });
const firstPage = inspect({ pageSize: "25" });
assert.equal(firstPage.sqliteBrowser?.pages, 3);
assert.equal(firstPage.sqliteBrowser?.totalRows, 63);
assert.equal(firstPage.sqlResults![0].values.length, 25);
assert.equal(firstPage.sqlResults![0].values[0][0], 1);
assert.equal(
  inspect({ page: 3, pageSize: 25 }).sqlResults![0].values.length,
  13,
);
assert.equal(inspect({ page: 999, pageSize: 25 }).sqliteBrowser?.page, 3);
assert.equal(inspect({ filter: "blue" }).sqliteBrowser?.matchingRows, 31);
assert.equal(
  inspect({ filter: "%_" }).sqlResults![0].values[0][1],
  "O'Brien %_",
);
assert.equal(
  inspect({ sort: "id", direction: "Descending" }).sqlResults![0].values[0][0],
  63,
);
assert.deepEqual(inspect({ table: "pairs" }).sqlResults![0].values, [
  ["a", 1],
  ["a", 3],
  ["b", 2],
]);
assert.equal(inspect({ table: "blue_people" }).sqliteBrowser?.totalRows, 31);
assert.ok(
  inspect({ table: "broken_view" }).sqliteBrowser?.error?.includes(
    "missing_table",
  ),
);
assert.throws(
  () => inspect({ table: 'people"; DROP TABLE people;--' }),
  /does not exist/,
);
assert.ok(
  inspect({ sort: "missing" }).sqliteBrowser?.error?.includes("sort column"),
);
assert.ok(
  inspect({ pageSize: 1000 }).sqliteBrowser?.error?.includes("whole number"),
);
assert.ok(
  firstPage.text?.includes("team_index") && firstPage.text.includes("initials"),
);
assert.equal(
  (firstPage.data as { database: { user_version: number } }).database
    .user_version,
  12,
);
const full = inspect({
  filter: "Blue",
  exportScope: "All matching rows",
  pageSize: 25,
  page: 2,
});
assert.equal(full.sqlResults![0].values.length, 6);
assert.equal(full.sqliteBrowser?.exportedRows, 31);
const saved = JSON.parse(new TextDecoder().decode(full.mediaFiles![0].bytes));
assert.equal(saved.values.length, 31);
assert.ok(
  new TextDecoder()
    .decode(full.mediaFiles![2].bytes)
    .includes("CREATE TRIGGER"),
);
const payloads = inspect({ table: "payloads" });
const payloadJson = JSON.parse(
  new TextDecoder().decode(payloads.mediaFiles![0].bytes),
);
assert.deepEqual(payloadJson.values[0].slice(1), [
  "=2+2",
  { type: "integer", value: "9007199254740993" },
  { type: "blob", hex: "00ff" },
  null,
]);
assert.ok(
  new TextDecoder().decode(payloads.mediaFiles![1].bytes).includes("'=2+2"),
);
assert.deepEqual(inspectorBytes, originalBytes);
const readOnly = new SQL.Database(inspectorBytes);
inspectDatabase(readOnly, inspectorBytes.byteLength, { table: "people" });
assert.throws(() => readOnly.run("DELETE FROM people"), /readonly/);
readOnly.close();
await Bun.write(".astro/sql-inspector-test.db", inspectorBytes);

const controls = document.createElement("div");
const inspectorTool = sqlTools.find((tool) => tool.id === "sql-schema")!;
const picker = document.createElement("input");
picker.type = "file";
picker.id = "suite-file";
controls.append(picker);
for (const field of inspectorTool.fields) {
  const input = document.createElement(field.choices ? "select" : "input");
  input.id = `suite-${field.key}`;
  input.dataset.key = field.key;
  controls.append(input);
}
let pageRuns = 0;
configureDatabaseControls(controls, () => pageRuns++);
updateDatabaseControls(controls, firstPage.sqliteBrowser!);
assert.equal(
  controls.querySelector<HTMLSelectElement>("#suite-table")!.value,
  "people",
);
controls.querySelector<HTMLButtonElement>('[data-sqlite-page="1"]')!.click();
assert.equal(pageRuns, 1);
assert.equal(
  controls.querySelector<HTMLInputElement>("#suite-page")!.value,
  "2",
);
picker.dispatchEvent(new Event("change"));
assert.equal(
  controls.querySelector<HTMLSelectElement>("#suite-table")!.value,
  "",
);
assert.equal(
  controls.querySelector<HTMLInputElement>("#suite-page")!.value,
  "1",
);
const view = document.createElement("div");
renderSqlResults(view, duplicate.sqlResults!);
assert.equal(view.querySelectorAll("table").length, 2);
assert.equal(view.querySelectorAll("th").length, 3);
assert.equal(view.querySelectorAll("img").length, 0);
assert.ok(view.textContent?.includes("<img"));
assert.ok(view.querySelector(".code-analysis-table"));

for (const id of ["unix-to-date", "date-to-unix"]) {
  const tool = tools.find((tool) => tool.id === id)!;
  assert.ok(tool.tags.includes("time"));
  assert.ok(matchesTool(tool, "#time", new Set()));
}
for (const tag of hashtags)
  assert.ok(tools.filter((tool) => tool.tags.includes(tag)).length >= 2, tag);
assert.ok(!hashtags.includes("formatters") && hashtags.includes("formatting"));
assert.ok(
  matchesTool(
    tools.find((tool) => tool.id === "cpp-cmake-cache")!,
    "cmake",
    new Set(),
  ),
);
console.log(
  `SQL checks passed: Rust parsing/converters, real SQLite execution/import/export/plans/integrity, exact values, limits, safe tables, and grouped tags. ${tools.length} tools.`,
);
