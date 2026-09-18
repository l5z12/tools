// SPDX-License-Identifier: AGPL-3.0-only
import { defineConfig } from "astro/config";
import { contentSecurityPolicy, securityHeaders } from "./src/lib/security.ts";
import { siteUrl } from "./src/lib/site.ts";

function applyHeaders(server, development) {
  server.middlewares.use((request, response, next) => {
    for (const [name, value] of Object.entries(securityHeaders))
      response.setHeader(name, value);
    const pathname = new URL(request.url || "/", "http://localhost").pathname;
    response.setHeader(
      "Content-Security-Policy",
      `${contentSecurityPolicy(development, pathname.startsWith("/fingerprint/"))}; frame-ancestors 'self'`,
    );
    next();
  });
}

export default defineConfig({
  site: siteUrl,
  trailingSlash: "always",
  output: "static",
  // Astro's static preview does not run Vite's configurePreviewServer hook.
  // Document-specific CSP lives in meta tags; this header adds framing protection.
  server: {
    headers: {
      ...securityHeaders,
      "Content-Security-Policy": "frame-ancestors 'self'",
    },
  },
  vite: {
    plugins: [
      {
        name: "local-security-headers",
        configureServer(server) {
          applyHeaders(server, true);
        },
      },
    ],
  },
});
