// SPDX-License-Identifier: AGPL-3.0-only
export type FingerprintComponent = {
  value?: unknown;
  error?: unknown;
  duration: number;
};

/** Exact FingerprintJS 3.4.2 serialization, including escaping and error sentinels. */
export function fingerprintjsInput(
  components: Record<string, FingerprintComponent>,
): string {
  return Object.keys(components)
    .sort()
    .map((key) => {
      const component = components[key];
      const value = component.error ? "error" : JSON.stringify(component.value);
      return `${key.replace(/([:|\\])/g, "\\$1")}:${value}`;
    })
    .join("|");
}
