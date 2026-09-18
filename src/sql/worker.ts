// SPDX-License-Identifier: AGPL-3.0-only
import initSqlJs from "sql.js";
import { runSqlite } from "./engine";
import type { SuiteOptions } from "../workbench-types";

self.onmessage = async ({
  data,
}: MessageEvent<{
  id: string;
  source: string;
  bytes?: Uint8Array;
  options: SuiteOptions;
}>) => {
  try {
    self.postMessage({ type: "status", text: "Loading SQLite…" });
    const response = await fetch(
      new URL("/sql/sql-wasm.wasm", import.meta.url),
    );
    if (!response.ok)
      throw Error(`Could not load SQLite (${response.status}).`);
    const SQL = await initSqlJs({ wasmBinary: await response.arrayBuffer() });
    self.postMessage({ type: "status", text: "Running SQLite…" });
    const result = runSqlite(
      SQL,
      data.id,
      data.source,
      data.bytes,
      data.options,
    );
    self.postMessage(
      { type: "result", result },
      result.mediaFiles?.map((file) => file.bytes.buffer) ?? [],
    );
  } catch (error) {
    self.postMessage({
      type: "error",
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
