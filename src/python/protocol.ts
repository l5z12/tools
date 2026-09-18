// SPDX-License-Identifier: AGPL-3.0-only
import type { SuiteOptions, SuiteResult } from "../workbench-types";
export const PYTHON_TEXT_LIMIT = 65536;
export const PYTHON_SOURCE_LIMIT = 1024 * 1024;

export type PythonInputReply = {
  line: string;
  eof: boolean;
  interrupt: boolean;
};
export type PythonRequest = {
  code: string;
  stdin: string;
  interactive?: boolean;
  repl?: boolean;
  columns?: number;
  rows?: number;
  operation?: string;
  options?: SuiteOptions;
};
export type PythonCommand =
  | { type: "start"; request: PythonRequest }
  | { type: "input"; reply: PythonInputReply }
  | { type: "resize"; columns: number; rows: number };
export type PythonReport = { text: string; failed: boolean; elapsed: number };
export type PythonMessage =
  | { type: "running" }
  | { type: "input-needed"; kind: "repl" | "stdin" }
  | { type: "output"; text: string }
  | { type: "complete"; report: PythonReport }
  | { type: "tool-result"; result: SuiteResult }
  | { type: "error"; message: string };
