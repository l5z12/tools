// SPDX-License-Identifier: AGPL-3.0-only
import type { Tool } from "./tool-types";

export const siteUrl = "https://tools.l5z12.dev";
export const siteName = "L5Z12 Tools";

export function toolPath(id: string): string {
  return `/${encodeURIComponent(id)}/`;
}

export function pageMetadata(tool?: Tool) {
  return {
    title: tool ? `${tool.name} — ${siteName}` : "Tools — L5Z12",
    description: tool
      ? `${tool.description} Use ${tool.name} in your browser with local processing and no account required.`
      : "Free browser tools for developers, files, images, audio, video, data, and everyday conversions. Search by name or hashtag. Your inputs stay in your browser.",
    canonical: new URL(tool ? toolPath(tool.id) : "/", siteUrl).href,
  };
}
