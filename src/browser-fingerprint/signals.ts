// SPDX-License-Identifier: AGPL-3.0-only
export type Signal = {
  group: string;
  name: string;
  status: "available" | "unavailable" | "blocked or failed" | "excluded";
  value: unknown;
};

export function probe(
  group: string,
  name: string,
  read: () => unknown,
): Signal {
  try {
    const value = read();
    return {
      group,
      name,
      status:
        value === undefined || value === null ? "unavailable" : "available",
      value: value ?? null,
    };
  } catch {
    // Error text varies by browser and is not a fingerprint signal.
    return { group, name, status: "blocked or failed", value: null };
  }
}

export function browserSignals(environment: Window): Signal[] {
  const navigator = environment.navigator as Navigator & {
    deviceMemory?: number;
    globalPrivacyControl?: boolean;
    userAgentData?: {
      brands: { brand: string; version: string }[];
      mobile: boolean;
      platform: string;
    };
  };
  const read = (group: string, name: string, getter: () => unknown) =>
    probe(group, name, getter);
  return [
    read("Browser", "User agent", () => navigator.userAgent),
    read("Browser", "Vendor", () => navigator.vendor),
    read("Browser", "Platform (reported)", () => navigator.platform),
    read("Browser", "User-agent brands", () =>
      navigator.userAgentData?.brands
        .map(({ brand, version }) => ({ brand, version }))
        .sort((a, b) => a.brand.localeCompare(b.brand, "en")),
    ),
    read("Browser", "User-agent mobile", () => navigator.userAgentData?.mobile),
    read(
      "Browser",
      "User-agent platform",
      () => navigator.userAgentData?.platform,
    ),
    read("Browser", "PDF viewer enabled", () => navigator.pdfViewerEnabled),
    read("Locale", "Language", () => navigator.language),
    read("Locale", "Languages (preference order)", () => [
      ...navigator.languages,
    ]),
    read(
      "Locale",
      "Time zone",
      () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    ),
    read(
      "Locale",
      "Date locale",
      () => Intl.DateTimeFormat().resolvedOptions().locale,
    ),
    read(
      "Locale",
      "Calendar",
      () => Intl.DateTimeFormat().resolvedOptions().calendar,
    ),
    read(
      "Locale",
      "Numbering system",
      () => Intl.NumberFormat().resolvedOptions().numberingSystem,
    ),
    read(
      "Hardware",
      "Logical processors (reported)",
      () => navigator.hardwareConcurrency,
    ),
    read(
      "Hardware",
      "Device memory GiB (reported)",
      () => navigator.deviceMemory,
    ),
    read("Hardware", "Maximum touch points", () => navigator.maxTouchPoints),
    read("Display", "Screen width", () => environment.screen.width),
    read("Display", "Screen height", () => environment.screen.height),
    read(
      "Display",
      "Available screen width",
      () => environment.screen.availWidth,
    ),
    read(
      "Display",
      "Available screen height",
      () => environment.screen.availHeight,
    ),
    read("Display", "Color depth", () => environment.screen.colorDepth),
    read("Display", "Pixel depth", () => environment.screen.pixelDepth),
    read("Display", "Device pixel ratio", () => environment.devicePixelRatio),
    read(
      "Preferences",
      "Dark color scheme",
      () => environment.matchMedia("(prefers-color-scheme: dark)").matches,
    ),
    read(
      "Preferences",
      "Reduced motion",
      () => environment.matchMedia("(prefers-reduced-motion: reduce)").matches,
    ),
    read(
      "Preferences",
      "Forced colors",
      () => environment.matchMedia("(forced-colors: active)").matches,
    ),
    read(
      "Preferences",
      "Coarse pointer",
      () => environment.matchMedia("(pointer: coarse)").matches,
    ),
    read(
      "Preferences",
      "Hover supported",
      () => environment.matchMedia("(hover: hover)").matches,
    ),
    read("Privacy", "Do Not Track (reported)", () => navigator.doNotTrack),
    read(
      "Privacy",
      "Global Privacy Control (reported)",
      () => navigator.globalPrivacyControl,
    ),
    read(
      "Privacy",
      "Cookies enabled (reported)",
      () => navigator.cookieEnabled,
    ),
    read("Automation", "WebDriver flag (reported)", () => navigator.webdriver),
  ];
}

/** Sort object keys recursively; preserve array order because it can carry meaning. */
export function canonicalJson(value: unknown): string {
  function normalize(item: unknown): unknown {
    if (Array.isArray(item)) return item.map(normalize);
    if (item !== null && typeof item === "object")
      return Object.fromEntries(
        Object.entries(item)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([key, child]) => [key, normalize(child)]),
      );
    return item;
  }
  return JSON.stringify(normalize(value));
}
