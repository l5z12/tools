// SPDX-License-Identifier: AGPL-3.0-only
let started = false;
window.addEventListener("message", async (event) => {
  if (started || event.source !== parent || event.origin !== location.origin)
    return;
  const request = event.data;
  if (
    request?.channel !== "l5z12-fingerprint" ||
    typeof request.nonce !== "string"
  )
    return;
  const paths: Record<string, string> = {
    fingerprintjs: "/fingerprint/fingerprintjs.js",
    creepjs: "/fingerprint/creep.js",
  };
  const path = paths[request.mode];
  if (!path) return;
  started = true;
  const reply = (payload: object) =>
    parent.postMessage(
      { channel: request.channel, nonce: request.nonce, ...payload },
      location.origin,
    );
  try {
    const collector = await import(/* @vite-ignore */ path);
    const result = await collector.collect();
    // JSON serialization retains each collector's omission/null conventions.
    reply({ result: JSON.parse(JSON.stringify(result)) });
  } catch (error) {
    reply({ error: error instanceof Error ? error.message : String(error) });
  }
});
