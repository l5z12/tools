// SPDX-License-Identifier: AGPL-3.0-only
const descriptions: Record<string, string> = {
  "L5Z12 v1":
    "Versioned local signal report with SHA-256. Choose whether to include rendering probes.",
  "FingerprintJS 3.4.2":
    "Pinned FingerprintJS v3 collectors and component format with Rust MurmurHash3. Monitoring is disabled. This is not the commercial identification API.",
  "CreepJS (local)":
    "Pinned CreepJS collectors with stable, loose and fuzzy fingerprints. Uses a temporary dedicated worker; website network extras are excluded. Its IDs can differ from the CreepJS website. Collection may take several seconds.",
  "User-Agent Client Hints":
    "Standard browser-provided hints, where supported. The snapshot SHA-256 is our local digest; the Client Hints specification does not define a fingerprint ID.",
};

export function configureFingerprintProfile(container: HTMLElement): void {
  const select = container.querySelector<HTMLSelectElement>(
    '[data-key="profile"]',
  )!;
  const description = document.createElement("p");
  description.setAttribute("role", "status");
  container.append(description);
  const update = () => {
    description.textContent = descriptions[select.value];
    for (const key of ["canvas", "webgl", "highEntropy"]) {
      const control = container.querySelector<HTMLInputElement>(
        `[data-key="${key}"]`,
      )!;
      control.parentElement!.hidden =
        key === "highEntropy"
          ? select.value !== "User-Agent Client Hints"
          : select.value !== "L5Z12 v1";
    }
  };
  select.addEventListener("change", update);
  update();
}
