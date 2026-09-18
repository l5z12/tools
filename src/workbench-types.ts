// SPDX-License-Identifier: AGPL-3.0-only
export type SuiteFile = { name: string; mime: string; base64: string };
export type FingerprintSection = {
  name: string;
  status: string;
  value: unknown;
};
export type SuiteResult = {
  sqliteBrowser?: import("./sql/inspector").DatabaseBrowser;
  sqlResults?: import("./sql/query").SqlResultSet[];
  mediaFiles?: { name: string; mime: string; bytes: Uint8Array<ArrayBuffer> }[];
  fingerprintSections?: FingerprintSection[];
  formatBytes?: string;
  headline?: { label: string; value: string };
  chart?: { title: string; bars: { label: string; value: number }[] };
  kind: string;
  text?: string;
  data?: unknown;
  rows?: Record<string, unknown>[];
  totalRows?: number;
  headers?: string[];
  files?: SuiteFile[];
  colors?: { hex: string; percent: number }[];
  rgba?: string;
  comparison?: { before: string; after: string; heatmap: string };
  reference?: import("./reference-types").ReferencePage;
  bits?: { label: string; high: number; low: number; value: number }[];
};
export type SuiteOptions = Record<string, unknown>;
