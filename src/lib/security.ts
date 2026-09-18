// SPDX-License-Identifier: AGPL-3.0-only
export const securityHeaders: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "SAMEORIGIN",
  "Permissions-Policy":
    "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), hid=()",
};

export function contentSecurityPolicy(
  development = false,
  collector = false,
): string {
  return [
    "default-src 'none'",
    `script-src 'self' 'wasm-unsafe-eval'${collector ? " 'unsafe-eval'" : ""}`,
    "script-src-attr 'none'",
    // Tools set styles for colors, comparisons, charts, and isolated rendering probes.
    "style-src 'self' 'unsafe-inline'",
    `connect-src 'self'${development ? " ws://127.0.0.1:* ws://localhost:*" : ""}`,
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "media-src 'self' data: blob:",
    "worker-src 'self' blob:",
    "frame-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
}
