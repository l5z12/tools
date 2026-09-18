// SPDX-License-Identifier: AGPL-3.0-only
import { pageMetadata } from "../lib/site";
import type { Tool } from "../lib/tool-types";

export function updatePageMetadata(tool?: Tool): void {
  const metadata = pageMetadata(tool);
  document.title = metadata.title;
  document.querySelector<HTMLLinkElement>('link[rel="canonical"]')!.href =
    metadata.canonical;
  for (const [selector, value] of [
    ['meta[name="description"]', metadata.description],
    ['meta[property="og:title"]', metadata.title],
    ['meta[property="og:description"]', metadata.description],
    ['meta[property="og:url"]', metadata.canonical],
    ['meta[name="twitter:title"]', metadata.title],
    ['meta[name="twitter:description"]', metadata.description],
  ] as const) {
    document.querySelector<HTMLMetaElement>(selector)!.content = value;
  }
}
