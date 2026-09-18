// SPDX-License-Identifier: AGPL-3.0-only
import type { Database } from "sql.js";
import type { SuiteOptions, SuiteResult } from "../workbench-types";
import { collect, identifier, type SqlResultSet } from "./query";
import { bypassLimits, overLimit } from "../limits";

export type DatabaseBrowser = {
  tables: { name: string; type: string }[];
  selected: string;
  columns: string[];
  page: number;
  pages: number;
  matchingRows: number;
  totalRows: number;
  exportedRows: number;
  error?: string;
};

function integer(value: unknown, fallback: number, maximum: number): number {
  const number = value === undefined || value === "" ? fallback : Number(value);
  if (!Number.isSafeInteger(number) || number < 1 || number > maximum)
    throw Error(`Enter a whole number between 1 and ${maximum}.`);
  return number;
}

function records(set: SqlResultSet): Record<string, unknown>[] {
  return set.values.map((values) =>
    Object.fromEntries(
      set.columns.map((column, index) => [column, values[index]]),
    ),
  );
}

function csvCell(value: unknown): string {
  let text =
    value === null
      ? ""
      : typeof value === "object"
        ? JSON.stringify(value)
        : String(value);
  // Spreadsheet exports must not turn a database string into an executable formula.
  if (typeof value === "string" && /^[\s]*[=+@-]|^[\t\r\n]/.test(text))
    text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}

function downloads(
  rows: SqlResultSet,
  schema: SqlResultSet,
  suffix: string,
): NonNullable<SuiteResult["mediaFiles"]> {
  const csv =
    [
      rows.columns.map(csvCell).join(","),
      ...rows.values.map((row) => row.map(csvCell).join(",")),
    ].join("\r\n") + "\r\n";
  const definitions = records(schema)
    .filter((row) => typeof row.sql === "string")
    .map((row) => String(row.sql).replace(/;\s*$/, "") + ";")
    .join("\n\n");
  return [
    {
      name: `rows-${suffix}.json`,
      mime: "application/json",
      text: JSON.stringify(
        { columns: rows.columns, values: rows.values },
        null,
        2,
      ),
    },
    { name: `rows-${suffix}.csv`, mime: "text/csv;charset=utf-8", text: csv },
    { name: "schema.sql", mime: "text/plain;charset=utf-8", text: definitions },
  ].map((file) => ({
    name: file.name,
    mime: file.mime,
    bytes: new TextEncoder().encode(file.text),
  }));
}

