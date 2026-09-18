// SPDX-License-Identifier: AGPL-3.0-only
import { pageMetadata } from "../lib/site";
import type { Tool } from "../lib/tool-types";
import { localizedTool, t } from "../i18n";

export function updatePageMetadata(tool?: Tool): void {
  const localized = tool ? localizedTool(tool) : undefined;
  const title = localized
    ? t("toolTitle", { name: localized.name })
    : t("homeTitle");
  const description = localized
    ? t("toolDescription", {
        name: localized.name,
        description: localized.description,
      })
    : t("homeDescription");
  const metadata = pageMetadata(tool);
  document.title = title;
  document.querySelector<HTMLLinkElement>('link[rel="canonical"]')!.href =
    metadata.canonical;
  for (const [selector, value] of [
    ['meta[name="description"]', description],
    ['meta[property="og:title"]', title],
    ['meta[property="og:description"]', description],
    ['meta[property="og:url"]', metadata.canonical],
    ['meta[name="twitter:title"]', title],
    ['meta[name="twitter:description"]', description],
  ] as const) {
    document.querySelector<HTMLMetaElement>(selector)!.content = value;
  }
}
