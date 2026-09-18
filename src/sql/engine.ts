// SPDX-License-Identifier: AGPL-3.0-only
import type { BindParams, SqlJsStatic } from "sql.js";
import type { SuiteOptions, SuiteResult } from "../workbench-types";
import { collect, type SqlResultSet } from "./query";
import { inspectDatabase } from "./inspector";
export type { SqlResultSet } from "./query";

function parameters(source: unknown): BindParams {
  const value: unknown = JSON.parse(String(source ?? "{}"));
  if (!value || typeof value !== "object")
    throw Error("Parameters must be a JSON array or object.");
  function scalar(value: unknown): number | string | null {
    if (value === null || typeof value === "string") return value;
    if (typeof value === "boolean") return Number(value);
    if (
      typeof value === "number" &&
      Number.isFinite(value) &&
      (!Number.isInteger(value) || Number.isSafeInteger(value))
    )
      return value;
    throw Error(
      "Parameters must be strings, finite numbers, booleans or null. Pass large integers as strings and CAST them in SQL.",
    );
  }
  return Array.isArray(value)
    ? value.map(scalar)
    : Object.fromEntries(
        Object.entries(value).map(([key, value]) => [key, scalar(value)]),
      );
}

export function runSqlite(
  SQL: SqlJsStatic,
  id: string,
  source: string,
  bytes: Uint8Array | undefined,
  options: SuiteOptions,
): SuiteResult {
  if (
    source.length > 2_000_000 ||
    String(options.setup ?? "").length > 2_000_000
  )
    throw Error("SQL is limited to 2 MiB.");
  if (bytes && bytes.byteLength > 32 * 1024 * 1024)
    throw Error("Choose a database up to 32 MiB.");
  if ((id === "sql-schema" || id === "sql-integrity") && !bytes)
    throw Error("Choose a SQLite database file.");
  if (
    bytes &&
    (bytes.length < 100 ||
      new TextDecoder().decode(bytes.subarray(0, 16)) !== "SQLite format 3\0")
  )
    throw Error("Choose a valid SQLite database, not a SQL script.");
  const db = new SQL.Database(bytes);
  try {
    db.run(
      "PRAGMA trusted_schema=OFF; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=0; PRAGMA hard_heap_limit=67108864;",
    );
    let sets: SqlResultSet[];
    if (id === "sql-schema")
      return inspectDatabase(db, bytes!.byteLength, options);
    const bound = parameters(options.parameters);
    switch (id) {
      case "sql-runner":
        if (!source.trim()) throw Error("Enter SQL to run.");
        sets = collect(db, source, bound);
        break;
      case "sql-explain": {
        collect(db, String(options.setup ?? ""));
        // Preparing through SQLite verifies one statement without executing it.
        const statements: string[] = [];
        for (const statement of db.iterateStatements(source)) {
          statements.push(statement.getSQL());
          if (statements.length > 1)
            throw Error("Explain exactly one SQL statement.");
        }
        if (statements.length !== 1)
          throw Error("Explain exactly one SQL statement.");
        sets = collect(
          db,
          `${options.mode === "Virtual machine" ? "EXPLAIN" : "EXPLAIN QUERY PLAN"} ${statements[0]}`,
          bound,
        );
        break;
      }
      case "sql-integrity":
        sets = collect(
          db,
          `PRAGMA ${options.mode === "Quick" ? "quick_check" : "integrity_check"}; PRAGMA foreign_key_check;`,
        );
        break;
      default:
        throw Error("Unknown SQLite tool.");
    }
    const data = {
      sqliteVersion: db.exec("SELECT sqlite_version()")[0].values[0][0],
      statements: sets.length,
      returnedRows: sets.reduce((count, set) => count + set.values.length, 0),
    };
    const result: SuiteResult = {
      kind: "data",
      data,
      sqlResults: sets,
      text: JSON.stringify({ ...data, results: sets }, null, 2),
    };
    if (id === "sql-runner") {
      // sql.js exports by closing/reopening the database, which would silently
      // discard an open transaction. Probe before exporting and fail clearly.
      try {
        db.run("BEGIN; ROLLBACK;");
      } catch (error) {
        if (String(error).includes("within a transaction"))
          throw Error(
            "Finish the open transaction with COMMIT or ROLLBACK before downloading the database.",
          );
        throw error;
      }
      let database = new Uint8Array(db.export());
      if (!database.length) {
        // A query-only fresh database has no pages yet. Materialize its header
        // so the downloaded file can be reopened by the database inspector.
        db.run("PRAGMA user_version = 0");
        database = new Uint8Array(db.export());
      }
      if (database.byteLength > 64 * 1024 * 1024)
        throw Error("The updated database exceeds 64 MiB.");
      result.mediaFiles = [
        {
          name: "database.sqlite",
          mime: "application/vnd.sqlite3",
          bytes: database,
        },
      ];
    }
    return result;
  } finally {
    db.close();
  }
}
