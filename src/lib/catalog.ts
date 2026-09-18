// SPDX-License-Identifier: AGPL-3.0-only
import { workbenchTools } from "./workbench-tools";
import { developerTools } from "./developer-tools";
import { converters } from "./converters";
import type { Tool } from "./tool-types";
export type { Tool } from "./tool-types";

const text = "Hello world\nRust makes useful things.\nHello world";
const json = '{"name":"Ada","languages":["Rust","TypeScript"],"active":true}';
const csv = "name,language\nAda,Rust\nLin,TypeScript";
const row = (
  group: string,
  id: string,
  name: string,
  description: string,
  sample = text,
  option = "",
  optionLabel = "",
): Tool => ({ group, id, name, description, sample, option, optionLabel });
const catalog: Tool[] = [
  ...workbenchTools,
  ...developerTools,
  ...converters,
  ...[
    [
      "apng",
      "APNG animation builder",
      "Combine images into an animated PNG. Reorder frames and set individual durations.",
      "",
      "",
    ],
    [
      "fallback-apng",
      "APNG with static fallback",
      "Create a PNG with a different static fallback, like the supplied APNG generator.",
      "",
      "",
    ],
    [
      "rotate",
      "Rotate image 90°",
      "Rotate an image clockwise using the Rust pixel core.",
      "",
      "",
    ],
    [
      "flip-horizontal",
      "Flip image horizontally",
      "Mirror an image from left to right.",
      "",
      "",
    ],
    [
      "flip-vertical",
      "Flip image vertically",
      "Mirror an image from top to bottom.",
      "",
      "",
    ],
    [
      "grayscale",
      "Grayscale image",
      "Convert to grayscale while preserving transparency.",
      "",
      "",
    ],
    [
      "invert",
      "Invert image colors",
      "Invert RGB channels while preserving transparency.",
      "",
      "",
    ],
    [
      "brightness",
      "Image brightness",
      "Add a brightness offset to RGB channels.",
      "30",
      "Adjustment (-255 to 255)",
    ],
    [
      "threshold",
      "Black & white threshold",
      "Convert pixels to black or white at a grayscale threshold.",
      "128",
      "Threshold (0–255)",
    ],
    [
      "crop",
      "Crop image",
      "Extract a rectangular region. Coordinates start at the top left.",
      "0, 0, 100, 100",
      "x, y, width, height (pixels)",
    ],
  ].map(([id, name, description, option, optionLabel]) =>
    row(
      "Images & documents",
      "image-" + id,
      name,
      description,
      "",
      option,
      optionLabel,
    ),
  ),
  ...[
    [
      "text-stats",
      "Text statistics",
      "Count words, characters, graphemes, lines, and bytes.",
    ],
    ["uppercase", "Uppercase", "Convert all letters to uppercase."],
    ["lowercase", "Lowercase", "Convert all letters to lowercase."],
    [
      "title-case",
      "Title case",
      "Capitalize each word; punctuation becomes spaces.",
    ],
    [
      "sentence-case",
      "Initial capital",
      "Lowercase the text and capitalize its first character.",
    ],
    ["camel-case", "camelCase", "Join words with an initial lowercase word."],
    ["pascal-case", "PascalCase", "Join words with capitalized initials."],
    ["snake-case", "snake_case", "Separate lowercase words with underscores."],
    ["kebab-case", "kebab-case", "Separate lowercase words with hyphens."],
    [
      "reverse-text",
      "Reverse text",
      "Reverse text while keeping emoji and accents together.",
    ],
    ["trim-lines", "Trim lines", "Remove whitespace at each line’s edges."],
    [
      "collapse-whitespace",
      "Collapse whitespace",
      "Replace runs of whitespace with one space.",
    ],
    [
      "remove-empty-lines",
      "Remove empty lines",
      "Remove blank and whitespace-only lines.",
    ],
    ["sort-lines", "Sort lines", "Sort lines in case-sensitive lexical order."],
    ["reverse-lines", "Reverse lines", "Reverse the line order."],
    [
      "unique-lines",
      "Deduplicate lines",
      "Keep the first occurrence of each exact line.",
    ],
    ["number-lines", "Number lines", "Prefix every line with its line number."],
  ].map((a) => row("Text", a[0], a[1], a[2])),
  row(
    "Text",
    "find-replace",
    "Find & replace",
    "Replace literal text. Put search and replacement on separate lines.",
    text,
    "Hello\nHi",
    "Search / replacement",
  ),
  row(
    "Text",
    "regex-extract",
    "Regex extraction",
    "Extract matches using Rust regex syntax. No lookaround or backreferences.",
    text,
    "[A-Z][a-z]+",
    "Regular expression",
  ),
  ...[
    [
      "base64-encode",
      "Base64 encode",
      "Encode UTF-8 text as Base64.",
      "Hello 🌍",
    ],
    [
      "base64-decode",
      "Base64 decode",
      "Decode Base64 into UTF-8 text.",
      "SGVsbG8g8J+MjQ==",
    ],
    [
      "base64url-encode",
      "Base64URL encode",
      "Create URL-safe Base64 without padding.",
      "Hello 🌍",
    ],
    [
      "base64url-decode",
      "Base64URL decode",
      "Decode URL-safe Base64 into UTF-8 text.",
      "SGVsbG8g8J-MjQ",
    ],
    ["hex-encode", "Hex encode", "Encode UTF-8 bytes as hexadecimal.", "Hello"],
    [
      "hex-decode",
      "Hex decode",
      "Decode hex into UTF-8; accepts spaces, hyphens, colons and 0x or \\x prefixes.",
      "48656c6c6f",
    ],
    [
      "url-encode",
      "URL encode",
      "Percent-encode a URL component.",
      "hello world & café",
    ],
    [
      "url-decode",
      "URL decode",
      "Decode a percent-encoded component; literal + is preserved.",
      "hello%20world%20%26%20caf%C3%A9",
    ],
    [
      "html-escape",
      "HTML escape",
      "Escape text for use in HTML.",
      '<p class="intro">Hello & welcome</p>',
    ],
    [
      "json-escape",
      "JSON string escape",
      "Encode text as a quoted JSON string.",
      'Hello\n"world"',
    ],
    [
      "json-unescape",
      "JSON string unescape",
      "Decode a quoted JSON string.",
      '"Hello\\n\\\"world\\\""',
    ],
  ].map((a) => row("Encoding", a[0], a[1], a[2], a[3])),
  ...[
    ["json-format", "JSON formatter", "Validate and pretty-print JSON.", json],
    [
      "json-minify",
      "JSON minifier",
      "Validate JSON and remove unnecessary whitespace.",
      json,
    ],
    ["json-keys", "JSON keys", "List the top-level keys of an object.", json],
    [
      "json-to-csv",
      "JSON → CSV",
      "Convert an array of objects into a quoted CSV table.",
      '[{"name":"Ada","language":"Rust"},{"name":"Lin","language":"TypeScript"}]',
    ],
    [
      "csv-to-json",
      "CSV → JSON",
      "Convert a CSV with unique headers into JSON strings.",
      csv,
    ],
    [
      "csv-to-tsv",
      "CSV → TSV",
      "Convert CSV to tab-separated values with quoting.",
      csv,
    ],
    [
      "tsv-to-csv",
      "TSV → CSV",
      "Convert tab-separated values into CSV.",
      "name\tlanguage\nAda\tRust",
    ],
  ].map((a) => row("Data", a[0], a[1], a[2], a[3])),
  row("Security", "sha256", "SHA-256", "Hash the exact UTF-8 input.", "abc"),
  row("Security", "sha512", "SHA-512", "Hash the exact UTF-8 input.", "abc"),
  row(
    "Security",
    "jwt-decode",
    "JWT inspector",
    "Read header and payload. This does not verify the signature.",
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjMiLCJuYW1lIjoiQWRhIn0.signature",
  ),
  row(
    "Security",
    "uuid",
    "UUID generator",
    "Generate random version 4 UUIDs with browser cryptographic randomness.",
    "5",
  ),
  row(
    "Security",
    "password",
    "Password generator",
    "Generate passwords from a 64-character alphabet using browser cryptographic randomness.",
    "24",
  ),
  row(
    "Security",
    "file-sha256",
    "File SHA-256",
    "Choose a file to calculate its SHA-256 locally. Maximum 32 MB.",
    "",
  ),
  row(
    "Numbers & units",
    "base-convert",
    "Number base converter",
    "Convert a signed integer into binary, octal, decimal, and hexadecimal.",
    "ff",
    "16",
    "Input base (2–36)",
  ),
  row(
    "Numbers & units",
    "statistics",
    "Statistics",
    "Calculate count, sum, mean, median, range, and population deviation.",
    "12, 18, 24, 30, 42",
  ),
  row(
    "Numbers & units",
    "percentage",
    "Percentage of a number",
    "Enter a percentage and a value, separated by a comma.",
    "15, 240",
  ),
  row(
    "Numbers & units",
    "percentage-change",
    "Percentage change",
    "Enter the old and new values, separated by a comma.",
    "80, 100",
  ),
  row(
    "Numbers & units",
    "gcd-lcm",
    "GCD & LCM",
    "Find the greatest common divisor and least common multiple.",
    "48 180",
  ),
  row(
    "Numbers & units",
    "temperature",
    "Temperature converter",
    "Convert between C, F, and K.",
    "25",
    "C",
    "Input unit: C, F, K",
  ),
  row(
    "Numbers & units",
    "length",
    "Length converter",
    "Convert metric and imperial lengths.",
    "1",
    "m",
    "Input unit: mm, cm, m, km, in, ft, yd, mi",
  ),
  row(
    "Numbers & units",
    "mass",
    "Mass converter",
    "Convert metric and imperial masses.",
    "1",
    "kg",
    "Input unit: mg, g, kg, oz, lb",
  ),
  row(
    "Numbers & units",
    "bytes",
    "Data size converter",
    "Compare decimal and binary byte units.",
    "1",
    "GiB",
    "Input unit: B, KB, MB, GB, KiB, MiB, GiB",
  ),
  row(
    "Date & time",
    "duration",
    "Duration converter",
    "Convert a duration between units.",
    "90",
    "min",
    "Input unit: ms, s, min, h, d",
  ),
  row(
    "Date & time",
    "unix-to-date",
    "Unix timestamp → date",
    "Convert Unix seconds into an ISO date in UTC.",
    "1704067200",
  ),
  row(
    "Date & time",
    "date-to-unix",
    "Date → Unix timestamp",
    "Convert an RFC 3339 date with timezone into Unix seconds.",
    "2024-01-01T00:00:00Z",
  ),
  row(
    "Date & time",
    "date-difference",
    "Date difference",
    "Count calendar days from the first date to the second.",
    "2024-01-01",
    "2024-12-31",
    "End date (YYYY-MM-DD)",
  ),
  row(
    "Date & time",
    "date-add",
    "Add days",
    "Add or subtract calendar days.",
    "2024-02-28",
    "1",
    "Days to add (negative to subtract)",
  ),
  row(
    "Web",
    "url-inspect",
    "URL inspector",
    "Break an absolute URL into its parts.",
    "https://example.com:8080/docs?q=rust#intro",
  ),
  row(
    "Web",
    "query-to-json",
    "Query parameters → JSON",
    "Read query parameters from a URL, preserving repeated keys.",
    "https://example.com/?tag=rust&tag=wasm&sort=asc",
  ),
  row(
    "Web",
    "slug",
    "Slug generator",
    "Turn words into a Unicode-preserving URL slug.",
    "A small collection of useful tools",
  ),
  row(
    "Web",
    "color-convert",
    "Color converter",
    "Convert a hex color into RGB and HSL.",
    "#8899ff",
  ),
  row(
    "Text",
    "word-frequency",
    "Word frequency",
    "Rank words by frequency.",
    text,
  ),
  row(
    "Text",
    "line-diff",
    "Text comparison",
    "Compare two texts with highlighted line additions and removals.",
    "First line\nOriginal line\nLast line",
    "First line\nChanged line\nLast line",
    "New text",
  ),
  row(
    "Encoding",
    "rot13",
    "ROT13",
    "Rotate Latin letters by 13 positions. This is not encryption.",
    "Hello world",
  ),
  row(
    "Encoding",
    "binary-encode",
    "Text → binary",
    "Encode UTF-8 bytes as eight-bit binary groups.",
    "Hello",
  ),
  row(
    "Encoding",
    "binary-decode",
    "Binary → text",
    "Decode eight-bit groups into UTF-8.",
    "01001000 01101001",
  ),
  row(
    "Data",
    "json-flatten",
    "Flatten JSON",
    "Map leaf values to RFC 6901 JSON pointers.",
    json,
  ),
  row(
    "Data",
    "json-pointer",
    "JSON pointer",
    "Extract a value using a JSON pointer.",
    json,
    "/languages/0",
    "Pointer",
  ),
  row(
    "Data",
    "json-merge",
    "Merge JSON objects",
    "Shallow merge two objects. The second object wins duplicate keys.",
    json,
    '{"active":false,"location":"Earth"}',
    "Second object",
  ),
  row(
    "Data",
    "json-table",
    "JSON table",
    "Explore an array of objects as a table.",
    '[{"name":"Ada","language":"Rust","active":true},{"name":"Lin","language":"TypeScript","active":false}]',
  ),
  row(
    "Web",
    "qr-code",
    "QR code generator",
    "Create a scannable QR code and save it as SVG.",
    "https://github.com/l5z12/tools",
  ),
  row(
    "Web",
    "contrast",
    "Color contrast",
    "Compare two colors against WCAG 2 contrast thresholds.",
    "#333333",
    "#ffffff",
    "Background color",
  ),
  row(
    "Web",
    "palette",
    "Color palette",
    "Create nine shades and tints from a color.",
    "#8899ff",
  ),
  row(
    "Web",
    "ipv4-subnet",
    "IPv4 subnet calculator",
    "Inspect CIDR network boundaries and address counts.",
    "192.168.1.12/24",
  ),
  row(
    "Web",
    "url-builder",
    "URL builder",
    "Append encoded query parameters. Arrays become repeated keys.",
    "https://example.com/search",
    '{"q":"Rust & WASM","tag":["tools","web"]}',
    "Query parameters (JSON)",
  ),
  row(
    "Security",
    "uuid-inspect",
    "UUID inspector",
    "Inspect hexadecimal UUID fields; a version nibble alone does not validate generation.",
    "550e8400-e29b-41d4-a716-446655440000",
  ),
  row(
    "Numbers & units",
    "aspect-ratio",
    "Aspect ratio",
    "Simplify width and height into a ratio and preview the proportions.",
    "1920, 1080",
  ),
  row(
    "Numbers & units",
    "roman-numeral",
    "Roman numerals",
    "Convert integers from 1 to 3999.",
    "2026",
  ),
  row(
    "Numbers & units",
    "prime-factors",
    "Prime factorization",
    "Factor an integer up to one trillion.",
    "360",
  ),
  row(
    "Numbers & units",
    "sort-numbers",
    "Sort numbers",
    "Sort numeric values from lowest to highest.",
    "10, 2, -5, 3.14, 100",
  ),
  row(
    "Date & time",
    "date-inspect",
    "Calendar date inspector",
    "Inspect weekday, ISO week, day of year, and leap year.",
    "2026-09-14",
  ),
  row(
    "Images & documents",
    "markdown-preview",
    "Markdown preview",
    "Render Markdown with tables, lists, and code. Scripts and remote resources are blocked.",
    "# Hello world\n\nBuilt with **Rust**.\n\n- Local processing\n- Open source",
  ),
  row(
    "Images & documents",
    "html-preview",
    "HTML preview",
    "Preview HTML in an isolated frame. Scripts and remote resources are blocked.",
    "<h1>Hello world</h1><p>A <strong>small</strong> preview.</p>",
  ),
  row(
    "Images & documents",
    "image-inspect",
    "Image inspector",
    "Inspect a local image and preview its dimensions and file details.",
    "",
  ),
  row(
    "Images & documents",
    "image-resize",
    "Image resizer",
    "Resize a local image to fit a maximum width, preserving its aspect ratio. Save as PNG.",
    "",
    "1200",
    "Maximum width (pixels)",
  ),
  row(
    "Images & documents",
    "image-webp",
    "Image → WebP",
    "Convert a local image to WebP.",
    "",
    "80",
    "Quality (1–100)",
  ),
  row(
    "Images & documents",
    "image-jpeg",
    "Image → JPEG",
    "Convert a local image to JPEG with a white background.",
    "",
    "90",
    "Quality (1–100)",
  ),
];

