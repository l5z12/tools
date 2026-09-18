// SPDX-License-Identifier: AGPL-3.0-only
/** Shared browser byte parsing for output representations and Web Crypto input. */
export function decodeHex(text: string): Uint8Array<ArrayBuffer> {
  const withoutPrefixes = text.replace(
    /0x|\\x/gi,
    (prefix: string, offset: number) => {
      if (!/^[\da-f]{2}/i.test(text.slice(offset + prefix.length))) {
        throw Error(
          "Every hex prefix must be followed by a complete byte group.",
        );
      }
      return " ";
    },
  );
  const groups = withoutPrefixes.split(/[\s,:-]+/).filter(Boolean);
  if (!groups.length && text.trim())
    throw Error("Enter hex bytes, not only separators.");
  for (const group of groups) {
    if (!/^(?:[\da-f]{2})+$/i.test(group))
      throw Error("Hex groups must contain complete bytes.");
  }
  return Uint8Array.from(groups.join("").match(/../g) ?? [], (pair) =>
    parseInt(pair, 16),
  );
}

export function decodeBase64(text: string): Uint8Array<ArrayBuffer> {
  const standard = text
    .replace(/\s/g, "")
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  return Uint8Array.from(atob(standard), (character) =>
    character.charCodeAt(0),
  );
}
