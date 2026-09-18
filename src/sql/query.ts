// SPDX-License-Identifier: AGPL-3.0-only
import type { BindParams, Database, Statement } from "sql.js";
import { overLimit } from "../limits";

export type SqlResultSet = {
  title?: string;
  statement: string;
  columns: string[];
  values: unknown[][];
};
type ExactStatement = Statement & {
  get(
    params: null,
    config: { useBigInt: true },
  ): (number | string | bigint | Uint8Array | null)[];
};

function cell(value: ReturnType<ExactStatement["get"]>[number]): unknown {
  if (typeof value === "bigint")
    return value >= BigInt(Number.MIN_SAFE_INTEGER) &&
      value <= BigInt(Number.MAX_SAFE_INTEGER)
      ? Number(value)
      : { type: "integer", value: String(value) };
  if (value instanceof Uint8Array)
    return {
      type: "blob",
      hex: Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join(
        "",
      ),
    };
  if (typeof value === "number" && !Number.isFinite(value))
    return { type: "real", value: String(value) };
  return value;
}

type CollectBudget = {
  rows: number;
  size: number;
  statements: number;
  bypassLimits?: boolean;
};

/** Iterate to preserve duplicate column names and cap work without materializing an unbounded result. */
export function collect(
  db: Database,
  sql: string,
  params: BindParams = null,
  budget: CollectBudget = { rows: 0, size: 0, statements: 0 },
): SqlResultSet[] {
  const sets: SqlResultSet[] = [];
  const limits = { bypassLimits: budget.bypassLimits };
  for (const statement of db.iterateStatements(sql)) {
    if (overLimit(++budget.statements, 1000, limits))
      throw Error("SQL exceeds 1,000 statements.");
    statement.bind(params);
    const columns = statement.getColumnNames();
    const values: unknown[][] = [];
    while (statement.step()) {
      if (overLimit(++budget.rows, 5000, limits))
        throw Error(
          "Results exceed 5,000 rows. Add a LIMIT or narrow the query.",
        );
      const row = (statement as ExactStatement)
        .get(null, { useBigInt: true })
        .map(cell);
      budget.size += JSON.stringify(row).length;
      if (overLimit(budget.size, 4 * 1024 * 1024, limits))
        throw Error("Results exceed 4 MiB. Select fewer or smaller values.");
      values.push(row);
    }
    sets.push({ statement: statement.getSQL(), columns, values });
  }
  return sets;
}

export function identifier(name: string): string {
  return '"' + name.replaceAll('"', '""') + '"';
}
