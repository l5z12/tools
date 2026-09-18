// SPDX-License-Identifier: AGPL-3.0-only
import type { Field, Workbench } from "./tool-types";

const dialect: Field = {
  key: "dialect",
  label: "SQL dialect",
  value: "sqlite",
  choices: ["sqlite", "postgres", "mysql", "mssql", "generic"],
};
const insertFields: Field[] = [
  { ...dialect, choices: ["sqlite", "postgres", "mysql", "mssql"] },
  { key: "table", label: "Table name (one identifier)", value: "people" },
];
function tool(
  id: string,
  name: string,
  description: string,
  sample: string,
  fields: Field[] = [],
  extra: Partial<Workbench> = {},
): Workbench {
  return {
    id: `sql-${id}`,
    name,
    description,
    sample,
    fields,
    group: "Developer",
    tags: ["sql", "developer", "data"],
    option: "",
    optionLabel: "",
    ...extra,
  };
}
const setup = `CREATE TABLE people (id INTEGER PRIMARY KEY, name TEXT, score INTEGER);
INSERT INTO people VALUES (1, 'Ada', 95), (2, 'Linus', 88), (3, 'Grace', 97);`;
const runtimeHelp =
  "SQLite loads locally on the first run. Each run starts fresh from the selected database or an empty database; download the result to keep edits. Limits: 32 MiB database, 2 MiB SQL, 30 seconds, 1,000 statements, and 5,000 returned rows. Stop cancels the worker. SQL never connects to a server.";
const databaseFile: Partial<Workbench> = {
  inputMode: "optional-file",
  accept: ".db,.sqlite,.sqlite3,application/vnd.sqlite3",
  help: runtimeHelp,
  tags: ["sql", "developer", "data", "files", "wasm"],
};
export const sqlTools: Workbench[] = [
  tool(
    "runner",
    "SQLite query runner",
    "Run SQL against a local SQLite database, inspect results, and save the updated database.",
    `${setup}\nSELECT * FROM people ORDER BY score DESC;`,
    [
      {
        key: "parameters",
        label: "Bound parameters (JSON array or named object)",
        value: "{}",
        type: "textarea",
      },
    ],
    databaseFile,
  ),
  tool(
    "schema",
    "SQLite .db file inspector",
    "Open .db, .sqlite or .sqlite3 files. Browse tables and views, filter rows, inspect the schema, and export data.",
    "",
    [
      { key: "table", label: "Table or view", choices: [""], value: "" },
      { key: "filter", label: "Find text in any column", value: "" },
      { key: "sort", label: "Sort column", choices: [""], value: "" },
      {
        key: "direction",
        label: "Sort direction",
        choices: ["Ascending", "Descending"],
        value: "Ascending",
      },
      {
        key: "pageSize",
        label: "Rows per page",
        choices: ["25", "100", "500"],
        value: "100",
      },
      { key: "page", label: "Page", type: "number", value: "1" },
      {
        key: "exportScope",
        label: "Export rows",
        choices: ["Current page", "All matching rows"],
        value: "Current page",
      },
    ],
    {
      ...databaseFile,
      inputMode: "file",
      keywords: ["database", "db", "sqlite3", "schema", "browser", "viewer"],
      help: "Choose a SQLite file and run to read its tables. Select a table or view, then run again to browse. Local, read-only inspection; up to 32 MiB and 30 seconds per run. Export the current page or up to 5,000 matching rows (4 MiB). JSON preserves NULL, exact integers and blob bytes; CSV prefixes formula-like text for spreadsheets and uses empty cells for NULL. Text matching is case-insensitive for ASCII. Encrypted databases and separate WAL files are not supported; use a complete SQLite backup.",
    },
  ),
  tool(
    "explain",
    "SQLite query plan",
    "Explain how SQLite scans tables, uses indexes, and executes a query.",
    "SELECT name FROM people WHERE score > 90 ORDER BY score;",
    [
      {
        key: "setup",
        label: "Setup SQL (runs before the query)",
        value: setup,
        type: "textarea",
      },
      {
        key: "parameters",
        label: "Bound parameters (JSON array or named object)",
        value: "{}",
        type: "textarea",
      },
      {
        key: "mode",
        label: "Plan detail",
        value: "Query plan",
        choices: ["Query plan", "Virtual machine"],
      },
    ],
    databaseFile,
  ),
  tool(
    "integrity",
    "SQLite integrity checker",
    "Check database structure and foreign-key violations without modifying the original file.",
    "",
    [
      {
        key: "mode",
        label: "Check",
        value: "Full",
        choices: ["Full", "Quick"],
      },
    ],
    { ...databaseFile, inputMode: "file" },
  ),
  tool(
    "inspect",
    "SQL syntax & AST inspector",
    "Parse SQL in a selected dialect, list statements, and explore the syntax tree.",
    "SELECT p.name, COUNT(*) FROM people p JOIN orders o ON o.person_id = p.id GROUP BY p.name;",
    [dialect],
    {
      help: "Checks syntax, not table existence, types or permissions. The tree uses the selected parser dialect.",
    },
  ),
  tool(
    "normalize",
    "SQL normalizer",
    "Parse and reprint SQL with consistent syntax and one statement per line.",
    "select id, name\nfrom people -- a comment\nwhere id > 2;",
    [dialect],
    {
      tags: ["sql", "developer", "formatting"],
      help: "Removes comments, including optimizer hints. This is normalization within one dialect, not dialect translation.",
    },
  ),
  tool(
    "tokens",
    "SQL token inspector",
    "Inspect SQL tokens, comments, placeholders and their source positions.",
    "SELECT name FROM people WHERE id = :id; -- bound parameter",
    [dialect],
  ),
  tool(
    "json-inserts",
    "JSON → SQL INSERT",
    "Generate quoted INSERT statements from an array of flat JSON objects.",
    '[{"id":1,"name":"Ada","active":true},{"id":2,"name":"O\'Brien","active":false}]',
    insertFields,
    {
      tags: ["sql", "developer", "json", "converters"],
      help: "Missing fields become NULL. Nested objects and arrays are rejected. Use strings for exact decimal values beyond JSON number precision.",
    },
  ),
  tool(
    "csv-inserts",
    "CSV → SQL INSERT",
    "Turn CSV headers and rows into SQL inserts, preserving cell text and leading zeroes.",
    "id,name\n001,Ada\n002,O'Brien",
    [
      ...insertFields,
      {
        key: "delimiter",
        label: "Delimiter",
        value: "Comma",
        choices: ["Comma", "Tab", "Semicolon"],
      },
      { key: "nullToken", label: "NULL marker (empty disables)", value: "\\N" },
    ],
    {
      tags: ["sql", "developer", "csv", "converters"],
      help: "All cells are quoted strings except an exact match for the NULL marker. Empty cells stay empty strings.",
    },
  ),
  tool(
    "in-list",
    "SQL IN-list builder",
    "Convert a JSON array of scalar values into a safely quoted SQL value list.",
    '["Ada", "O\'Brien", "Grace"]',
    [dialect],
    {
      tags: ["sql", "developer", "json", "converters"],
      help: "Generates the parenthesized list only. NULL follows SQL three-valued logic; use IS NULL separately when needed. Empty lists are rejected.",
    },
  ),
];
export const sqlIds = new Set(sqlTools.map((tool) => tool.id));
export const sqlRuntimeIds = new Set([
  "sql-runner",
  "sql-schema",
  "sql-explain",
  "sql-integrity",
]);
