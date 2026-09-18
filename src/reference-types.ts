// SPDX-License-Identifier: AGPL-3.0-only
export type ReferenceRow = {
  family: string;
  code: string;
  name: string;
  description: string;
  value?: number;
  end?: number;
  signed?: number;
  source: number;
  details?: Record<string, string>;
};
export type ReferenceSource = {
  title: string;
  url: string;
  sha256: string;
  rows: number;
  updated?: string;
};
export type ReferenceDataset = {
  schema: 1;
  id: string;
  title: string;
  generated: string;
  notice: string;
  sources: ReferenceSource[];
  rows: ReferenceRow[];
  facilities?: Record<string, string[]>;
};
export type ReferencePage = {
  dataset: string;
  title: string;
  generated: string;
  notice: string;
  sources: ReferenceSource[];
  matches: number;
  total: number;
  page: number;
  pageSize: number;
  entries: ReferenceRow[];
  download: string;
};