export function inspectDatabase(
  db: Database,
  fileBytes: number,
  options: SuiteOptions,
): SuiteResult {
  db.run("PRAGMA query_only=ON;");
  const budget = {
    rows: 0,
    size: 0,
    statements: 0,
    bypassLimits: options.bypassLimits === true,
  };
  const query = (sql: string) => collect(db, sql, null, budget)[0];
  const schema = query(
    "SELECT type, name, tbl_name, sql FROM sqlite_schema ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 WHEN 'view' THEN 2 ELSE 3 END, name;",
  );
  schema.title = "Database objects";
  const tableList = records(query("PRAGMA main.table_list;"));
  const tables = tableList
    .filter(
      (row) =>
        row.schema === "main" &&
        row.type !== "shadow" &&
        !String(row.name).startsWith("sqlite_"),
    )
    .map((row) => ({ name: String(row.name), type: String(row.type) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (tables.length > 200)
    throw Error("Inspect databases with up to 200 tables/views.");
  const requested = String(options.table ?? "");
  if (requested && !tables.some((table) => table.name === requested))
    throw Error("The selected table or view does not exist in this database.");
  const selected =
    requested ||
    tables.find((table) => table.type === "table")?.name ||
    tables[0]?.name ||
    "";
  const properties: Record<string, unknown> = { fileBytes };
  for (const name of [
    "page_size",
    "page_count",
    "freelist_count",
    "encoding",
    "user_version",
    "application_id",
    "auto_vacuum",
    "journal_mode",
  ]) {
    properties[name] = query(`PRAGMA ${name};`).values[0]?.[0];
  }
  properties.freePageBytes =
    Number(properties.page_size) * Number(properties.freelist_count);
  const browser: DatabaseBrowser = {
    tables,
    selected,
    columns: [],
    page: 1,
    pages: 1,
    matchingRows: 0,
    totalRows: 0,
    exportedRows: 0,
  };
  const sets: SqlResultSet[] = [];
  let detail: unknown = {};
  let files: SuiteResult["mediaFiles"];
  if (selected) {
    // A broken view or unavailable virtual table should not hide the rest of the schema.
    try {
      const columns = query(`PRAGMA table_xinfo(${identifier(selected)});`);
      const columnRecords = records(columns);
      browser.columns = columnRecords
        .filter((column) => column.hidden !== 1)
        .map((column) => String(column.name));
      if (!browser.columns.length || browser.columns.length > 256)
        throw Error("Browse tables with 1–256 visible columns.");
      const indexes = query(`PRAGMA index_list(${identifier(selected)});`);
      const indexDetails = records(indexes).map((index) => ({
        ...index,
        columns: records(
          query(`PRAGMA index_xinfo(${identifier(String(index.name))});`),
        ),
      }));
      detail = {
        columns: records(columns),
        indexes: indexDetails,
        foreignKeys: records(
          query(`PRAGMA foreign_key_list(${identifier(selected)});`),
        ),
        table: tableList.find((table) => table.name === selected),
      };
      const pageSize = integer(options.pageSize, 100, 500);
      const requestedPage = integer(options.page, 1, 1_000_000);
      const filter = String(options.filter ?? "");
      if (overLimit(filter.length, 4096, options))
        throw Error("Filter text is limited to 4,096 characters.");
      const sort = String(options.sort ?? "");
      if (sort && !browser.columns.includes(sort))
        throw Error("Choose a sort column from the selected table.");
      const primaryKey = columnRecords
        .filter((column) => Number(column.pk) > 0)
        .sort((a, b) => Number(a.pk) - Number(b.pk))
        .map((column) => String(column.name));
      const order = [
        ...new Set([
          ...(sort ? [sort] : []),
          ...(primaryKey.length ? primaryKey : browser.columns),
        ]),
      ];
      const direction = options.direction === "Descending" ? "DESC" : "ASC";
      const orderBy = order
        .map((column) => `${identifier(column)} ${direction}`)
        .join(", ");
      const where = filter
        ? ` WHERE ${browser.columns.map((column) => `(typeof(${identifier(column)}) != 'blob' AND instr(lower(CAST(${identifier(column)} AS TEXT)), lower(:filter)) > 0)`).join(" OR ")}`
        : "";
      const from = ` FROM ${identifier(selected)}`;
      const bound = { ":filter": filter };
      browser.totalRows = Number(
        collect(db, `SELECT count(*)${from};`)[0].values[0][0],
      );
      browser.matchingRows = filter
        ? Number(
            collect(db, `SELECT count(*)${from}${where};`, bound)[0]
              .values[0][0],
          )
        : browser.totalRows;
      browser.pages = Math.max(1, Math.ceil(browser.matchingRows / pageSize));
      browser.page = Math.min(requestedPage, browser.pages);
      const offset = (browser.page - 1) * pageSize;
      const fullExport = options.exportScope === "All matching rows";
      if (fullExport && overLimit(browser.matchingRows, 5000, options))
        throw Error(
          "Full export is limited to 5,000 matching rows. Narrow the filter or export a page.",
        );
      const sql = `SELECT ${browser.columns.map(identifier).join(", ")}${from}${where} ORDER BY ${orderBy} LIMIT :limit OFFSET :offset;`;
      const exported = collect(
        db,
        sql,
        {
          ...bound,
          ":limit": fullExport
            ? bypassLimits(options)
              ? browser.matchingRows
              : 5000
            : pageSize,
          ":offset": fullExport ? 0 : offset,
        },
        budget,
      )[0];
      const preview = {
        ...exported,
        values: fullExport
          ? exported.values.slice(offset, offset + pageSize)
          : exported.values,
        title: `${selected} · page ${browser.page} of ${browser.pages} · ${browser.matchingRows} matching rows`,
      };
      browser.exportedRows = exported.values.length;
      sets.push(preview);
      files = downloads(
        exported,
        schema,
        fullExport ? "all-matching" : `page-${browser.page}`,
      );
    } catch (error) {
      browser.error = error instanceof Error ? error.message : String(error);
    }
  }
  sets.push(schema);
  const data = {
    database: properties,
    selectedTable: selected || null,
    details: detail,
    ...browser,
  };
  return {
    kind: "data",
    data,
    sqlResults: sets,
    sqliteBrowser: browser,
    mediaFiles: files,
    text: JSON.stringify({ ...data, results: sets }, null, 2),
  };
}
