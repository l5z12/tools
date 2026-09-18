// SPDX-License-Identifier: AGPL-3.0-only
import type { Tool, Workbench } from "../lib/tool-types";
import { currentLocale } from "./locale";
import toolsZhJson from "./tools-zh.json";

export type ToolTranslation = {
  name: string;
  description: string;
  optionLabel?: string;
  help?: string;
  fields?: Record<string, string>;
};

export const toolsZh = toolsZhJson as Record<string, ToolTranslation>;

export function localizedTool<T extends Tool>(tool: T): T {
  if (currentLocale() !== "zh") return tool;
  const zh = toolsZh[tool.id];
  if (!zh) return tool;
  return {
    ...tool,
    name: zh.name,
    description: zh.description,
    optionLabel: zh.optionLabel ?? tool.optionLabel,
  };
}

export function localizedWorkbench(tool: Workbench): Workbench {
  const base = localizedTool(tool);
  if (currentLocale() !== "zh") return base;
  const zh = toolsZh[tool.id];
  if (!zh) return base;
  return {
    ...base,
    help: zh.help ?? tool.help,
    fields: tool.fields.map((field) => ({
      ...field,
      label: zh.fields?.[field.key] ?? field.label,
    })),
  };
}

export function toolSearchText(tool: Tool): string {
  const zh = toolsZh[tool.id];
  return [tool.name, tool.description, zh?.name, zh?.description]
    .filter(Boolean)
    .join(" ");
}
