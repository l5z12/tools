// SPDX-License-Identifier: AGPL-3.0-only
export function collectInFrame(
  mode: "fingerprintjs" | "creepjs",
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const frame = document.createElement("iframe");
    frame.src = "/fingerprint/index.html";
    frame.title = "Temporary local fingerprint collector";
    frame.tabIndex = -1;
    frame.setAttribute("aria-hidden", "true");
    frame.style.cssText = `position:fixed;left:-100000px;top:0;width:${window.innerWidth}px;height:${window.innerHeight}px;border:0;pointer-events:none`;
    const nonce = crypto.randomUUID();
    const cleanup = () => {
      clearTimeout(timeout);
      window.removeEventListener("message", receive);
      frame.remove();
    };
    const receive = (event: MessageEvent) => {
      if (
        event.source !== frame.contentWindow ||
        event.origin !== location.origin ||
        event.data?.channel !== "l5z12-fingerprint" ||
        event.data.nonce !== nonce
      )
        return;
      cleanup();
      if (event.data.error) reject(Error(String(event.data.error)));
      else resolve(event.data.result);
    };
    const timeout = setTimeout(() => {
      cleanup();
      reject(
        Error(
          "Fingerprint collection exceeded 60 seconds. Try another profile.",
        ),
      );
    }, 60000);
    window.addEventListener("message", receive);
    frame.onload = () =>
      frame.contentWindow?.postMessage(
        { channel: "l5z12-fingerprint", nonce, mode },
        location.origin,
      );
    frame.onerror = () => {
      cleanup();
      reject(Error("Could not load the local fingerprint collector."));
    };
    document.body.append(frame);
  });
}
