// SPDX-License-Identifier: AGPL-3.0-only
import type { Tool } from "./tool-types";
import { toolSearchText } from "../i18n";

export function matchesTool(
  tool: Tool,
  query: string,
  tags: ReadonlySet<string>,
): boolean {
  if (![...tags].every((tag) => tool.tags?.includes(tag))) return false;
  const tokens = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const text =
    `${toolSearchText(tool)} ${tool.id} ${(tool.tags ?? []).join(" ")} ${(tool.keywords ?? []).join(" ")}`.toLowerCase();
  return tokens.every((token) =>
    token.startsWith("#")
      ? (tool.tags ?? []).includes(token.slice(1))
      : text.includes(token),
  );
}
