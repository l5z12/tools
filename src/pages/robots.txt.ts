// SPDX-License-Identifier: AGPL-3.0-only
import type { APIRoute } from "astro";
import { siteUrl } from "../lib/site";

export const GET: APIRoute = () =>
  new Response(
    `User-agent: *\nAllow: /\nDisallow: /fingerprint/\n\nSitemap: ${siteUrl}/sitemap.xml\n`,
    { headers: { "Content-Type": "text/plain; charset=utf-8" } },
  );
