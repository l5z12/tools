// SPDX-License-Identifier: AGPL-3.0-only
import type { Workbench } from "./tool-types";

export const browserTools: Workbench[] = [
  {
    id: "browser-fingerprint",
    name: "Browser fingerprint",
    group: "Developer",
    description:
      "Compare L5Z12, FingerprintJS, CreepJS and Client Hints formats, with local fingerprints and downloadable reports.",
    tags: ["browser", "privacy", "analysis", "developer", "hashes"],
    keywords: [
      "user agent",
      "GPU",
      "tracking",
      "canvas",
      "WebGL",
      "FingerprintJS",
      "CreepJS",
      "Client Hints",
    ],
    sample: "",
    option: "",
    optionLabel: "",
    inputMode: "none",
    fields: [
      {
        key: "profile",
        label: "Fingerprint format",
        choices: [
          "L5Z12 v1",
          "FingerprintJS 3.4.2",
          "CreepJS (local)",
          "User-Agent Client Hints",
        ],
        value: "L5Z12 v1",
      },
      {
        key: "highEntropy",
        label: "Include high-entropy Client Hints (when available)",
        type: "checkbox",
        value: "false",
      },
      {
        key: "canvas",
        label: "Include canvas rendering",
        type: "checkbox",
        value: "true",
      },
      {
        key: "webgl",
        label: "Include WebGL capabilities and renderer",
        type: "checkbox",
        value: "true",
      },
    ],
    help: "Choose a format, then click Run to inspect this browser locally. Reports are not uploaded or saved automatically. No permission prompts are requested. Browser settings, updates and privacy protections can change or mask signals; fingerprints are not proof of identity. Each format uses its own probes and hash inputs. FingerprintJS briefly sets and deletes a test cookie to check cookie support.",
  },
];
export const browserToolIds = new Set(browserTools.map((tool) => tool.id));