const legacyTags: Record<string, string[]> = {
  Text: ["text"],
  Encoding: ["encoding"],
  Data: ["data"],
  Security: ["security"],
  "Numbers & units": ["numbers"],
  "Date & time": ["dates", "time"],
  Web: ["web"],
  "Images & documents": ["images"],
};
const taggedTools = catalog.map((tool) => {
  const tags = new Set(tool.tags ?? legacyTags[tool.group] ?? []);
  const id = tool.id;
  if (tags.delete("formatters")) tags.add("formatting");
  if (tags.delete("comparison")) tags.add("diff");
  if (
    /unix-to-date|date-to-unix|duration|cron|timesheet|calendar|business-days/.test(
      id,
    )
  )
    tags.add("time");
  if (/sha256|sha512|hash-workbench/.test(id)) tags.add("hashes");
  if (id.startsWith("jwt-")) tags.add("jwt");
  if (id.includes("markdown")) tags.add("markdown");
  if (
    ["cpp-runner", "rust-playground", "python-runner", "sql-runner"].includes(
      id,
    )
  )
    tags.add("playground");
  if (/json|yaml|toml|csv|tsv/.test(id)) tags.add("data");
  for (const tag of [
    "json",
    "yaml",
    "toml",
    "csv",
    "unicode",
    "base64",
    "hex",
  ]) {
    if (id.includes(tag)) tags.add(tag);
  }
  if (id.startsWith("image-")) {
    tags.add("images");
    tags.add("files");
  }
  if (id.includes("apng")) {
    tags.add("animation");
    tags.add("png");
  }
  if (/color|rgb|hsl|palette|contrast/.test(id)) {
    tags.add("colors");
    tags.add("design");
  }
  if (/sha|password|uuid|jwt/.test(id)) tags.add("developer");
  if (/url|query|curl|csp/.test(id)) {
    tags.add("web");
    tags.add("http");
  }
  if (/markdown|html-preview/.test(id)) {
    tags.delete("images");
    tags.add("documents");
    tags.add("web");
  }
  if (
    /-to-|convert|encode|decode/.test(id) ||
    [
      "temperature",
      "length",
      "mass",
      "bytes",
      "duration",
      "area",
      "volume",
      "speed",
      "pressure",
      "energy",
      "power",
      "angle",
      "frequency",
      "data-rate",
      "force",
    ].includes(id)
  )
    tags.add("converters");
  if (
    [
      "temperature",
      "length",
      "mass",
      "bytes",
      "duration",
      "area",
      "volume",
      "speed",
      "pressure",
      "energy",
      "power",
      "angle",
      "frequency",
      "data-rate",
      "force",
    ].includes(id)
  )
    tags.add("units");
  if (/diff|compare/.test(id)) tags.add("diff");
  return { ...tool, tags: [...tags].sort() };
});
// Filters should group tools. Preserve narrow subjects as search keywords until
// there are at least two tools sharing the tag.
const tagCounts = new Map<string, number>();
for (const tool of taggedTools) {
  for (const tag of tool.tags)
    tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
}
export const tools = taggedTools.map((tool) => ({
  ...tool,
  tags: tool.tags.filter((tag) => tagCounts.get(tag)! > 1),
  keywords: [...new Set([...(tool.keywords ?? []), ...tool.tags])],
}));
export const hashtags = [...new Set(tools.flatMap((t) => t.tags))].sort();
