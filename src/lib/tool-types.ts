// SPDX-License-Identifier: AGPL-3.0-only
export interface Tool {
  keywords?: string[];
  tags?: string[];
  group: string;
  id: string;
  name: string;
  description: string;
  sample: string;
  option: string;
  optionLabel: string;
}
export type Field = {
  key: string;
  label: string;
  value?: string;
  choices?: string[];
  type?: "textarea" | "number" | "checkbox" | "password";
};
export type Workbench = Tool & {
  inputMode?: "file" | "images" | "optional-file" | "none";
  multiple?: boolean;
  accept?: string;
  fields: Field[];
  help?: string;
};
