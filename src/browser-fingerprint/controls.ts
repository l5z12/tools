// SPDX-License-Identifier: AGPL-3.0-only
import { t } from "../i18n";

function descriptions(): Record<string, string> {
  return {
    "L5Z12 v1": t("fingerprintL5z12"),
    "FingerprintJS 3.4.2": t("fingerprintJs"),
    "CreepJS (local)": t("fingerprintCreep"),
    "User-Agent Client Hints": t("fingerprintHints"),
  };
}

export function configureFingerprintProfile(container: HTMLElement): void {
  const select = container.querySelector<HTMLSelectElement>(
    '[data-key="profile"]',
  )!;
  const description = document.createElement("p");
  description.setAttribute("role", "status");
  container.append(description);
  const update = () => {
    description.textContent = descriptions()[select.value];
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
