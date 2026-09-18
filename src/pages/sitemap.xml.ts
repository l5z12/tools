// SPDX-License-Identifier: AGPL-3.0-only
import type { APIRoute } from "astro";
import { tools } from "../lib/catalog";
import { siteUrl, toolPath } from "../lib/site";

export const GET: APIRoute = () => {
  const paths = ["/", ...tools.map((tool) => toolPath(tool.id))];
  const urls = paths.map(
    (path) => `<url><loc>${new URL(path, siteUrl).href}</loc></url>`,
  );
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`,
    { headers: { "Content-Type": "application/xml; charset=utf-8" } },
  );
};
